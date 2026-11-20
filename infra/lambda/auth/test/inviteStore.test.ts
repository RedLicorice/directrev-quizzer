import { describe, it, expect } from 'vitest';
import { createAccountCreator } from '../src/accounts.js';
import { CAMPAIGN_ID_RE, campaignStatus, createDynamoCampaignStore, newCampaignId, type CampaignItem } from '../src/inviteStore.js';
import { createDynamoOriginStore } from '../src/originStore.js';

// Records the DynamoDB commands the stores send and answers with canned results/errors.
function recorder(respond: (input: Record<string, any>, name: string) => unknown = () => ({})) {
  const sent: { name: string; input: Record<string, any> }[] = [];
  return {
    sent,
    client: {
      async send(command: { constructor: { name: string }; input: Record<string, any> }) {
        sent.push({ name: command.constructor.name, input: command.input });
        const out = respond(command.input, command.constructor.name);
        if (out instanceof Error) throw out;
        return out;
      },
    },
  };
}
const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
const table = async () => 'tbl';
const ID = 'AAAAAAAAAAAAAAAA';
const item: CampaignItem = { id: ID, name: 'n', createdBy: 'a', createdAt: 0, updatedAt: 0, expiresAt: 1000, maxUses: 2, uses: 0, enabled: true };

describe('campaign id and status', () => {
  it('id is 16 url-safe chars, random', () => {
    const a = newCampaignId();
    expect(a).toMatch(CAMPAIGN_ID_RE);
    expect(newCampaignId()).not.toBe(a);
    expect('a'.repeat(64)).not.toMatch(CAMPAIGN_ID_RE); // old token-hash ids are not campaigns
  });
  it('disabled > expired > exhausted > active', () => {
    expect(campaignStatus(item, 999)).toBe('active');
    expect(campaignStatus({ ...item, uses: 2 }, 999)).toBe('exhausted');
    expect(campaignStatus({ ...item, uses: 2 }, 1000)).toBe('expired'); // now >= expiresAt
    expect(campaignStatus({ ...item, uses: 2, enabled: false }, 1000)).toBe('disabled');
  });
});

describe('campaign DynamoDB commands', () => {
  it('redeem: one conditional ADD returning the campaign (the only place a use is counted)', async () => {
    const r = recorder(() => ({ Attributes: { ...item, uses: 1 } }));
    const got = await createDynamoCampaignStore(r.client, table).redeem(ID, 123);
    expect(got).toMatchObject({ id: ID, uses: 1 });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.name).toBe('UpdateCommand');
    expect(r.sent[0]!.input).toEqual({
      TableName: 'tbl',
      Key: { id: ID },
      UpdateExpression: 'ADD uses :one',
      ConditionExpression: 'attribute_exists(id) AND #enabled = :true AND expiresAt > :now AND uses < maxUses',
      ExpressionAttributeNames: { '#enabled': 'enabled' },
      ExpressionAttributeValues: { ':one': 1, ':true': true, ':now': 123 },
      ReturnValues: 'ALL_NEW',
    });
  });
  it('redeem: failed condition -> null; other errors propagate', async () => {
    expect(await createDynamoCampaignStore(recorder(() => conditionFailed()).client, table).redeem(ID, 1)).toBeNull();
    const boom = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
    await expect(createDynamoCampaignStore(recorder(() => boom).client, table).redeem(ID, 1)).rejects.toThrow('throttled');
  });
  it('release: ADD -1, never throws, never goes below zero', async () => {
    const r = recorder(() => conditionFailed());
    await expect(createDynamoCampaignStore(r.client, table).release(ID)).resolves.toBeUndefined();
    expect(r.sent[0]!.input).toMatchObject({
      UpdateExpression: 'ADD uses :minus_one',
      ConditionExpression: 'attribute_exists(id) AND uses > :zero',
      ExpressionAttributeValues: { ':minus_one': -1, ':zero': 0 },
    });
    await expect(createDynamoCampaignStore(recorder(() => new Error('down')).client, table).release(ID)).resolves.toBeUndefined();
  });
  it('update: one conditional write; maxUses is guarded by uses; null removes a note', async () => {
    const r = recorder(() => ({ Attributes: item }));
    const store = createDynamoCampaignStore(r.client, table);
    expect(await store.update(ID, { name: 'x', publicNote: null, maxUses: 5, enabled: false, expiresAt: 9 }, 7)).toEqual({ ok: true, item });
    expect(r.sent[0]!.input).toMatchObject({
      Key: { id: ID },
      UpdateExpression: 'SET updatedAt = :now, #name = :name, #maxUses = :maxUses, #enabled = :enabled, #expiresAt = :expiresAt REMOVE #publicNote',
      ConditionExpression: 'attribute_exists(id) AND uses <= :maxUses',
      ExpressionAttributeValues: { ':now': 7, ':name': 'x', ':maxUses': 5, ':enabled': false, ':expiresAt': 9 },
      ReturnValues: 'ALL_NEW',
    });
    await store.update(ID, { enabled: true }, 8);
    expect(r.sent[1]!.input.ConditionExpression).toBe('attribute_exists(id)');
  });
  it('update: failed condition tells a missing campaign from maxUses below uses', async () => {
    const missing = recorder((_, name) => (name === 'GetCommand' ? {} : conditionFailed()));
    expect(await createDynamoCampaignStore(missing.client, table).update(ID, { maxUses: 1 }, 1)).toEqual({ ok: false, reason: 'not_found' });
    const present = recorder((_, name) => (name === 'GetCommand' ? { Item: item } : conditionFailed()));
    expect(await createDynamoCampaignStore(present.client, table).update(ID, { maxUses: 1 }, 1)).toEqual({ ok: false, reason: 'max_uses_below_uses' });
  });
  it('create refuses to overwrite; get is consistent; delete is a plain DeleteItem', async () => {
    const r = recorder((_, name) => (name === 'GetCommand' ? { Item: item } : {}));
    const store = createDynamoCampaignStore(r.client, table);
    await store.create(item);
    expect(r.sent[0]!.input).toEqual({ TableName: 'tbl', Item: item, ConditionExpression: 'attribute_not_exists(id)' });
    expect(await store.get(ID)).toEqual(item);
    expect(r.sent[1]!.input).toMatchObject({ Key: { id: ID }, ConsistentRead: true });
    await store.delete(ID);
    expect(r.sent[2]!.name).toBe('DeleteCommand');
    expect(r.sent[2]!.input).toEqual({ TableName: 'tbl', Key: { id: ID } });
  });
  it('list follows pagination and skips items of the old token-hash scheme', async () => {
    const pages = [{ Items: [{ id: ID }, { id: 'a'.repeat(64) }], LastEvaluatedKey: { id: ID } }, { Items: [{ id: 'BBBBBBBBBBBBBBBB' }] }];
    const r = recorder(() => pages.shift());
    expect((await createDynamoCampaignStore(r.client, table).list()).map((i) => i.id)).toEqual([ID, 'BBBBBBBBBBBBBBBB']);
    expect(r.sent[1]!.input.ExclusiveStartKey).toEqual({ id: ID });
  });
  it('the table name comes from the (lazy) config', async () => {
    const r = recorder();
    await createDynamoCampaignStore(r.client, async () => 'from-config').get(ID);
    expect(r.sent[0]!.input.TableName).toBe('from-config');
  });
});

describe('origin DynamoDB commands', () => {
  it('put writes the snapshot item', async () => {
    const r = recorder();
    const o = { username: 'u1', campaignId: ID, campaignName: 'n', at: 5 };
    await createDynamoOriginStore(r.client, table).put(o);
    expect(r.sent[0]!.input).toEqual({ TableName: 'tbl', Item: o });
  });
  it('getMany: chunks of 100, one retry of UnprocessedKeys, the rest counts as invited', async () => {
    const users = Array.from({ length: 150 }, (_, i) => `u${i}`);
    let calls = 0;
    const r = recorder((input) => {
      calls++;
      const keys = input.RequestItems.tbl.Keys as { username: string }[];
      if (calls === 1) {
        // first chunk: one key comes back unprocessed, and again on the retry
        return { Responses: { tbl: keys.slice(1).map((k) => ({ username: k.username, campaignId: ID, campaignName: 'n', at: 1 })) }, UnprocessedKeys: { tbl: { Keys: [keys[0]] } } };
      }
      if (calls === 2) return { Responses: { tbl: [] }, UnprocessedKeys: { tbl: { Keys: keys } } };
      return { Responses: { tbl: keys.map((k) => ({ username: k.username, campaignId: ID, campaignName: 'n', at: 1 })) } };
    });
    const found = await createDynamoOriginStore(r.client, table).getMany(users);
    expect(r.sent.map((s) => s.input.RequestItems.tbl.Keys.length)).toEqual([100, 1, 50]);
    expect(found.size).toBe(99 + 50); // u0 is still unprocessed after the single retry
    expect(found.has('u0')).toBe(false);
    expect(found.get('u120')).toMatchObject({ campaignId: ID });
  });
});

describe('createAccountCreator', () => {
  it('AdminCreateUser (SUPPRESS, verified email, chosen password as temporary) then AdminSetUserPassword (permanent); no group call; resolves to the Cognito Username', async () => {
    const sent: { name: string; input: Record<string, any> }[] = [];
    const client = {
      send: async (c: { constructor: { name: string }; input: Record<string, any> }) => {
        sent.push({ name: c.constructor.name, input: c.input });
        return c.constructor.name === 'AdminCreateUserCommand' ? { User: { Username: 'generated-uuid' } } : {};
      },
    } as never;
    expect(await createAccountCreator(async () => 'pool-1', client).create('new@example.com', 'Secret-Passw0rd')).toBe('generated-uuid');
    expect(sent.map((s) => s.name)).toEqual(['AdminCreateUserCommand', 'AdminSetUserPasswordCommand']);
    expect(sent[0]!.input).toEqual({
      UserPoolId: 'pool-1',
      Username: 'new@example.com',
      TemporaryPassword: 'Secret-Passw0rd',
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: 'new@example.com' },
        { Name: 'email_verified', Value: 'true' },
      ],
    });
    expect(sent[1]!.input).toEqual({ UserPoolId: 'pool-1', Username: 'new@example.com', Password: 'Secret-Passw0rd', Permanent: true });
  });
  it('a failing AdminCreateUser stops there (nothing to clean up)', async () => {
    const sent: string[] = [];
    const client = { send: async (c: { constructor: { name: string } }) => { sent.push(c.constructor.name); throw Object.assign(new Error('x'), { name: 'InvalidPasswordException' }); } } as never;
    await expect(createAccountCreator(async () => 'p', client).create('a@b.co', 'x')).rejects.toMatchObject({ name: 'InvalidPasswordException' });
    expect(sent).toEqual(['AdminCreateUserCommand']);
  });
});

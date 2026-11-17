import { describe, it, expect } from 'vitest';
import { createAccountCreator } from '../src/accounts.js';
import { createDynamoInviteStore, hashToken, inviteStatus, type InviteItem } from '../src/inviteStore.js';

// Records the DynamoDB commands the store sends and answers with canned results/errors.
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
const ID = hashToken('abc');

describe('hashToken / inviteStatus', () => {
  it('sha256 hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('revoked > expired > exhausted > active', () => {
    const item: InviteItem = { id: ID, createdBy: 'a', createdAt: 0, expiresAt: 1000, maxUses: 2, uses: 0, ttl: 0 };
    expect(inviteStatus(item, 999)).toBe('active');
    expect(inviteStatus({ ...item, uses: 2 }, 999)).toBe('exhausted');
    expect(inviteStatus({ ...item, uses: 2 }, 1000)).toBe('expired'); // now >= expiresAt
    expect(inviteStatus({ ...item, uses: 2, revokedAt: 5 }, 1000)).toBe('revoked');
  });
});

describe('DynamoDB commands', () => {
  it('redeem: one conditional ADD (the only place the use is counted)', async () => {
    const r = recorder();
    const store = createDynamoInviteStore(r.client, table);
    expect(await store.redeem(ID, 123)).toBe(true);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.name).toBe('UpdateCommand');
    expect(r.sent[0]!.input).toEqual({
      TableName: 'tbl',
      Key: { id: ID },
      UpdateExpression: 'ADD uses :one',
      ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(revokedAt) AND expiresAt > :now AND uses < maxUses',
      ExpressionAttributeValues: { ':one': 1, ':now': 123 },
    });
  });
  it('redeem: failed condition -> false; other errors propagate', async () => {
    expect(await createDynamoInviteStore(recorder(() => conditionFailed()).client, table).redeem(ID, 1)).toBe(false);
    const boom = Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' });
    await expect(createDynamoInviteStore(recorder(() => boom).client, table).redeem(ID, 1)).rejects.toThrow('throttled');
  });
  it('release: ADD -1, never throws, never goes below zero', async () => {
    const r = recorder(() => conditionFailed());
    const store = createDynamoInviteStore(r.client, table);
    await expect(store.release(ID)).resolves.toBeUndefined();
    expect(r.sent[0]!.input).toMatchObject({
      UpdateExpression: 'ADD uses :minus_one',
      ConditionExpression: 'attribute_exists(id) AND uses > :zero',
      ExpressionAttributeValues: { ':minus_one': -1, ':zero': 0 },
    });
    await expect(createDynamoInviteStore(recorder(() => new Error('down')).client, table).release(ID)).resolves.toBeUndefined();
  });
  it('create refuses to overwrite; get is consistent; revoke is idempotent and 404-aware', async () => {
    const r = recorder((_, name) => (name === 'GetCommand' ? { Item: { id: ID } } : {}));
    const store = createDynamoInviteStore(r.client, table);
    const item: InviteItem = { id: ID, createdBy: 'a', createdAt: 1, expiresAt: 2, maxUses: 1, uses: 0, ttl: 3 };
    await store.create(item);
    expect(r.sent[0]!.input).toEqual({ TableName: 'tbl', Item: item, ConditionExpression: 'attribute_not_exists(id)' });
    expect(await store.get(ID)).toEqual({ id: ID });
    expect(r.sent[1]!.input).toMatchObject({ Key: { id: ID }, ConsistentRead: true });
    expect(await store.revoke(ID, 9)).toBe(true);
    expect(r.sent[2]!.input).toMatchObject({
      UpdateExpression: 'SET revokedAt = if_not_exists(revokedAt, :now)',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: { ':now': 9 },
    });
    expect(await createDynamoInviteStore(recorder(() => conditionFailed()).client, table).revoke(ID, 9)).toBe(false);
  });
  it('list follows pagination', async () => {
    const pages = [{ Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } }, { Items: [{ id: 'b' }] }];
    const r = recorder(() => pages.shift());
    expect((await createDynamoInviteStore(r.client, table).list()).map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.sent[1]!.input.ExclusiveStartKey).toEqual({ id: 'a' });
  });
  it('the table name comes from the (lazy) config', async () => {
    const r = recorder();
    await createDynamoInviteStore(r.client, async () => 'from-config').get(ID);
    expect(r.sent[0]!.input.TableName).toBe('from-config');
  });
});

describe('createAccountCreator', () => {
  it('AdminCreateUser (SUPPRESS, verified email, chosen password as temporary) then AdminSetUserPassword (permanent); no group call', async () => {
    const sent: { name: string; input: Record<string, any> }[] = [];
    const client = { send: async (c: { constructor: { name: string }; input: Record<string, any> }) => void sent.push({ name: c.constructor.name, input: c.input }) } as never;
    await createAccountCreator(async () => 'pool-1', client).create('new@example.com', 'Secret-Passw0rd');
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

// Campaigns (formerly "invite links"): DynamoDB-backed store shared by the auth Lambda (read,
// redeem, release) and the admin Lambda (create, list, update, delete). The campaign id is a
// stable, public identifier (not a secret): the join URL is `/auth/join?c=<id>` and an admin can
// always copy it. Contract: infra/CONTRACT.md §5.2.
import { randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface CampaignItem {
  id: string; // base64url of 12 random bytes
  name: string;
  publicNote?: string; // shown on the public join page
  internalNote?: string; // admin only
  createdBy: string;
  createdAt: number; // ms
  updatedAt: number; // ms
  expiresAt: number; // ms
  maxUses: number;
  uses: number;
  enabled: boolean;
}

export type CampaignStatus = 'active' | 'disabled' | 'expired' | 'exhausted';

export const CAMPAIGN_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const ID_BYTES = 12;

export const newCampaignId = (): string => randomBytes(ID_BYTES).toString('base64url');

/** disabled > expired > exhausted > active. */
export function campaignStatus(item: CampaignItem, nowMs: number): CampaignStatus {
  if (!item.enabled) return 'disabled';
  if (nowMs >= item.expiresAt) return 'expired';
  if (item.uses >= item.maxUses) return 'exhausted';
  return 'active';
}

/** Fields an admin can change; `null` on a note removes it. */
export interface CampaignChanges {
  name?: string;
  publicNote?: string | null;
  internalNote?: string | null;
  maxUses?: number;
  enabled?: boolean;
  expiresAt?: number;
}

export type UpdateResult = { ok: true; item: CampaignItem } | { ok: false; reason: 'not_found' | 'max_uses_below_uses' };

export interface CampaignStore {
  /** Fails if the id already exists. */
  create(item: CampaignItem): Promise<void>;
  get(id: string): Promise<CampaignItem | null>;
  list(): Promise<CampaignItem[]>;
  /** Applies the changes in one conditional write; `maxUses` can never drop below `uses`. */
  update(id: string, changes: CampaignChanges, nowMs: number): Promise<UpdateResult>;
  /** Hard delete, idempotent. */
  delete(id: string): Promise<void>;
  /**
   * Atomically takes one use. Returns the campaign (with the use counted) or null when it is
   * unknown, disabled, expired or exhausted.
   */
  redeem(id: string, nowMs: number): Promise<CampaignItem | null>;
  /** Gives a use back (best effort: never throws). */
  release(id: string): Promise<void>;
}

/** The slice of DynamoDBDocumentClient the stores need. */
export interface DocClient {
  send(command: unknown): Promise<unknown>;
}

export const isConditionFailed = (e: unknown) => e instanceof Error && e.name === 'ConditionalCheckFailedException';

export function createDynamoCampaignStore(doc: DocClient, getTableName: () => Promise<string>): CampaignStore {
  const send = async <T>(command: unknown): Promise<T> => (await doc.send(command)) as T;

  const store: CampaignStore = {
    async create(item) {
      await send(
        new PutCommand({ TableName: await getTableName(), Item: item, ConditionExpression: 'attribute_not_exists(id)' }),
      );
    },

    async get(id) {
      const r = await send<{ Item?: CampaignItem }>(
        new GetCommand({ TableName: await getTableName(), Key: { id }, ConsistentRead: true }),
      );
      return r.Item ?? null;
    },

    async list() {
      const TableName = await getTableName();
      const items: CampaignItem[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const r = await send<{ Items?: CampaignItem[]; LastEvaluatedKey?: Record<string, unknown> }>(
          new ScanCommand({ TableName, ...(start ? { ExclusiveStartKey: start } : {}) }),
        );
        // Items of the old token-hash scheme (64 hex chars) are ignored.
        items.push(...(r.Items ?? []).filter((i) => CAMPAIGN_ID_RE.test(i.id)));
        start = r.LastEvaluatedKey;
      } while (start);
      return items;
    },

    async update(id, changes, nowMs) {
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = { ':now': nowMs };
      const set = ['updatedAt = :now'];
      const remove: string[] = [];
      let condition = 'attribute_exists(id)';
      for (const field of ['name', 'publicNote', 'internalNote', 'maxUses', 'enabled', 'expiresAt'] as const) {
        const v = changes[field];
        if (v === undefined) continue;
        names[`#${field}`] = field;
        if (v === null) {
          remove.push(`#${field}`);
        } else {
          set.push(`#${field} = :${field}`);
          values[`:${field}`] = v;
        }
      }
      if (changes.maxUses !== undefined) condition += ' AND uses <= :maxUses';
      const expression = `SET ${set.join(', ')}${remove.length ? ` REMOVE ${remove.join(', ')}` : ''}`;
      try {
        const r = await send<{ Attributes?: CampaignItem }>(
          new UpdateCommand({
            TableName: await getTableName(),
            Key: { id },
            UpdateExpression: expression,
            ConditionExpression: condition,
            ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW',
          }),
        );
        return { ok: true, item: r.Attributes as CampaignItem };
      } catch (e) {
        if (!isConditionFailed(e)) throw e;
        // Either the id is gone or the new maxUses is below the current uses: tell them apart.
        return { ok: false, reason: (await store.get(id)) ? 'max_uses_below_uses' : 'not_found' };
      }
    },

    async delete(id) {
      await send(new DeleteCommand({ TableName: await getTableName(), Key: { id } }));
    },

    async redeem(id, nowMs) {
      try {
        const r = await send<{ Attributes?: CampaignItem }>(
          new UpdateCommand({
            TableName: await getTableName(),
            Key: { id },
            UpdateExpression: 'ADD uses :one',
            ConditionExpression: 'attribute_exists(id) AND #enabled = :true AND expiresAt > :now AND uses < maxUses',
            ExpressionAttributeNames: { '#enabled': 'enabled' },
            ExpressionAttributeValues: { ':one': 1, ':true': true, ':now': nowMs },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return r.Attributes ?? null;
      } catch (e) {
        if (isConditionFailed(e)) return null;
        throw e;
      }
    },

    async release(id) {
      try {
        await send(
          new UpdateCommand({
            TableName: await getTableName(),
            Key: { id },
            UpdateExpression: 'ADD uses :minus_one',
            ConditionExpression: 'attribute_exists(id) AND uses > :zero',
            ExpressionAttributeValues: { ':minus_one': -1, ':zero': 0 },
          }),
        );
      } catch {
        /* best effort: a lost release only burns one use */
      }
    },
  };
  return store;
}

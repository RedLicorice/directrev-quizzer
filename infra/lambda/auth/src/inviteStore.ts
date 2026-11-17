// Invite links: DynamoDB-backed store shared by the auth Lambda (read, redeem, release) and
// the admin Lambda (create, list, revoke). Only sha256(token) is ever stored (the item id);
// the token itself exists in the admin's URL and nowhere else. Contract: infra/CONTRACT.md §5.2.
import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface InviteItem {
  id: string; // sha256(token), lower-case hex
  createdBy: string;
  createdAt: number; // ms
  expiresAt: number; // ms
  maxUses: number;
  uses: number;
  note?: string;
  revokedAt?: number; // ms
  ttl: number; // epoch seconds, DynamoDB TTL attribute
}

export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export const INVITE_ID_RE = /^[0-9a-f]{64}$/;
/** 32 random bytes, base64url without padding. */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** revoked > expired > exhausted > active. */
export function inviteStatus(item: InviteItem, nowMs: number): InviteStatus {
  if (item.revokedAt !== undefined) return 'revoked';
  if (nowMs >= item.expiresAt) return 'expired';
  if (item.uses >= item.maxUses) return 'exhausted';
  return 'active';
}

export interface InviteStore {
  /** Fails if the id already exists. */
  create(item: InviteItem): Promise<void>;
  get(id: string): Promise<InviteItem | null>;
  list(): Promise<InviteItem[]>;
  /** Idempotent. False when the link does not exist. */
  revoke(id: string, nowMs: number): Promise<boolean>;
  /** Atomically takes one use. False when the link is unknown, revoked, expired or exhausted. */
  redeem(id: string, nowMs: number): Promise<boolean>;
  /** Gives a use back (best effort: never throws). */
  release(id: string): Promise<void>;
}

/** The slice of DynamoDBDocumentClient the store needs. */
export interface DocClient {
  send(command: unknown): Promise<unknown>;
}

const isConditionFailed = (e: unknown) => e instanceof Error && e.name === 'ConditionalCheckFailedException';

export function createDynamoInviteStore(doc: DocClient, getTableName: () => Promise<string>): InviteStore {
  const send = async <T>(command: unknown): Promise<T> => (await doc.send(command)) as T;

  return {
    async create(item) {
      await send(
        new PutCommand({ TableName: await getTableName(), Item: item, ConditionExpression: 'attribute_not_exists(id)' }),
      );
    },

    async get(id) {
      const r = await send<{ Item?: InviteItem }>(
        new GetCommand({ TableName: await getTableName(), Key: { id }, ConsistentRead: true }),
      );
      return r.Item ?? null;
    },

    async list() {
      const TableName = await getTableName();
      const items: InviteItem[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const r = await send<{ Items?: InviteItem[]; LastEvaluatedKey?: Record<string, unknown> }>(
          new ScanCommand({ TableName, ...(start ? { ExclusiveStartKey: start } : {}) }),
        );
        items.push(...(r.Items ?? []));
        start = r.LastEvaluatedKey;
      } while (start);
      return items;
    },

    async revoke(id, nowMs) {
      try {
        await send(
          new UpdateCommand({
            TableName: await getTableName(),
            Key: { id },
            UpdateExpression: 'SET revokedAt = if_not_exists(revokedAt, :now)',
            ConditionExpression: 'attribute_exists(id)',
            ExpressionAttributeValues: { ':now': nowMs },
          }),
        );
        return true;
      } catch (e) {
        if (isConditionFailed(e)) return false;
        throw e;
      }
    },

    async redeem(id, nowMs) {
      try {
        await send(
          new UpdateCommand({
            TableName: await getTableName(),
            Key: { id },
            UpdateExpression: 'ADD uses :one',
            ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(revokedAt) AND expiresAt > :now AND uses < maxUses',
            ExpressionAttributeValues: { ':one': 1, ':now': nowMs },
          }),
        );
        return true;
      } catch (e) {
        if (isConditionFailed(e)) return false;
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
}

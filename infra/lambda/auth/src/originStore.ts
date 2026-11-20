// User origin: which campaign a user registered through. Written by the auth Lambda right
// after the account exists, read in bulk by the admin Lambda for the users list. No item for a
// user means "invited" (created by an admin, or registered before campaigns existed).
// The campaign name is a snapshot, so the origin survives a rename or deletion of the campaign.
import { BatchGetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DocClient } from './inviteStore.js';

export interface OriginItem {
  username: string; // Cognito Username
  campaignId: string;
  campaignName: string;
  at: number; // ms
}

export type Origin = { kind: 'invited' } | { kind: 'campaign'; campaignId: string; name: string };

export interface OriginStore {
  put(item: OriginItem): Promise<void>;
  /** Campaign origins of the given users; users without an item are absent from the map. */
  getMany(usernames: string[]): Promise<Map<string, OriginItem>>;
}

/** BatchGetItem accepts at most 100 keys per call. */
const BATCH_SIZE = 100;

type Keys = { username: string }[];
interface BatchOut {
  Responses?: Record<string, OriginItem[]>;
  UnprocessedKeys?: Record<string, { Keys: Keys }>;
}

export function createDynamoOriginStore(doc: DocClient, getTableName: () => Promise<string>): OriginStore {
  const send = async <T>(command: unknown): Promise<T> => (await doc.send(command)) as T;

  return {
    async put(item) {
      await send(new PutCommand({ TableName: await getTableName(), Item: item }));
    },

    async getMany(usernames) {
      const TableName = await getTableName();
      const found = new Map<string, OriginItem>();
      const unique = [...new Set(usernames)];
      for (let i = 0; i < unique.length; i += BATCH_SIZE) {
        let keys: Keys = unique.slice(i, i + BATCH_SIZE).map((username) => ({ username }));
        // One retry for UnprocessedKeys; what is still missing is treated as "invited".
        for (let attempt = 0; attempt < 2 && keys.length > 0; attempt++) {
          const r = await send<BatchOut>(new BatchGetCommand({ RequestItems: { [TableName]: { Keys: keys } } }));
          for (const item of r.Responses?.[TableName] ?? []) found.set(item.username, item);
          keys = r.UnprocessedKeys?.[TableName]?.Keys ?? [];
        }
      }
      return found;
    },
  };
}

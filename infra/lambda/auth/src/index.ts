// Lambda entry point: wires real AWS clients into the handler.
import '@aws-sdk/signature-v4a'; // registers the pure-JS SigV4a signer needed by the KVS data-plane API
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { CloudFrontKeyValueStoreClient, GetKeyCommand } from '@aws-sdk/client-cloudfront-keyvaluestore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { createConfigLoader } from './config.js';
import { createKeyStore } from './keys.js';
import { createHandler } from './handler.js';
import type { Fetch } from './cognito.js';
import { createAccountCreator } from './accounts.js';
import { createDynamoInviteStore } from './inviteStore.js';
import { createInMemoryLimiter } from './limiter.js';

const CONFIG_PARAMETER = process.env.CONFIG_PARAMETER ?? '';
const KVS_ARN = process.env.KVS_ARN ?? '';

const ssm = new SSMClient({});
const kvs = new CloudFrontKeyValueStoreClient({});

const getConfig = createConfigLoader(
  async (name) => {
    const r = await ssm.send(new GetParameterCommand({ Name: name }));
    if (!r.Parameter?.Value) throw new Error('config parameter empty');
    return r.Parameter.Value;
  },
  CONFIG_PARAMETER,
  Date.now,
);

const keys = createKeyStore(async (key) => {
  try {
    const r = await kvs.send(new GetKeyCommand({ KvsARN: KVS_ARN, Key: key }));
    return r.Value ?? null;
  } catch (e) {
    if (e instanceof Error && e.name === 'ResourceNotFoundException') return null;
    throw e;
  }
}, Date.now);

const inviteTable = async () => {
  const links = (await getConfig()).inviteLinks;
  if (!links) throw new Error('invite links are not configured');
  return links.tableName;
};

export const handler = createHandler({
  getConfig,
  keys,
  fetch: globalThis.fetch as unknown as Fetch,
  nowMs: Date.now,
  random: (n) => randomBytes(n),
  log: (entry) => console.log(JSON.stringify(entry)),
  invites: createDynamoInviteStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), inviteTable),
  accounts: createAccountCreator(async () => (await getConfig()).userPoolId),
  limiter: createInMemoryLimiter(Date.now),
});

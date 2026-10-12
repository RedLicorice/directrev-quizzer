// Lambda entry point: wires the real AWS clients into the handler.
import '@aws-sdk/signature-v4a'; // registers the pure-JS SigV4a signer needed by the KVS data-plane API
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { CloudFrontKeyValueStoreClient, GetKeyCommand } from '@aws-sdk/client-cloudfront-keyvaluestore';
import { createConfigLoader } from '../../auth/src/config.js';
import { createKeyStore } from '../../auth/src/keys.js';
import { createCognitoAdmin, createAuditReader } from './aws.js';
import { createInMemoryLimiter } from './limiter.js';
import { createHandler } from './handler.js';

const CONFIG_PARAMETER = process.env.CONFIG_PARAMETER ?? '';
const KVS_ARN = process.env.KVS_ARN ?? '';
// Set automatically by the Lambda runtime; used to read our own audit records.
const LOG_GROUP = process.env.AWS_LAMBDA_LOG_GROUP_NAME ?? '';

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

export const handler = createHandler({
  getConfig,
  keys,
  cognito: createCognitoAdmin(async () => (await getConfig()).userPoolId),
  readAudit: createAuditReader(LOG_GROUP),
  nowMs: Date.now,
  log: (entry) => console.log(JSON.stringify(entry)),
  limiter: createInMemoryLimiter(Date.now),
});

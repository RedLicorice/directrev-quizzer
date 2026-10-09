// Runs the operational scripts against a fake AWS CLI (no credentials, no network).
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..');
const KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/0000-kvs';
const POOL = 'eu-central-1_TESTPOOL';
let dir;

function run(script, args = [], env = {}) {
  const r = spawnSync('bash', [join(scripts, script), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(here, 'bin')}:${process.env.PATH}`,
      FAKE_AWS_STATE: join(dir, 'state.json'),
      FAKE_AWS_LOG: join(dir, 'calls.log'),
      KVS_ARN,
      USER_POOL_ID: POOL,
      WAIT_SECONDS: '0',
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const calls = () => readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qz-scripts-'));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ kvsArn: KVS_ARN, etag: 'E1', kvs: {}, pool: POOL, users: {} }));
  writeFileSync(join(dir, 'calls.log'), '');
});

describe('rotate-session-key.sh', () => {
  it('--init creates the first key and makes it current, without printing the secret', () => {
    const r = run('rotate-session-key.sh', ['--init']);
    expect(r.code, r.err).toBe(0);
    const s = state();
    const kid = s.kvs['qz-current-kid'];
    expect(kid).toMatch(/^k\d{8}T\d{6}$/);
    expect(s.kvs['qz-key-' + kid]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.out + r.err).not.toContain(s.kvs['qz-key-' + kid]);
    // key written before switching current
    const puts = calls().filter((c) => c[1] === 'put-key').map((c) => c[c.indexOf('--key') + 1]);
    expect(puts).toEqual(['qz-key-' + kid, 'qz-current-kid']);
  });
  it('--init refuses when a key exists; rotation keeps the old key and suggests retiring it', () => {
    expect(run('rotate-session-key.sh', ['--init']).code).toBe(0);
    const old = state().kvs['qz-current-kid'];
    expect(run('rotate-session-key.sh', ['--init']).code).toBe(1);
    // kid has 1-second resolution
    spawnSync('sleep', ['1.1']);
    const r = run('rotate-session-key.sh');
    expect(r.code, r.err).toBe(0);
    const s = state();
    expect(s.kvs['qz-current-kid']).not.toBe(old);
    expect(s.kvs['qz-key-' + old]).toBeDefined();
    expect(r.out).toContain(`--retire ${old}`);
    expect(run('rotate-session-key.sh', ['--retire', s.kvs['qz-current-kid']]).code).toBe(1);
    expect(run('rotate-session-key.sh', ['--retire', old]).code).toBe(0);
    expect(state().kvs['qz-key-' + old]).toBeUndefined();
    const list = run('rotate-session-key.sh', ['--list']);
    expect(list.out).toContain('current: ' + s.kvs['qz-current-kid']);
    expect(list.out).not.toContain(s.kvs['qz-key-' + s.kvs['qz-current-kid']]);
  });
  it('rejects a malformed kid', () => {
    expect(run('rotate-session-key.sh', ['--retire', '../x']).code).toBe(2);
  });
});

describe('invite-user.sh / offboard-user.sh', () => {
  it('invites with groups', () => {
    const r = run('invite-user.sh', ['mario@example.com', 'ds-aws-dva-c02']);
    expect(r.code, r.err).toBe(0);
    expect(state().users['mario@example.com']).toEqual({ enabled: true, groups: ['ds-aws-dva-c02'] });
    const create = calls().find((c) => c[1] === 'admin-create-user');
    expect(create).toEqual(expect.arrayContaining(['--desired-delivery-mediums', 'EMAIL', 'Name=email_verified,Value=true']));
  });
  it('requires --confirm-mcd for the MCD dataset', () => {
    expect(run('invite-user.sh', ['a@example.com', 'ds-mule-mcd-01']).code).toBe(1);
    expect(state().users['a@example.com']).toBeUndefined();
    expect(run('invite-user.sh', ['--confirm-mcd', 'a@example.com', 'ds-mule-mcd-01']).code).toBe(0);
  });
  it('rejects bad input', () => {
    expect(run('invite-user.sh', ['not-an-email']).code).toBe(2);
    expect(run('invite-user.sh', ['a@example.com', 'root']).code).toBe(2);
  });
  it('warns when no group is given; resend works', () => {
    const r = run('invite-user.sh', ['b@example.com']);
    expect(r.err).toContain('accesso non abilitato');
    expect(run('invite-user.sh', ['--resend', 'b@example.com']).code).toBe(0);
  });
  it('offboard disables, signs out and removes groups; --delete deletes', () => {
    run('invite-user.sh', ['c@example.com', 'ds-aws-dva-c02', 'ds-all']);
    expect(run('offboard-user.sh', ['c@example.com']).code).toBe(0);
    expect(state().users['c@example.com']).toEqual({ enabled: false, signedOut: true, groups: [] });
    expect(run('offboard-user.sh', ['--delete', 'c@example.com']).code).toBe(0);
    expect(state().users['c@example.com']).toBeUndefined();
  });
});

describe('check-plan.sh', () => {
  const plan = (changes) => {
    const f = join(dir, 'plan.json');
    writeFileSync(f, JSON.stringify({ resource_changes: changes }));
    return f;
  };
  const rc = (address, type, actions) => ({ address, type, change: { actions } });
  it('passes updates and creates', () => {
    const r = run('check-plan.sh', ['--json', plan([
      rc('module.site.aws_cloudfront_distribution.this', 'aws_cloudfront_distribution', ['update']),
      rc('module.identity.aws_cognito_user_pool_client.app', 'aws_cognito_user_pool_client', ['delete', 'create']),
      rc('module.site.aws_s3_bucket.app', 'aws_s3_bucket', ['delete', 'create']),
      rc('aws_ssm_parameter.config', 'aws_ssm_parameter', ['create']),
    ])]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('OK');
  });
  for (const [addr, type] of [
    ['module.site.aws_cloudfront_distribution.this', 'aws_cloudfront_distribution'],
    ['module.identity.aws_cognito_user_pool.this', 'aws_cognito_user_pool'],
    ['module.identity.aws_cognito_user_pool_domain.this', 'aws_cognito_user_pool_domain'],
    ['module.edge.aws_cloudfront_key_value_store.session', 'aws_cloudfront_key_value_store'],
    ['module.site.aws_s3_bucket.data', 'aws_s3_bucket'],
    ['aws_s3_bucket.state', 'aws_s3_bucket'],
  ]) {
    it(`fails on replace/delete of ${addr}`, () => {
      for (const actions of [['delete', 'create'], ['create', 'delete'], ['delete']]) {
        const r = run('check-plan.sh', ['--json', plan([rc(addr, type, actions)])]);
        expect(r.code).toBe(1);
        expect(r.err).toContain(addr);
      }
    });
  }
});

// Runtime configuration, read from a single SSM String parameter (JSON).
// Reading it at runtime (instead of env vars) breaks the Terraform dependency cycle
// distribution -> function URL -> function -> (client id, distribution domain): plan v2 §4.4.
import { DATASET_RE } from '../../../edge/session-core.js';

export interface DatasetRepo {
  repo: string; // owner/name
  file: string; // questions.json inside the repo
}

export interface InviteLinksConfig {
  tableName: string;
  defaultTtlHours: number;
  maxTtlHours: number;
  defaultMaxUses: number;
  maxMaxUses: number;
  retentionDays: number;
  /** Per-IP limit on POST /auth/join: at most `attempts` per `windowSeconds`. */
  joinRateLimit: { attempts: number; windowSeconds: number };
}

export interface Config {
  userPoolId: string;
  clientId: string;
  cognitoDomain: string; // host only, e.g. quizzer-xxxx.auth.eu-central-1.amazoncognito.com
  region: string;
  appHosts: string[]; // first entry = canonical app host (custom domain or the CloudFront domain)
  datasets: string[];
  sessionTtlSeconds: number;
  refreshCookieDays: number;
  /** Admin-only: where each dataset lives, for the in-app editor (M7/P1). */
  datasetRepos?: Record<string, DatasetRepo>;
  /** Absent = the invite-link feature is disabled. */
  inviteLinks?: InviteLinksConfig;
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FILE_RE = /^[A-Za-z0-9._/-]+$/;
const TABLE_NAME_RE = /^[A-Za-z0-9_.-]{3,255}$/;

function parseInviteLinks(raw: unknown): InviteLinksConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.inviteLinks must be an object');
  const o = raw as Record<string, unknown>;
  const posInt = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`config.inviteLinks.${name} must be a positive integer`);
    return v;
  };
  if (typeof o.tableName !== 'string' || !TABLE_NAME_RE.test(o.tableName)) throw new Error('config.inviteLinks.tableName invalid');
  const rl = o.joinRateLimit as Record<string, unknown> | null | undefined;
  if (!rl || typeof rl !== 'object' || Array.isArray(rl)) throw new Error('config.inviteLinks.joinRateLimit must be an object');
  const cfg: InviteLinksConfig = {
    tableName: o.tableName,
    defaultTtlHours: posInt(o.defaultTtlHours, 'defaultTtlHours'),
    maxTtlHours: posInt(o.maxTtlHours, 'maxTtlHours'),
    defaultMaxUses: posInt(o.defaultMaxUses, 'defaultMaxUses'),
    maxMaxUses: posInt(o.maxMaxUses, 'maxMaxUses'),
    retentionDays: posInt(o.retentionDays, 'retentionDays'),
    joinRateLimit: { attempts: posInt(rl.attempts, 'joinRateLimit.attempts'), windowSeconds: posInt(rl.windowSeconds, 'joinRateLimit.windowSeconds') },
  };
  if (cfg.defaultTtlHours > cfg.maxTtlHours) throw new Error('config.inviteLinks.defaultTtlHours exceeds maxTtlHours');
  if (cfg.defaultMaxUses > cfg.maxMaxUses) throw new Error('config.inviteLinks.defaultMaxUses exceeds maxMaxUses');
  return cfg;
}

export function parseConfig(raw: string): Config {
  const c = JSON.parse(raw) as Partial<Config>;
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`config.${name} missing`);
    return v;
  };
  const appHosts = c.appHosts;
  if (!Array.isArray(appHosts) || appHosts.length === 0 || !appHosts.every((h) => typeof h === 'string' && HOST_RE.test(h))) {
    throw new Error('config.appHosts must be a non-empty list of host names');
  }
  const datasets = c.datasets ?? [];
  if (!Array.isArray(datasets) || !datasets.every((d) => typeof d === 'string' && DATASET_RE.test(d))) {
    throw new Error('config.datasets invalid');
  }
  const cognitoDomain = str(c.cognitoDomain, 'cognitoDomain');
  if (!HOST_RE.test(cognitoDomain)) throw new Error('config.cognitoDomain must be a host name');
  const ttl = c.sessionTtlSeconds ?? 1800;
  const days = c.refreshCookieDays ?? 30;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new Error('config.sessionTtlSeconds out of range');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('config.refreshCookieDays out of range');

  let datasetRepos: Record<string, DatasetRepo> | undefined;
  if (c.datasetRepos !== undefined) {
    const raw = c.datasetRepos;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.datasetRepos must be an object');
    datasetRepos = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!DATASET_RE.test(id)) throw new Error(`config.datasetRepos: invalid dataset id "${id}"`);
      const entry = value as Partial<DatasetRepo> | null;
      if (
        !entry ||
        typeof entry.repo !== 'string' ||
        !REPO_RE.test(entry.repo) ||
        typeof entry.file !== 'string' ||
        !FILE_RE.test(entry.file) ||
        entry.file.includes('..')
      ) {
        throw new Error(`config.datasetRepos["${id}"] must be {repo: "owner/name", file: "questions.json"}`);
      }
      datasetRepos[id] = { repo: entry.repo, file: entry.file };
    }
  }

  const inviteLinks = c.inviteLinks === undefined ? undefined : parseInviteLinks(c.inviteLinks);

  return {
    userPoolId: str(c.userPoolId, 'userPoolId'),
    clientId: str(c.clientId, 'clientId'),
    cognitoDomain,
    region: str(c.region, 'region'),
    appHosts,
    datasets: [...datasets].sort(),
    sessionTtlSeconds: ttl,
    refreshCookieDays: days,
    ...(datasetRepos ? { datasetRepos } : {}),
    ...(inviteLinks ? { inviteLinks } : {}),
  };
}

export type ParameterReader = (name: string) => Promise<string>;

export function createConfigLoader(read: ParameterReader, name: string, now: () => number, ttlMs = 5 * 60_000) {
  let cached: { value: Config; at: number } | null = null;
  return async function getConfig(): Promise<Config> {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const value = parseConfig(await read(name));
    cached = { value, at: now() };
    return value;
  };
}

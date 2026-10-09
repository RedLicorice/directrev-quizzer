// Runtime configuration, read from a single SSM String parameter (JSON).
// Reading it at runtime (instead of env vars) breaks the Terraform dependency cycle
// distribution -> function URL -> function -> (client id, distribution domain): plan v2 §4.4.
import { DATASET_RE } from '../../../edge/session-core.js';

export interface Config {
  userPoolId: string;
  clientId: string;
  cognitoDomain: string; // host only, e.g. quizzer-xxxx.auth.eu-central-1.amazoncognito.com
  region: string;
  appHosts: string[]; // first entry = canonical app host (the CloudFront domain)
  datasets: string[];
  sessionTtlSeconds: number;
  refreshCookieDays: number;
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

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
  return {
    userPoolId: str(c.userPoolId, 'userPoolId'),
    clientId: str(c.clientId, 'clientId'),
    cognitoDomain,
    region: str(c.region, 'region'),
    appHosts,
    datasets: [...datasets].sort(),
    sessionTtlSeconds: ttl,
    refreshCookieDays: days,
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

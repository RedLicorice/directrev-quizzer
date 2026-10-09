// Type declarations for session-core.js (shared with the auth Lambda).
export interface SessionClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name?: string;
  ds: string[];
  adm: boolean;
  iat: number;
  exp: number;
}
export interface ParsedToken {
  kid: string;
  signingInput: string;
  sig: string;
  claims: Record<string, unknown>;
}
export type Hmac = (key: string, data: string) => string;
export type Decision = 'allow' | 'unauthenticated' | 'forbidden' | 'bad';
export const SESSION_COOKIE: string;
export const ISSUER: string;
export const AUDIENCE: string;
export const KID_RE: RegExp;
export const DATASET_RE: RegExp;
export const KVS_CURRENT: string;
export const KVS_KEY_PREFIX: string;
export function readCookie(header: string | undefined | null, name: string): string | null;
export function parseToken(token: unknown): ParsedToken | null;
export function safeEqual(a: unknown, b: unknown): boolean;
export function checkToken(parsed: ParsedToken | null, key: string | null, hmac: Hmac, now: number): SessionClaims | null;
export function verifySession(token: unknown, getKey: (kid: string) => string | null, hmac: Hmac, now: number): SessionClaims | null;
export function signSession(claims: object, kid: string, key: string, hmac: Hmac): string;
export function classifyPath(uri: string): { kind: 'bad' | 'public' | 'session' | 'dataset' | 'admin-only'; id?: string };
export function authorize(uri: string, claims: SessionClaims | null): Decision;

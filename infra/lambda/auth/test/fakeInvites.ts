// In-memory doubles for the invite-link store and the Cognito account creator. The store keeps
// the DynamoDB conditional-update semantics (check and write in one synchronous step).
import type { AccountCreator } from '../src/accounts.js';
import { inviteStatus, type InviteItem, type InviteStore } from '../src/inviteStore.js';
import type { InviteLinksConfig } from '../src/config.js';

export const INVITE_LINKS: InviteLinksConfig = {
  tableName: 'quizzer-test-invite-links',
  defaultTtlHours: 168,
  maxTtlHours: 720,
  defaultMaxUses: 1,
  maxMaxUses: 50,
  retentionDays: 30,
  joinRateLimit: { attempts: 5, windowSeconds: 600 },
};

const tick = () => new Promise<void>((r) => setTimeout(r, Math.random() * 3));

export class FakeInviteStore implements InviteStore {
  items = new Map<string, InviteItem>();
  releases = 0;

  async create(item: InviteItem) {
    if (this.items.has(item.id)) throw new Error('exists');
    this.items.set(item.id, { ...item });
  }
  async get(id: string) {
    const i = this.items.get(id);
    return i ? { ...i } : null;
  }
  async list() {
    return [...this.items.values()].map((i) => ({ ...i }));
  }
  async revoke(id: string, nowMs: number) {
    const i = this.items.get(id);
    if (!i) return false;
    i.revokedAt ??= nowMs;
    return true;
  }
  async redeem(id: string, nowMs: number) {
    await tick();
    const i = this.items.get(id);
    if (!i || inviteStatus(i, nowMs) !== 'active') return false;
    i.uses += 1;
    return true;
  }
  async release(id: string) {
    const i = this.items.get(id);
    if (i && i.uses > 0) i.uses -= 1;
    this.releases++;
  }
}

export class FakeAccounts implements AccountCreator {
  created: { email: string; password: string }[] = [];
  existing = new Set<string>();
  /** Makes the next create() fail with an error of that name. */
  failWith?: { name: string; message: string };

  async create(email: string, password: string) {
    if (this.failWith) {
      const e = new Error(this.failWith.message);
      e.name = this.failWith.name;
      this.failWith = undefined;
      throw e;
    }
    if (this.existing.has(email.toLowerCase())) {
      const e = new Error('An account with the given email already exists.');
      e.name = 'UsernameExistsException';
      throw e;
    }
    if (password.length < 12) {
      const e = new Error('Password did not conform with policy: Password not long enough');
      e.name = 'InvalidPasswordException';
      throw e;
    }
    this.existing.add(email.toLowerCase());
    this.created.push({ email, password });
  }
}

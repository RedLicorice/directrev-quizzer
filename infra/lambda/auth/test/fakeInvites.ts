// In-memory doubles for the campaign store, the user-origin store and the Cognito account creator.
// The campaign store keeps the DynamoDB conditional-update semantics (check and write in one
// synchronous step, after a random delay so concurrent callers interleave).
import type { AccountCreator } from '../src/accounts.js';
import { CAMPAIGN_ID_RE, campaignStatus, type CampaignChanges, type CampaignItem, type CampaignStore } from '../src/inviteStore.js';
import type { OriginItem, OriginStore } from '../src/originStore.js';
import type { InviteLinksConfig } from '../src/config.js';

export const INVITE_LINKS: InviteLinksConfig = {
  tableName: 'quizzer-test-invite-links',
  originTableName: 'quizzer-test-user-origin',
  defaultTtlHours: 168,
  maxTtlHours: 720,
  defaultMaxUses: 1,
  maxMaxUses: 50,
  nameMaxLength: 60,
  publicNoteMaxLength: 500,
  internalNoteMaxLength: 200,
  joinDescription: 'Test description of the app.',
  joinRateLimit: { attempts: 5, windowSeconds: 600 },
};

const tick = () => new Promise<void>((r) => setTimeout(r, Math.random() * 3));

export class FakeCampaignStore implements CampaignStore {
  items = new Map<string, CampaignItem>();
  releases = 0;

  async create(item: CampaignItem) {
    if (this.items.has(item.id)) throw new Error('exists');
    this.items.set(item.id, { ...item });
  }
  async get(id: string) {
    const i = this.items.get(id);
    return i ? { ...i } : null;
  }
  async list() {
    return [...this.items.values()].filter((i) => CAMPAIGN_ID_RE.test(i.id)).map((i) => ({ ...i }));
  }
  async update(id: string, changes: CampaignChanges, nowMs: number) {
    const i = this.items.get(id);
    if (!i) return { ok: false as const, reason: 'not_found' as const };
    if (changes.maxUses !== undefined && changes.maxUses < i.uses) return { ok: false as const, reason: 'max_uses_below_uses' as const };
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) delete (i as unknown as Record<string, unknown>)[k];
      else (i as unknown as Record<string, unknown>)[k] = v;
    }
    i.updatedAt = nowMs;
    return { ok: true as const, item: { ...i } };
  }
  async delete(id: string) {
    this.items.delete(id);
  }
  async redeem(id: string, nowMs: number) {
    await tick();
    const i = this.items.get(id);
    if (!i || campaignStatus(i, nowMs) !== 'active') return null;
    i.uses += 1;
    return { ...i };
  }
  async release(id: string) {
    const i = this.items.get(id);
    if (i && i.uses > 0) i.uses -= 1;
    this.releases++;
  }
}

export class FakeOriginStore implements OriginStore {
  items = new Map<string, OriginItem>();
  /** Makes put() reject (the registration must survive it). */
  failPut = false;
  async put(item: OriginItem) {
    if (this.failPut) throw new Error('dynamo down');
    this.items.set(item.username, { ...item });
  }
  async getMany(usernames: string[]) {
    return new Map(usernames.flatMap((u) => (this.items.has(u) ? [[u, this.items.get(u)!] as const] : [])));
  }
}

export class FakeAccounts implements AccountCreator {
  created: { email: string; password: string; username: string }[] = [];
  existing = new Set<string>();
  /** Makes the next create() fail with an error of that name. */
  failWith?: { name: string; message: string };

  /** The Cognito Username of a user is a generated id, not the e-mail. */
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
    const username = `uuid-${this.created.length + 1}`;
    this.created.push({ email, password, username });
    return username;
  }
}

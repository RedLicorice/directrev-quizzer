import { describe, it, expect } from 'vitest';
import { validateLinkForm, formatRemaining, hasNoAccess, NOTE_MAX_LENGTH, STATUS_LABEL, STATUS_CLASS } from '../src/aws/admin/inviteLinks';
import { errorText, AdminApiError } from '../src/aws/admin/adminApi';
import type { InviteLinkDefaults } from '../src/aws/admin/adminApi';

const LIMITS: InviteLinkDefaults = { ttlHours: 24, maxTtlHours: 100, maxUses: 2, maxMaxUses: 10 };
const form = (o: Partial<{ ttlHours: string; maxUses: string; note: string }> = {}) =>
  validateLinkForm({ ttlHours: '24', maxUses: '2', note: '', ...o }, LIMITS);

describe('validateLinkForm', () => {
  it('accepts values within the server limits and trims the note', () => {
    expect(form({ note: '  corso  ' })).toEqual({ ok: true, value: { ttlHours: 24, maxUses: 2, note: 'corso' } });
    expect(form({ ttlHours: '100', maxUses: '10' })).toEqual({ ok: true, value: { ttlHours: 100, maxUses: 10 } });
  });
  it.each(['0', '101', '-1', '1.5', 'abc', ''])('rejects ttlHours %j', (v) => {
    expect(form({ ttlHours: v }).ok).toBe(false);
  });
  it.each(['0', '11', '2.5', ''])('rejects maxUses %j', (v) => {
    expect(form({ maxUses: v }).ok).toBe(false);
  });
  it('rejects a note longer than the limit', () => {
    expect(form({ note: 'x'.repeat(NOTE_MAX_LENGTH) }).ok).toBe(true);
    expect(form({ note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }).ok).toBe(false);
  });
});

describe('formatRemaining', () => {
  const H = 3_600_000;
  it('formats days and hours', () => {
    expect(formatRemaining(1000, 1000)).toBe('scaduto');
    expect(formatRemaining(30 * 60_000, 0)).toBe('tra meno di 1 h');
    expect(formatRemaining(5 * H, 0)).toBe('tra 5 h');
    expect(formatRemaining(72 * H, 0)).toBe('tra 3 g');
    expect(formatRemaining(76 * H, 0)).toBe('tra 3 g 4 h');
  });
});

describe('labels and access', () => {
  it('has a label and style for every status', () => {
    for (const s of ['active', 'expired', 'exhausted', 'revoked'] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_CLASS[s]).toBeTruthy();
    }
  });
  it('flags users without groups', () => {
    expect(hasNoAccess([])).toBe(true);
    expect(hasNoAccess(['ds-all'])).toBe(false);
  });
  it('maps the new error codes to Italian text', () => {
    expect(errorText(new AdminApiError(404, 'invite_links_disabled'))).toMatch(/non sono abilitati/);
    expect(errorText(new AdminApiError(400, 'bad_request', 'ttlHours'))).toMatch(/ttlHours/);
    expect(errorText(new AdminApiError(400, 'bad_request'))).toMatch(/non valida/);
  });
});

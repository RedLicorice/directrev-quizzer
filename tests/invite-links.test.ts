import { describe, it, expect } from 'vitest';
import {
  validateCampaignForm, validateCampaignEdit, editRawFrom, reactivationPatch, toLocalInput,
  formatRemaining, hasNoAccess, originLabel, MS_PER_HOUR, STATUS_LABEL, STATUS_CLASS,
} from '../src/aws/admin/inviteLinks';
import { errorText, AdminApiError } from '../src/aws/admin/adminApi';
import type { Campaign, CampaignDefaults } from '../src/aws/admin/adminApi';

const LIMITS: CampaignDefaults = {
  ttlHours: 24, maxTtlHours: 100, maxUses: 2, maxMaxUses: 10,
  nameMaxLength: 20, publicNoteMaxLength: 50, internalNoteMaxLength: 30,
};
const form = (o: Partial<Record<'name' | 'ttlHours' | 'maxUses' | 'publicNote' | 'internalNote', string>> = {}) =>
  validateCampaignForm({ name: 'Corso', ttlHours: '24', maxUses: '2', publicNote: '', internalNote: '', ...o }, LIMITS);

describe('validateCampaignForm', () => {
  it('accepts values within the server limits and trims the texts', () => {
    expect(form({ name: '  Corso  ', publicNote: ' ciao ', internalNote: ' x ' })).toEqual({
      ok: true,
      value: { name: 'Corso', ttlHours: 24, maxUses: 2, publicNote: 'ciao', internalNote: 'x' },
    });
    expect(form({ ttlHours: '100', maxUses: '10' })).toEqual({ ok: true, value: { name: 'Corso', ttlHours: 100, maxUses: 10 } });
  });
  it.each(['0', '101', '-1', '1.5', 'abc', ''])('rejects ttlHours %j', (v) => {
    expect(form({ ttlHours: v }).ok).toBe(false);
  });
  it.each(['0', '11', '2.5', ''])('rejects maxUses %j', (v) => {
    expect(form({ maxUses: v }).ok).toBe(false);
  });
  it('requires a name and enforces the text limits from the server', () => {
    expect(form({ name: '   ' }).ok).toBe(false);
    expect(form({ name: 'x'.repeat(LIMITS.nameMaxLength) }).ok).toBe(true);
    expect(form({ name: 'x'.repeat(LIMITS.nameMaxLength + 1) }).ok).toBe(false);
    expect(form({ publicNote: 'x'.repeat(LIMITS.publicNoteMaxLength + 1) }).ok).toBe(false);
    expect(form({ internalNote: 'x'.repeat(LIMITS.internalNoteMaxLength + 1) }).ok).toBe(false);
  });
});

describe('campaign edit and reactivation', () => {
  const NOW = Date.UTC(2026, 0, 10, 12);
  const campaign = (o: Partial<Campaign> = {}): Campaign => ({
    id: 'a'.repeat(16), url: 'https://x/auth/join?c=aaaaaaaaaaaaaaaa', name: 'Corso', createdBy: 'a@b.c',
    createdAt: NOW - 10 * MS_PER_HOUR, updatedAt: NOW - 10 * MS_PER_HOUR, expiresAt: NOW + 5 * MS_PER_HOUR,
    maxUses: 5, uses: 3, enabled: true, status: 'active', ...o,
  });
  const edit = (o: Partial<ReturnType<typeof editRawFrom>>, c = campaign()) =>
    validateCampaignEdit({ ...editRawFrom(c), ...o }, c, LIMITS, NOW);

  it('sends only the changed fields; an emptied note is sent as an empty string', () => {
    expect(edit({})).toEqual({ ok: true, value: {} });
    expect(edit({ name: 'Nuovo', maxUses: '8', enabled: false })).toEqual({ ok: true, value: { name: 'Nuovo', maxUses: 8, enabled: false } });
    expect(edit({ publicNote: '' }, campaign({ publicNote: 'ciao' }))).toEqual({ ok: true, value: { publicNote: '' } });
  });
  it('refuses max uses below the uses already made', () => {
    expect(edit({ maxUses: '2' }).ok).toBe(false);
    expect(edit({ maxUses: '3' }).ok).toBe(true);
  });
  it('sends a changed expiry as epoch ms and enforces the window from the server', () => {
    const ok = edit({ expires: toLocalInput(NOW + 50 * MS_PER_HOUR) });
    expect(ok.ok && ok.value.expiresAt).toBe(new Date(toLocalInput(NOW + 50 * MS_PER_HOUR)).getTime());
    expect(edit({ expires: toLocalInput(NOW - MS_PER_HOUR) }).ok).toBe(false);
    expect(edit({ expires: toLocalInput(NOW + (LIMITS.maxTtlHours + 1) * MS_PER_HOUR) }).ok).toBe(false);
    expect(edit({ expires: '' }).ok).toBe(false);
  });
  it('reactivation fixes only what blocks the campaign', () => {
    expect(reactivationPatch(campaign({ enabled: false, status: 'disabled' }), LIMITS, NOW)).toEqual({ enabled: true });
    expect(reactivationPatch(campaign({ expiresAt: NOW - 1, status: 'expired' }), LIMITS, NOW))
      .toEqual({ enabled: true, expiresAt: NOW + LIMITS.ttlHours * MS_PER_HOUR });
    expect(reactivationPatch(campaign({ uses: 5, status: 'exhausted' }), LIMITS, NOW)).toEqual({ enabled: true, maxUses: 5 + LIMITS.maxUses });
    expect(reactivationPatch(campaign({ uses: 9, maxUses: 9 }), LIMITS, NOW).maxUses).toBe(LIMITS.maxMaxUses);
  });
});

describe('formatRemaining', () => {
  it('formats days and hours', () => {
    expect(formatRemaining(1000, 1000)).toBe('scaduto');
    expect(formatRemaining(30 * 60_000, 0)).toBe('tra meno di 1 h');
    expect(formatRemaining(5 * MS_PER_HOUR, 0)).toBe('tra 5 h');
    expect(formatRemaining(72 * MS_PER_HOUR, 0)).toBe('tra 3 g');
    expect(formatRemaining(76 * MS_PER_HOUR, 0)).toBe('tra 3 g 4 h');
  });
});

describe('labels and access', () => {
  it('has a label and style for every status', () => {
    expect(Object.values(STATUS_LABEL)).toEqual(['Attiva', 'Disattivata', 'Scaduta', 'Esaurita']);
    for (const s of ['active', 'disabled', 'expired', 'exhausted'] as const) expect(STATUS_CLASS[s]).toBeTruthy();
  });
  it('labels the user origin', () => {
    expect(originLabel(undefined)).toBe('Invitato');
    expect(originLabel({ kind: 'invited' })).toBe('Invitato');
    expect(originLabel({ kind: 'campaign', campaignId: 'x', name: 'Corso di giugno' })).toBe('Corso di giugno');
  });
  it('flags users without groups', () => {
    expect(hasNoAccess([])).toBe(true);
    expect(hasNoAccess(['ds-all'])).toBe(false);
  });
  it('maps the campaign error codes to Italian text', () => {
    expect(errorText(new AdminApiError(404, 'invite_links_disabled'))).toMatch(/non sono abilitate/);
    expect(errorText(new AdminApiError(400, 'bad_request', 'max_uses_below_uses'))).toMatch(/inferiori/);
    expect(errorText(new AdminApiError(400, 'bad_request', 'expires_at'))).toMatch(/scadenza/);
    expect(errorText(new AdminApiError(400, 'bad_request', 'ttlHours'))).toMatch(/ttlHours/);
    expect(errorText(new AdminApiError(400, 'bad_request'))).toMatch(/non valida/);
  });
});

// Per-dataset local progress (stats, notes, session history, practice draft).
// Questions themselves are never persisted locally: they always come from the
// bundled dataset or from a configured source.

/** Progress stored before multi-dataset support belongs to the bundled AWS dataset. */
export const BUNDLED_DATASET_KEY = 'aws-dva-c02';

const LEGACY: Record<string, string> = {
  quizzer_stats: 'quizzer_stats',
  quizzer_notes: 'quizzer_notes',
  quizzer_sessions: 'quizzer_sessions',
  quizzer_practice_draft: 'quizzer_practice_draft',
};

let active = BUNDLED_DATASET_KEY;

// ── per-user scope (AWS build only) ────────────────────────────────────────
// In the hosted build several colleagues may share one browser profile, so every
// progress key carries the signed-in user's `sub`. The Pages build never sets a user
// and its keys are unchanged.

let storageUser: string | null = null;

/** Called by the AuthGate once `/auth/me` has answered (AWS build only). */
export function setStorageUser(sub: string | null) { storageUser = sub; }
export function getStorageUser() { return storageUser; }

/** `u:<sub>:<key>` in the AWS build, `key` unchanged in the Pages build. */
export function userScoped(key: string): string {
  if (import.meta.env.VITE_DEPLOY === 'aws') return `u:${storageUser ?? '?'}:${key}`;
  return key;
}

function scoped(base: string) { return `${base}:${active}`; }

function migrateLegacy() {
  if (active !== BUNDLED_DATASET_KEY) return;
  try {
    for (const base of Object.keys(LEGACY)) {
      const old = localStorage.getItem(LEGACY[base]);
      if (old !== null && localStorage.getItem(scoped(base)) === null) {
        localStorage.setItem(scoped(base), old);
        localStorage.removeItem(LEGACY[base]);
      }
    }
  } catch { /* storage unavailable */ }
}

export function setActiveDataset(key: string) {
  active = key;
  migrateLegacy();
}

export function getActiveDatasetKey() { return active; }

export const statsKey = () => scoped('quizzer_stats');
export const notesKey = () => scoped('quizzer_notes');
export const sessionsKey = () => scoped('quizzer_sessions');
export const practiceDraftKey = () => scoped('quizzer_practice_draft');

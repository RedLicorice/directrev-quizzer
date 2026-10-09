// Groups -> session claims (CONTRACT.md §3 and §7).
import { DATASET_RE } from '../../../edge/session-core.js';

export function computeAccess(groups: string[]): { ds: string[]; adm: boolean } | null {
  const adm = groups.includes('admin');
  if (groups.includes('ds-all')) return { ds: ['*'], adm };
  const ids = [
    ...new Set(
      groups
        .filter((g) => g.startsWith('ds-'))
        .map((g) => g.slice(3))
        .filter((id) => DATASET_RE.test(id)),
    ),
  ].sort();
  if (ids.length > 0) return { ds: ids.slice(0, 64), adm };
  if (adm) return { ds: ['*'], adm };
  return null; // not enabled: no session
}

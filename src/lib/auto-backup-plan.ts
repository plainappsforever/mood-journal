// Automatic backup rules (SPEC "Automatic backup", D17, D18) — PURE, so Jest pins them:
// runs when the app goes to the background, the journal changed since the last automatic file, at most once per
// local day; "Back up now" always runs. Rotation deletes only older `mood-auto-*` files THIS app wrote into that
// folder (the list it keeps), never a file it did not write (e.g. another phone's files in the same iCloud folder).

export type AutoStatus =
  | { ok: true; atMs: number; day: string; name: string; files: number }
  | { ok: false; atMs: number; error: AutoError; lastOk?: { atMs: number; day: string; name: string } };

export type AutoError = 'missing' | 'access' | 'full' | 'write' | 'password' | 'create';

export type AutoState = {
  on: boolean;
  hasFolder: boolean;
  /** Last change of the journal (ms), or null if none recorded since automatic backup was turned on. */
  changedMs: number | null;
  status: AutoStatus | null;
};

/** The last successful automatic file (from an ok status, or remembered inside a failure status). */
export function lastOk(status: AutoStatus | null): { atMs: number; day: string; name: string } | null {
  if (!status) return null;
  return status.ok ? status : (status.lastOk ?? null);
}

/** Background trigger: on, a folder, not yet today, and something changed since the last automatic file. */
export function isDue(state: AutoState, today: string): boolean {
  if (!state.on || !state.hasFolder) return false;
  const last = lastOk(state.status);
  if (!last) return true; // never written into this folder: the first file is due
  if (last.day === today) return false;
  return state.changedMs !== null && state.changedMs > last.atMs;
}

export const AUTO_PREFIX = 'mood-auto-';
export const AUTO_SUFFIX = '.moodbackup';
const AUTO_NAME = /^mood-auto-\d{4}-\d{2}-\d{2}(-\d+)?\.moodbackup$/;

export const isAutoName = (name: string) => AUTO_NAME.test(name);

/** `mood-auto-YYYY-MM-DD.moodbackup`, or `…-2`, `…-3` when that name is already in the folder (never overwrite). */
export function autoFileName(day: string, present: readonly string[]): string {
  const taken = new Set(present);
  const base = `${AUTO_PREFIX}${day}`;
  if (!taken.has(base + AUTO_SUFFIX)) return base + AUTO_SUFFIX;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}${AUTO_SUFFIX}`)) return `${base}-${n}${AUTO_SUFFIX}`;
}

/**
 * Rotation. `written` = names this app wrote into the folder, oldest first; `present` = names in the folder now;
 * `keep` = how many to keep (0 = keep all). Returns the files to delete and the new `written` list (files that
 * are gone from the folder are forgotten).
 */
export function rotation(written: readonly string[], present: readonly string[], keep: number): { remove: string[]; written: string[] } {
  const here = new Set(present);
  const ours = written.filter((n, i) => isAutoName(n) && here.has(n) && written.indexOf(n) === i);
  if (keep <= 0 || ours.length <= keep) return { remove: [], written: ours };
  const cut = ours.length - keep;
  return { remove: ours.slice(0, cut), written: ours.slice(cut) };
}

export const KEEP_CHOICES = [5, 10, 30, 0] as const;
export const DEFAULT_KEEP = 10;

/** Generated password for automatic backups: 20 letters/digits without look-alikes, in groups of 4 (≈ 99 bits). */
export function generatePassword(random: Uint8Array): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 symbols, no i l o 0 1
  const out: string[] = [];
  let i = 0;
  while (out.length < 20) {
    if (i >= random.length) throw new Error('not enough random bytes');
    const b = random[i++];
    if (b >= 248) continue; // 248 = 31 × 8: uniform
    out.push(alphabet[b % 31]);
  }
  return [0, 4, 8, 12, 16].map((s) => out.slice(s, s + 4).join('')).join('-');
}

/** Short code of a native/file error message (iOS module codes, Android SAF exceptions). */
export function errorCode(message: string): AutoError {
  const m = message.toLowerCase();
  if (/\bfull\b|enospc|no space|out of space/.test(m)) return 'full';
  if (/\bmissing\b|not found|does not exist|no such file|filenotfound/.test(m)) return 'missing';
  if (/\baccess\b|permission|securityexception|not permitted|denied/.test(m)) return 'access';
  return 'write';
}

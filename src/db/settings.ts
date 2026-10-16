import type { WeekStart } from '@/engine/dates';

import { withRead, withWrite } from './tx';
import type { Db } from './types';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await withRead(db, (r) =>
    r.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
  );
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await withWrite(db, (tx) =>
    tx.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    )
  );
}

export async function getThemePreference(db: Db): Promise<ThemePreference> {
  const value = await getSetting(db, THEME_KEY);
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
}

export function setThemePreference(db: Db, theme: ThemePreference): Promise<void> {
  return setSetting(db, THEME_KEY, theme);
}

// Mood settings (SPEC Data model `settings`). Stored as text; read with a default and a range check, so a damaged or
// missing value never breaks a screen.
export type JournalSettings = {
  weekStart: WeekStart;
  /** "My day ends at" 0 (midnight) … 4 (D29). */
  dayEndHour: number;
  reminderSkipIfLogged: boolean;
  /** The user's own reminder text; '' = the default "How was your day?". */
  reminderText: string;
  lockEnabled: boolean;
  lockAfterS: number;
  /** Automatic backups kept: 5 / 10 / 30 / 0 = keep all. */
  backupKeep: number;
  backupEncrypt: boolean;
};

export const SETTING_DEFAULTS: JournalSettings = {
  weekStart: 1,
  dayEndHour: 0,
  reminderSkipIfLogged: true,
  reminderText: '',
  lockEnabled: false,
  lockAfterS: 60,
  backupKeep: 10,
  backupEncrypt: true,
};

const KEYS: Record<keyof JournalSettings, string> = {
  weekStart: 'week_start',
  dayEndHour: 'day_end_hour',
  reminderSkipIfLogged: 'reminder_skip_if_logged',
  reminderText: 'reminder_text',
  lockEnabled: 'lock_enabled',
  lockAfterS: 'lock_after_s',
  backupKeep: 'backup_keep',
  backupEncrypt: 'backup_encrypt',
};

function decode<K extends keyof JournalSettings>(key: K, raw: string | undefined): JournalSettings[K] {
  const fallback = SETTING_DEFAULTS[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  const ok = (v: unknown) => v as JournalSettings[K];
  switch (key) {
    case 'weekStart':
      return [1, 6, 7].includes(n) ? ok(n) : fallback;
    case 'dayEndHour':
      return Number.isInteger(n) && n >= 0 && n <= 4 ? ok(n) : fallback;
    case 'lockAfterS':
      return Number.isInteger(n) && n >= 0 ? ok(n) : fallback;
    case 'backupKeep':
      return [0, 5, 10, 30].includes(n) ? ok(n) : fallback;
    case 'reminderText':
      return ok(raw);
    default:
      return raw === '1' ? ok(true) : raw === '0' ? ok(false) : fallback;
  }
}

function encode(value: JournalSettings[keyof JournalSettings]): string {
  return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
}

export async function getJournalSettings(db: Db): Promise<JournalSettings> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings'));
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const out = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(KEYS) as (keyof JournalSettings)[]) {
    (out as Record<string, unknown>)[key] = decode(key, map.get(KEYS[key]));
  }
  return out;
}

export async function setJournalSetting<K extends keyof JournalSettings>(db: Db, key: K, value: JournalSettings[K]): Promise<void> {
  if (decode(key, encode(value)) !== value) throw new Error(`invalid value for ${key}: ${String(value)}`);
  await setSetting(db, KEYS[key], encode(value));
}

// Automatic backup into a folder the user picked (SPEC flow 7, "Automatic backup", A7, D17, D18). Same file as a
// manual backup, named mood-auto-YYYY-MM-DD.moodbackup, ENCRYPTED by default with a password kept in the keychain /
// keystore (expo-secure-store) so it runs unattended. Runs when the app goes to the background (rules in
// auto-backup-plan.ts) and on "Back up now". The database is only read; a failure only writes the status line.
// All keys are device-only settings (`backup_folder*`, `backup_last*`): a restore never copies them (D43).
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { AppState } from 'react-native';

import { getSetting, setSetting } from '@/db/settings';
import { withWrite } from '@/db/tx';
import type { Db } from '@/db/types';
import { autoFileName, DEFAULT_KEEP, generatePassword, isAutoName, isDue, lastOk, rotation, type AutoError, type AutoStatus } from '@/lib/auto-backup-plan';
import { createBackup } from '@/lib/backup-io';
import { checkFolder, deleteFromFolder, FolderError, inBackgroundTime, listFolder, writeIntoFolder, type Folder } from '@/lib/backup-folder';
import { calendarToday, now } from '@/lib/clock';
import { subscribeJournal } from '@/lib/journal-store';

const K = {
  folder: 'backup_folder',
  on: 'backup_folder_on',
  keep: 'backup_folder_keep',
  encrypt: 'backup_folder_encrypt',
  written: 'backup_folder_written',
  status: 'backup_last_auto',
  changed: 'backup_last_change_ms',
} as const;
const PASSWORD_KEY = 'mood.autoBackupPassword';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export type AutoConfig = { on: boolean; folder: Folder | null; keep: number; encrypt: boolean; status: AutoStatus | null; changedMs: number | null };

const parse = <T>(v: string | null): T | null => {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

export async function readAutoConfig(db: Db): Promise<AutoConfig> {
  const [on, folder, keep, encrypt, status, changed] = await Promise.all([K.on, K.folder, K.keep, K.encrypt, K.status, K.changed].map((k) => getSetting(db, k)));
  return {
    on: on === '1',
    folder: parse<Folder>(folder),
    keep: keep === null ? DEFAULT_KEEP : Number(keep),
    encrypt: encrypt !== '0',
    status: parse<AutoStatus>(status),
    changedMs: changed === null ? null : Number(changed),
  };
}

// --- status listeners (the Backup screen and the dot on More) --------------------------------------------------
const listeners = new Set<() => void>();
let statusVersion = 0;
export const autoStatusVersion = () => statusVersion;
export function subscribeAutoStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const notify = () => {
  statusVersion++;
  listeners.forEach((l) => l());
};

// --- password ----------------------------------------------------------------------------------------------------
export const newAutoPassword = () => generatePassword(getRandomBytes(64));
export const readAutoPassword = () => SecureStore.getItemAsync(PASSWORD_KEY, STORE_OPTIONS);

// --- settings ------------------------------------------------------------------------------------------------------
/** Turns automatic backup on for `folder` (password null = plain files). */
export async function enableAutoBackup(db: Db, folder: Folder, password: string | null): Promise<void> {
  if (password) await SecureStore.setItemAsync(PASSWORD_KEY, password, STORE_OPTIONS);
  else await SecureStore.deleteItemAsync(PASSWORD_KEY, STORE_OPTIONS);
  const before = await readAutoConfig(db);
  const sameFolder = before.folder?.id === folder.id;
  await withWrite(db, async (tx) => {
    await setSetting(tx, K.folder, JSON.stringify(folder));
    await setSetting(tx, K.encrypt, password ? '1' : '0');
    await setSetting(tx, K.on, '1');
    if (!sameFolder) {
      await setSetting(tx, K.written, '[]');
      await tx.runAsync('DELETE FROM settings WHERE key = ?', K.status); // a new folder starts without a status
    }
  });
  notify();
}

export async function changeAutoFolder(db: Db, folder: Folder): Promise<void> {
  await withWrite(db, async (tx) => {
    await setSetting(tx, K.folder, JSON.stringify(folder));
    await setSetting(tx, K.written, '[]');
    await tx.runAsync('DELETE FROM settings WHERE key = ?', K.status);
  });
  notify();
}

export async function disableAutoBackup(db: Db): Promise<void> {
  await setSetting(db, K.on, '0');
  notify();
}

export async function setAutoKeep(db: Db, keep: number): Promise<void> {
  await setSetting(db, K.keep, String(keep));
  notify();
}

// --- the run -------------------------------------------------------------------------------------------------------
let running: Promise<AutoStatus | null> | null = null;

/** One automatic backup. `force` = "Back up now" (ignores the once-a-day rule). Returns the new status, or null if not due. */
export function runAutoBackup(db: Db, force: boolean): Promise<AutoStatus | null> {
  if (running) return running;
  running = (async () => {
    try {
      return await runOnce(db, force);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce(db: Db, force: boolean): Promise<AutoStatus | null> {
  const config = await readAutoConfig(db);
  const today = calendarToday();
  if (!config.on || !config.folder) return null;
  if (!force && !isDue({ on: config.on, hasFolder: true, changedMs: config.changedMs, status: config.status }, today)) return null;
  const started = now();
  let folder = config.folder;
  let status: AutoStatus;
  try {
    const refreshed = await checkFolder(folder);
    if (refreshed) folder = refreshed;
    let password: string | null = null;
    if (config.encrypt) {
      password = await readAutoPassword();
      if (!password) throw new FolderError('password', 'password missing from the keychain');
    }
    const present = await listFolder(folder);
    const name = autoFileName(today, present);
    let built;
    try {
      built = await createBackup(db, password, name);
    } catch (e) {
      throw new FolderError('create', e instanceof Error ? e.message : String(e));
    }
    const renewed = await writeIntoFolder(folder, built.file, name);
    if (renewed) folder = renewed;
    // Rotation: only files this app wrote into this folder, oldest first.
    const written = [...(parse<string[]>(await getSetting(db, K.written)) ?? []), name];
    const after = [...present, name];
    const plan = rotation(written, after, config.keep);
    let kept = plan.written;
    for (const old of plan.remove) {
      if (!isAutoName(old)) continue;
      try {
        await deleteFromFolder(folder, old);
      } catch (e) {
        console.warn('auto-backup rotation', e);
        kept = [old, ...kept]; // try again next time
      }
    }
    const files = after.filter((n) => isAutoName(n) && !plan.remove.includes(n)).length;
    status = { ok: true, atMs: now(), day: today, name, files };
    await withWrite(db, async (tx) => {
      await setSetting(tx, K.written, JSON.stringify(kept));
      if (folder !== config.folder) await setSetting(tx, K.folder, JSON.stringify(folder));
      await setSetting(tx, K.status, JSON.stringify(status));
    });
    console.log(`[auto-backup] ${name} ${built.bytes} bytes, ${files} automatic files, ${now() - started} ms`);
  } catch (e) {
    const error: AutoError = e instanceof FolderError ? e.code : 'write';
    console.warn('[auto-backup] failed', error, e);
    const last = lastOk(config.status);
    status = { ok: false, atMs: now(), error, ...(last ? { lastOk: { atMs: last.atMs, day: last.day, name: last.name } } : {}) };
    await setSetting(db, K.status, JSON.stringify(status));
  }
  notify();
  return status;
}

// --- start-up glue ---------------------------------------------------------------------------------------------------
let started = false;

/** Marks journal changes, and runs a due automatic backup each time the app goes to the background. */
export function startAutoBackup(db: Db): void {
  if (started) return;
  started = true;
  subscribeJournal(() => {
    setSetting(db, K.changed, String(now())).catch((e) => console.warn('auto-backup change mark', e));
  });
  AppState.addEventListener('change', (state) => {
    if (state !== 'background') return;
    inBackgroundTime(() => runAutoBackup(db, false)).catch((e) => console.warn('auto-backup', e));
  });
}

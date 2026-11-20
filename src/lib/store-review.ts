// The rating prompt (redesign R1): asked once per app version, only after real use: the tenth entry written in the app.
// Never while an entry is being written and never on a first launch (nobody has ten entries then). Home calls this when
// it comes into focus. Imported and restored entries do not count. The "asked in version X" flag lives in the keychain /
// Keystore (expo-secure-store), not in the database, so it is never part of a backup file.
import * as SecureStore from 'expo-secure-store';

import { withRead } from '@/db/tx';
import type { Db } from '@/db/types';

export const REVIEW_AFTER_ENTRIES = 10;
const KEY = 'review_asked_version';

export type FlagStore = { get: () => Promise<string | null>; set: (version: string) => Promise<void> };

export const secureFlagStore: FlagStore = {
  get: () => SecureStore.getItemAsync(KEY).catch(() => null),
  set: (version) => SecureStore.setItemAsync(KEY, version),
};

/** Entries written in the app itself (source 'app'). */
export async function writtenEntryCount(db: Db): Promise<number> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM entries WHERE source = 'app'"));
  return row?.n ?? 0;
}

/** True when the prompt is due: enough own entries and not yet asked in this version. */
export async function reviewDue(db: Db, version: string, store: FlagStore = secureFlagStore): Promise<boolean> {
  if ((await store.get()) === version) return false;
  return (await writtenEntryCount(db)) >= REVIEW_AFTER_ENTRIES;
}

/** Asks at most once per version. `ask` is the system prompt (expo-store-review); it may refuse silently. Returns whether it asked. */
export async function maybeAskForReview(db: Db, version: string, ask: () => Promise<void>, store: FlagStore = secureFlagStore): Promise<boolean> {
  if (!(await reviewDue(db, version, store))) return false;
  // the flag first: if the system sheet crashes or is dismissed, the person is still not asked twice
  await store.set(version).catch(() => undefined);
  await ask().catch(() => undefined);
  return true;
}

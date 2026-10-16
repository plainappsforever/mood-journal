// All entries as engine input, read once per journal version and shared by Calendar, Stats and the detail screens
// (one query for 20k entries instead of one per screen).
import { listStatEntries, type StatEntry } from '@/db/entries';
import type { Db } from '@/db/types';
import { journalVersion } from '@/lib/journal-store';

let cached: { version: number; entries: Promise<StatEntry[]> } | null = null;

export function statEntries(db: Db): Promise<StatEntry[]> {
  const version = journalVersion();
  if (!cached || cached.version !== version) {
    const entries = listStatEntries(db);
    cached = { version, entries };
    entries.catch(() => {
      if (cached?.entries === entries) cached = null;
    });
  }
  return cached.entries;
}

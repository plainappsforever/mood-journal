// Daylio import glue (SPEC flow 6, D22, D47, D55): read the picked file with the pure engines, plan with the user's
// level mapping, then store photos and apply the plan in ONE transaction (src/db/import.ts). Never edits or deletes
// existing entries; a re-import adds nothing.
import { listMoods } from '@/db/moods';
import type { PhotoInput } from '@/db/entries';
import { applyImportPlan, readExistingJournal, type ImportResult } from '@/db/import';
import type { Db } from '@/db/types';
import { readDaylioBackup } from '@/engine/daylio-backup';
import { ImportError, MAX_IMPORT_BYTES, type ImportSource } from '@/engine/daylio-common';
import { readDaylioCsv } from '@/engine/daylio-csv';
import { cachedOffsetFn } from '@/engine/dates';
import { planImport, type ImportPlan } from '@/engine/import-plan';
import { calendarToday, now, offsetAt } from '@/lib/clock';
import { storePhotoBytes } from '@/lib/photos';

/** Lower-case mood name → level of the journal's moods (pre-fills the mapping). */
async function knownNames(db: Db): Promise<Map<string, number>> {
  return new Map((await listMoods(db, { includeArchived: true })).map((m) => [m.name.toLowerCase(), m.level]));
}

export async function readImportFile(db: Db, bytes: Uint8Array): Promise<ImportSource> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError('tooLarge');
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return readDaylioBackup(bytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError('notZip', 'neither ZIP nor UTF-8 text');
  }
  return readDaylioCsv(text, await knownNames(db));
}

export async function planFor(db: Db, source: ImportSource, levels: ReadonlyMap<string, number>, groupName: string): Promise<ImportPlan> {
  const existing = await readExistingJournal(db, source.kind);
  return planImport(source, existing, { levels, today: calendarToday(), offsetAt: cachedOffsetFn(offsetAt()), importGroupName: groupName });
}

export async function applyImport(db: Db, plan: ImportPlan, fileName: string): Promise<ImportResult & { ms: number }> {
  const started = Date.now();
  const photoRows = new Map<number, PhotoInput[]>();
  for (const [i, e] of plan.entries.entries()) {
    if (!e.photos.length) continue;
    const list: PhotoInput[] = [];
    for (const p of e.photos.slice(0, 3)) list.push(await storePhotoBytes(p.bytes));
    photoRows.set(i, list);
  }
  const result = await applyImportPlan(db, plan, { now: now(), fileName, photoRows });
  return { ...result, ms: Date.now() - started };
}

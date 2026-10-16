/**
 * @jest-environment node
 */
// Import end to end (engine plan → one transaction) on the TUNING fixtures (D24).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../../test/node-sqlite-db';

import { zoneOffsetFn } from '@/engine/dates';
import { readDaylioBackup } from '@/engine/daylio-backup';
import { readDaylioCsv } from '@/engine/daylio-csv';
import { MappingNeededError, planImport } from '@/engine/import-plan';
import { BACKUP_V15, buildDaylioZip, PHOTO_BYTES } from '@/engine/__fixtures__/daylio/build-backup';

import { listActivities, listGroups } from './activities';
import { listStatEntries } from './entries';
import { applyImportPlan, readExistingJournal } from './import';
import { migrate } from './migrations';
import { listMoods } from './moods';
import { seedDefaults } from './seed';
import type { Db } from './types';

const berlin = zoneOffsetFn('Europe/Berlin');
const TODAY = '2026-10-16';
const csv = (name: string) => readFileSync(join(__dirname, '../engine/__fixtures__/daylio', name), 'utf8');

async function journal(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  await seedDefaults(db, 'en', 1);
  return db;
}

async function knownNames(db: Db) {
  return new Map((await listMoods(db, { includeArchived: true })).map((m) => [m.name.toLowerCase(), m.level]));
}

const levels = (source: { moods: { ref: string; proposedLevel: number | null }[] }, overrides: Record<string, number> = {}) =>
  new Map(source.moods.map((m) => [m.ref, overrides[m.ref] ?? m.proposedLevel ?? 3]));

const options = (source: Parameters<typeof levels>[0], overrides?: Record<string, number>) => ({
  levels: levels(source, overrides),
  today: TODAY,
  offsetAt: berlin,
  importGroupName: 'Imported from Daylio',
});

describe('Daylio CSV → journal', () => {
  it('needs a confirmed level for every unknown mood name', async () => {
    const db = await journal();
    const source = readDaylioCsv(csv('current-12h.csv'), await knownNames(db));
    const existing = await readExistingJournal(db, 'daylio_csv');
    expect(() => planImport(source, existing, { ...options(source), levels: new Map() })).toThrow(MappingNeededError);
    const partial = new Map([['rad', 5]]);
    expect(() => planImport(source, existing, { ...options(source), levels: partial })).toThrow(/levels missing for sad, meh, average, awful/);
  });

  it('imports with mapped levels, reuses names, puts new activities in "Imported from Daylio", re-import skips all', async () => {
    const db = await journal();
    const source = readDaylioCsv(csv('current-12h.csv'), await knownNames(db));
    const plan = planImport(source, await readExistingJournal(db, 'daylio_csv'), options(source, { sad: 2, average: 3 }));
    expect(plan.counts).toMatchObject({ entries: 5, duplicates: 0, skipped: 0, first: '2021-09-25', last: '2021-09-28' });
    // "friends", "family", "sport" and "sick" exist in the defaults (case-insensitive); the rest are new
    expect(plan.newActivities.map((a) => a.name).sort()).toEqual(['café', 'clean', 'movies / tv', 'music', 'Süßes'].sort());
    // "awful" matches the default "Awful" on level 1; the other four names are new moods
    expect(plan.newMoods.map((m) => [m.name, m.level])).toEqual([
      ['sad', 2],
      ['rad', 5],
      ['meh', 3],
      ['average', 3],
    ]);
    const result = await applyImportPlan(db, plan, { now: 5, fileName: 'daylio_export.csv' });
    expect(result).toMatchObject({ added: 5, duplicates: 0, moods: 4 });
    const groups = await listGroups(db);
    expect(groups.at(-1)!.name).toBe('Imported from Daylio');
    const stats = await listStatEntries(db);
    expect(stats.map((e) => [e.date, e.time, e.level]).sort()).toEqual([
      ['2021-09-25', '23:59', 1],
      ['2021-09-26', '12:30', 3],
      ['2021-09-27', '00:00', 3],
      ['2021-09-28', '08:15', 5],
      ['2021-09-28', '22:00', 2],
    ]);
    // CSV has no offset: Berlin summer time of that date
    const row = await db.getFirstAsync<{ utc_ms: number; tz_offset_min: number; source: string }>("SELECT utc_ms, tz_offset_min, source FROM entries WHERE local_time = '08:15'");
    expect(row).toEqual({ utc_ms: Date.parse('2021-09-28T06:15:00Z'), tz_offset_min: 120, source: 'daylio_csv' });
    // Second import of the same file adds nothing
    const again = planImport(source, await readExistingJournal(db, 'daylio_csv'), options(source, { sad: 2, average: 3 }));
    expect(again.counts).toMatchObject({ entries: 0, duplicates: 5 });
    expect((await applyImportPlan(db, again, { now: 6, fileName: 'again.csv' })).added).toBe(0);
    expect(await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM import_runs')).toEqual({ n: 2 });
  });

  it('two identical rows in one file are both kept; future dates are skipped with their row', async () => {
    const db = await journal();
    const text = 'full_date,date,weekday,time,mood,activities,note_title,note\n2026-10-15,,,10:00,good,,,\n2026-10-15,,,10:00,good,,,\n2026-10-20,,,10:00,good,,,\n';
    const source = readDaylioCsv(text);
    const plan = planImport(source, await readExistingJournal(db, 'daylio_csv'), options(source));
    expect(plan.counts).toMatchObject({ entries: 2, skipped: 1 });
    expect(plan.skipped).toEqual([{ where: '4', reason: 'date in the future' }]);
    expect(new Set(plan.entries.map((e) => e.importRef)).size).toBe(2);
    // the existing "Good" mood (level 4) is reused
    expect(plan.newMoods).toEqual([]);
  });
});

describe('Daylio backup → journal', () => {
  it('keeps Daylio groups, archived states, photos (rows from the glue), local times from the file', async () => {
    const db = await journal();
    const source = readDaylioBackup(buildDaylioZip());
    const plan = planImport(source, await readExistingJournal(db, 'daylio_backup'), options(source));
    expect(plan.warnings.map((w) => w.code)).toContain('goalsNotImported');
    expect(plan.newGroups.map((g) => g.name).sort()).toEqual(['Hobbies', 'Imported from Daylio']); // "People" exists
    const photoIndex = plan.entries.findIndex((e) => e.photos.length > 0);
    expect(plan.entries[photoIndex].photos[0].bytes).toEqual(PHOTO_BYTES);
    const result = await applyImportPlan(db, plan, {
      now: 9,
      fileName: 'backup.daylio',
      photoRows: new Map([[photoIndex, [{ file: 'imp-1.jpg', width: 1, height: 1, bytes: 4, sha256: 'x' }]]]),
    });
    expect(result).toMatchObject({ added: 5, photos: 1 });
    const entry = await db.getFirstAsync<{ local_date: string; local_time: string; tz_offset_min: number; note: string; import_ref: string }>(
      "SELECT local_date, local_time, tz_offset_min, note, import_ref FROM entries WHERE import_ref = 'daylio:103@1772938800000'"
    );
    expect(entry).toEqual({ local_date: '2026-03-07', local_time: '22:00', tz_offset_min: -300, note: 'Long day', import_ref: 'daylio:103@1772938800000' });
    const acts = await listActivities(db, { includeArchived: true });
    expect(acts.find((a) => a.name === 'old hobby')!.archived).toBe(true);
    expect(acts.find((a) => a.name === 'reading')).toBeDefined(); // existing default reused
    // "sad" was archived in Daylio and its level keeps "Bad" active → archived here too
    expect((await listMoods(db, { includeArchived: true })).find((m) => m.name === 'sad')).toMatchObject({ level: 2, archived: true });
    // re-import adds nothing
    const again = planImport(source, await readExistingJournal(db, 'daylio_backup'), options(source));
    expect(again.counts).toMatchObject({ entries: 0, duplicates: 5 });
  });

  it('more than 3 photos: the first 3 are kept and a warning names the entry', async () => {
    const db = await journal();
    const json = structuredClone(BACKUP_V15);
    json.assets.push(...[11, 12, 13].map((id) => ({ id, checksum: `p${id}`, type: 1 })));
    json.dayEntries[0].assets = [1, 11, 12, 13];
    const members = Object.fromEntries([11, 12, 13].map((id) => [`assets/p${id}.jpg`, PHOTO_BYTES]));
    const source = readDaylioBackup(buildDaylioZip(json, { members }));
    const plan = planImport(source, await readExistingJournal(db, 'daylio_backup'), options(source));
    expect(plan.entries[0].photos).toHaveLength(3);
    expect(plan.warnings).toContainEqual({ code: 'photosLimited', params: { ref: '101', n: 4 } });
  });

  it('a failure inside the transaction leaves the journal untouched', async () => {
    const db = await journal();
    const source = readDaylioBackup(buildDaylioZip());
    const plan = planImport(source, await readExistingJournal(db, 'daylio_backup'), options(source));
    const before = await db.getFirstAsync<{ e: number; a: number; m: number }>('SELECT (SELECT COUNT(*) FROM entries) e, (SELECT COUNT(*) FROM activities) a, (SELECT COUNT(*) FROM moods) m');
    plan.entries[3].localDate = null as unknown as string; // NOT NULL violation in the middle
    await expect(applyImportPlan(db, plan, { now: 1, fileName: 'x' })).rejects.toThrow();
    expect(await db.getFirstAsync('SELECT (SELECT COUNT(*) FROM entries) e, (SELECT COUNT(*) FROM activities) a, (SELECT COUNT(*) FROM moods) m')).toEqual(before);
  });
});

/**
 * @jest-environment node
 */
// Review S9: import and restore write in multi-row INSERT chunks. Same rows as before, still all-or-nothing.
import { createTestDb } from '../../test/node-sqlite-db';

import { zoneOffsetFn } from '@/engine/dates';
import { readDaylioCsv } from '@/engine/daylio-csv';
import { planImport } from '@/engine/import-plan';
import { daylioCsvLarge } from '@/dev/fixtures';

import { exportSnapshot, restoreSnapshot } from './backup-snapshot';
import { insertRows, MAX_VARS, nextId } from './bulk';
import { addEntry, deleteEntry } from './entries';
import { applyImportPlan, readExistingJournal } from './import';
import { migrate } from './migrations';
import { listMoods } from './moods';
import { seedDefaults } from './seed';
import type { Db } from './types';

const TODAY = '2026-10-16';
const berlin = zoneOffsetFn('Europe/Berlin');

async function journal(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  await seedDefaults(db, 'en', 1);
  return db;
}

async function bigPlan(db: Db, days: number, perDay: number) {
  const known = new Map((await listMoods(db, { includeArchived: true })).map((m) => [m.name.toLowerCase(), m.level]));
  const source = readDaylioCsv(new TextDecoder().decode(daylioCsvLarge(days, perDay, TODAY)), known);
  const levels = new Map(source.moods.map((m) => [m.ref, m.proposedLevel ?? 3]));
  return planImport(source, await readExistingJournal(db, 'daylio_csv'), { levels, today: TODAY, offsetAt: berlin, importGroupName: 'Imported from Daylio' });
}

const counts = (db: Db) =>
  db.getFirstAsync<Record<string, number>>(
    'SELECT (SELECT COUNT(*) FROM entries) e, (SELECT COUNT(*) FROM entry_activities) l, (SELECT COUNT(*) FROM activities) a, (SELECT COUNT(*) FROM moods) m, (SELECT COUNT(*) FROM import_runs) r'
  );

describe('insertRows / nextId', () => {
  it('splits into chunks below MAX_VARS and refuses a row of the wrong length', async () => {
    const db = await journal();
    const calls: number[] = [];
    const spy = { ...db, runAsync: (sql: string, ...p: unknown[]) => (calls.push(p.length), (db.runAsync as (s: string, ...q: unknown[]) => Promise<unknown>)(sql, ...p)) } as unknown as Db;
    const rows = Array.from({ length: 2500 }, (_, i) => [`k${i}`, String(i)]);
    expect(await insertRows(spy, 'settings', ['key', 'value'], rows)).toBe(2500);
    expect(calls.every((n) => n <= MAX_VARS)).toBe(true);
    expect(calls.length).toBe(Math.ceil(2500 / (MAX_VARS / 2)));
    expect((await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'k%'"))?.n).toBe(2500);
    await expect(insertRows(db, 'settings', ['key', 'value'], [['a']])).rejects.toThrow('row has 1 values');
    expect(await insertRows(db, 'settings', ['key', 'value'], [])).toBe(0);
  });

  it('never reuses the id of a deleted last entry (AUTOINCREMENT)', async () => {
    const db = await journal();
    const mood = (await listMoods(db))[0].id;
    const id = await addEntry(db, { moodId: mood, localDate: '2026-10-01', localTime: '10:00', utcMs: 1, tzOffsetMin: 0, noteTitle: '', note: '', activityIds: [] }, { now: 1, today: TODAY });
    await deleteEntry(db, id);
    expect(await nextId(db, 'entries')).toBe(id + 1);
  });
});

describe('bulk import (S9)', () => {
  it('3,000 rows in several chunks: every entry, link and the run row; re-import adds nothing', async () => {
    const db = await journal();
    const plan = await bigPlan(db, 600, 5);
    expect(plan.entries.length).toBe(3000);
    const links = plan.entries.reduce((n, e) => n + new Set(e.activities.map((k) => JSON.stringify(k))).size, 0);
    const r = await applyImportPlan(db, plan, { now: 5, fileName: 'big.csv' });
    expect(r.added).toBe(3000);
    const c = await counts(db);
    expect(c?.e).toBe(3000);
    expect(c?.l).toBe(links);
    expect(c?.r).toBe(1);
    // Rows are exactly the plan (spot checks across chunk borders).
    for (const i of [0, 665, 666, 667, 1332, 2999]) {
      const e = plan.entries[i];
      const row = await db.getFirstAsync<Record<string, unknown>>('SELECT local_date d, local_time t, utc_ms u, note n, note_title nt FROM entries WHERE import_ref = ?', e.importRef);
      expect(row).toEqual({ d: e.localDate, t: e.localTime, u: e.utcMs, n: e.note, nt: e.noteTitle });
    }
    const again = await bigPlan(db, 600, 5);
    expect(again.entries.length).toBe(0);
    expect(again.counts.duplicates).toBe(3000);
  });

  it('a failure in a LATER chunk rolls back everything (moods, activities, earlier chunks)', async () => {
    const db = await journal();
    const before = await counts(db);
    const plan = await bigPlan(db, 600, 5);
    plan.entries[2500].localDate = null as unknown as string; // NOT NULL violation in chunk 4
    await expect(applyImportPlan(db, plan, { now: 5, fileName: 'big.csv' })).rejects.toThrow();
    expect(await counts(db)).toEqual(before);
  });

  it('duplicate refs inside one plan are counted once (as the row-by-row path did)', async () => {
    const db = await journal();
    const plan = await bigPlan(db, 2, 2);
    plan.entries.push({ ...plan.entries[0] });
    const r = await applyImportPlan(db, plan, { now: 5, fileName: 'x.csv' });
    expect(r.added).toBe(4);
    expect(r.duplicates).toBe(plan.counts.duplicates + 1);
  });
});

describe('bulk restore (S9)', () => {
  it('3,000-entry journal: snapshot → restore → identical tables; failure in a later chunk changes nothing', async () => {
    const a = await journal();
    await applyImportPlan(a, await bigPlan(a, 600, 5), { now: 5, fileName: 'big.csv' });
    const snap = await exportSnapshot(a);
    const b = await journal();
    expect((await restoreSnapshot(b, snap)).entries).toBe(3000);
    expect(JSON.stringify((await exportSnapshot(b)).tables)).toBe(JSON.stringify(snap.tables));

    const c = await journal();
    const before = JSON.stringify((await exportSnapshot(c)).tables);
    const bad = JSON.parse(JSON.stringify(snap));
    const e = bad.tables.entries;
    e.rows[2600][e.columns.indexOf('local_date')] = null;
    await expect(restoreSnapshot(c, bad)).rejects.toThrow();
    expect(JSON.stringify((await exportSnapshot(c)).tables)).toBe(before);
    const short = JSON.parse(JSON.stringify(snap));
    short.tables.entries.rows[10].pop();
    await expect(restoreSnapshot(c, short)).rejects.toThrow('row length');
    expect(JSON.stringify((await exportSnapshot(c)).tables)).toBe(before);
  });
});

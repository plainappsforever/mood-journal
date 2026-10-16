// Dev-build helpers behind `<scheme>://debug/…` (SPEC Screens "Dev only"): absolute preconditions for Maestro flows and
// the 20k-entry performance journal. Never reachable in preview/production builds (the route checks __DEV__).
import { addDays, type DateStr } from '@/engine/dates';
import type { Language } from '@/lib/i18n';

import { seedDefaults } from './seed';
import { withTransaction } from './tx';
import type { Db } from './types';

const TABLES = ['entry_activities', 'photos', 'entries', 'goals', 'activities', 'activity_groups', 'moods', 'reminders', 'import_runs', 'settings'];

/**
 * Empties the journal and seeds the defaults again (as on a fresh install; photo files are left alone). Ids restart at 1,
 * so flows can name them: moods 1 Great (5) … 5 Awful (1); activities 1–27 in seed order (walk 11, friends 18, sport 10).
 */
export async function resetJournal(db: Db, language: Language, now: number): Promise<void> {
  await withTransaction(db, async (tx) => {
    for (const table of TABLES) await tx.runAsync(`DELETE FROM ${table}`);
    await tx.runAsync('DELETE FROM sqlite_sequence');
  });
  await seedDefaults(db, language, now);
}

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTES = ['Long walk by the river', 'Café with Zoë', 'Tired after work', 'Good talk with a friend', 'Rainy day inside', 'Früh aufgestanden, schöner Morgen'];

export type SeedOptions = { days: number; perDay: number; end: DateStr; seed?: number; offsetMin: number; now: number };

/**
 * Adds `days × perDay` entries ending at `end` with the active moods and activities (sport and friends days lean
 * happier, so the Stats screen has something real to show). One transaction, multi-row inserts.
 */
export async function seedJournal(db: Db, opts: SeedOptions): Promise<number> {
  const rand = prng(opts.seed ?? 20261016);
  return withTransaction(db, async (tx) => {
    const moods = await tx.getAllAsync<{ id: number; level: number }>('SELECT id, level FROM moods WHERE archived = 0 ORDER BY level, sort, id');
    const acts = await tx.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM activities WHERE archived = 0 ORDER BY id');
    const byLevel = new Map<number, number>();
    for (const m of moods) if (!byLevel.has(m.level)) byLevel.set(m.level, m.id);
    const lucky = new Set(acts.filter((a) => /sport|friends|freunde|walk|spazier/i.test(a.name)).map((a) => a.id));
    const start = addDays(opts.end, -(opts.days - 1));
    let added = 0;
    const entryRows: (string | number)[][] = [];
    const links: [number, number][] = [];
    const first = await tx.getFirstAsync<{ m: number | null }>('SELECT MAX(id) AS m FROM entries');
    let id = (first?.m ?? 0) + 1;
    for (let d = 0; d < opts.days; d++) {
      const date = addDays(start, d);
      for (let k = 0; k < opts.perDay; k++) {
        const chosen = acts.filter(() => rand() < 0.12).map((a) => a.id);
        const bonus = chosen.some((a) => lucky.has(a)) ? 1 : 0;
        const level = Math.max(1, Math.min(5, Math.round(2.6 + rand() * 2 + bonus - 0.3)));
        const minutes = 8 * 60 + Math.floor(((k + rand()) / opts.perDay) * 14 * 60);
        const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        const [y, mo, da] = date.split('-').map(Number);
        const utcMs = Date.UTC(y, mo - 1, da, Math.floor(minutes / 60), minutes % 60) - opts.offsetMin * 60_000;
        const note = rand() < 0.2 ? NOTES[Math.floor(rand() * NOTES.length)] : '';
        entryRows.push([id, byLevel.get(level) ?? moods[0].id, date, time, utcMs, opts.offsetMin, note, opts.now, opts.now]);
        for (const a of chosen) links.push([id, a]);
        id++;
        added++;
      }
    }
    for (let i = 0; i < entryRows.length; i += 100) {
      const chunk = entryRows.slice(i, i + 100);
      await tx.runAsync(
        `INSERT INTO entries (id, mood_id, local_date, local_time, utc_ms, tz_offset_min, note, created_ms, updated_ms, source) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, 'app')").join(', ')}`,
        ...chunk.flat()
      );
    }
    for (let i = 0; i < links.length; i += 200) {
      const chunk = links.slice(i, i + 200);
      await tx.runAsync(`INSERT INTO entry_activities (entry_id, activity_id) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`, ...chunk.flat());
    }
    return added;
  });
}

/**
 * A small hand-made journal for the Stats flow (ends at `end`, one entry per day, 30 days, default ids after a reset):
 * days 1–10 "walk" at levels 4/3, days 11–20 plain at 3/4/3/2/3, days 21–30 "sport" at 5. Pinned by dev.test.ts:
 * sport → "clear difference", walk → "could be chance" (1 ≤ |t| < 3).
 */
export async function seedStatsFixture(db: Db, end: DateStr, offsetMin: number, now: number): Promise<void> {
  const WALK = 11;
  const SPORT = 10;
  const plain = [3, 4, 3, 2, 3, 3, 4, 3, 2, 3];
  await withTransaction(db, async (tx) => {
    const moods = await tx.getAllAsync<{ id: number; level: number }>('SELECT id, level FROM moods WHERE archived = 0 ORDER BY level, sort, id');
    const byLevel = new Map<number, number>();
    for (const m of moods) if (!byLevel.has(m.level)) byLevel.set(m.level, m.id);
    for (let i = 0; i < 30; i++) {
      const date = addDays(end, i - 29);
      const level = i < 10 ? (i % 2 ? 3 : 4) : i < 20 ? plain[i - 10] : 5;
      const [y, mo, d] = date.split('-').map(Number);
      const utcMs = Date.UTC(y, mo - 1, d, 20, 0) - offsetMin * 60_000;
      const r = await tx.runAsync(
        `INSERT INTO entries (mood_id, local_date, local_time, utc_ms, tz_offset_min, note, created_ms, updated_ms, source) VALUES (?, ?, '20:00', ?, ?, '', ?, ?, 'app')`,
        byLevel.get(level) ?? moods[0].id,
        date,
        utcMs,
        offsetMin,
        now,
        now
      );
      if (i < 10) await tx.runAsync('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)', r.lastInsertRowId, WALK);
      if (i >= 20) await tx.runAsync('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)', r.lastInsertRowId, SPORT);
    }
  });
}

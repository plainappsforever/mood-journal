/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { listActivities } from './activities';
import { listStatEntries } from './entries';
import { migrate } from './migrations';
import { listMoods } from './moods';
import { compareEntries, comparisonLabel } from '@/engine/stats';
import { makeT } from '@/lib/i18n';

import { resetJournal, seedJournal, seedStatsFixture } from './dev';
import { seedDefaults } from './seed';

describe('dev seed and reset', () => {
  it('seeds days × perDay entries deterministically and reset returns to the defaults', async () => {
    const db = createTestDb();
    await migrate(db);
    await seedDefaults(db, 'en', 1);
    const n = await seedJournal(db, { days: 30, perDay: 3, end: '2026-10-16', offsetMin: 120, now: 5 });
    expect(n).toBe(90);
    const entries = await listStatEntries(db);
    expect(entries).toHaveLength(90);
    expect(new Set(entries.map((e) => e.date)).size).toBe(30);
    expect(entries.every((e) => e.date >= '2026-09-17' && e.date <= '2026-10-16')).toBe(true);
    const again = createTestDb();
    await migrate(again);
    await seedDefaults(again, 'en', 1);
    await seedJournal(again, { days: 30, perDay: 3, end: '2026-10-16', offsetMin: 120, now: 5 });
    expect((await listStatEntries(again)).map((e) => [e.level, e.activityIds])).toEqual(entries.map((e) => [e.level, e.activityIds]));
    await resetJournal(db, 'de', 9);
    expect(await listStatEntries(db)).toHaveLength(0);
    expect((await listMoods(db)).map((m) => [m.id, m.name])).toEqual([[1, 'Super'], [2, 'Gut'], [3, 'Okay'], [4, 'Schlecht'], [5, 'Furchtbar']]);
    // ids the Maestro flows use after debug/reset
    const acts = new Map((await listActivities(db)).map((a) => [a.id, a.name]));
    expect([acts.get(10), acts.get(11), acts.get(18)]).toEqual(['Sport', 'Spaziergang', 'Freunde']);
  });
});

describe('stats fixture (Maestro "stats" flow)', () => {
  it('gives sport a clear difference and walk "could be chance"', async () => {
    const db = createTestDb();
    await migrate(db);
    await seedDefaults(db, 'en', 1);
    await resetJournal(db, 'en', 1);
    await seedStatsFixture(db, '2026-10-16', 120, 5);
    const entries = await listStatEntries(db);
    expect(entries).toHaveLength(30);
    const f = { t: makeT('en'), language: 'en' as const, locale: 'en' };
    expect(comparisonLabel(f, compareEntries(entries, 10))).toBe('Clear difference');
    const walk = compareEntries(entries, 11);
    expect(comparisonLabel(f, walk)).toBe('Could be chance');
    expect(walk).toMatchObject({ withMean: 3.5, withN: 10, withoutN: 20 });
  });
});

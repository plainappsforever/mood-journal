/**
 * @jest-environment node
 */
// The rating prompt: only after the tenth entry written in the app, once per version, imports do not count.
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { seedDefaults } from '@/db/seed';

import { maybeAskForReview, reviewDue, writtenEntryCount, type FlagStore } from './store-review';

function memoryStore(): FlagStore & { value: string | null } {
  const s = { value: null as string | null, get: async () => s.value, set: async (v: string) => void (s.value = v) };
  return s;
}

async function setup(app: number, imported = 0) {
  const db = createTestDb();
  await migrate(db);
  await seedDefaults(db, 'en', 1000);
  const moodId = (await db.getFirstAsync<{ id: number }>('SELECT id FROM moods LIMIT 1'))!.id;
  for (let i = 0; i < app + imported; i++) {
    await db.runAsync(
      'INSERT INTO entries (mood_id, local_date, local_time, utc_ms, tz_offset_min, created_ms, updated_ms, source) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      moodId, `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, '12:00', 1000 + i, 1000 + i, 1000 + i, i < app ? 'app' : 'daylio_csv'
    );
  }
  return db;
}

describe('rating prompt', () => {
  it('stays quiet on a fresh install and with nine entries', async () => {
    const db = await setup(9);
    const ask = jest.fn(async () => undefined);
    expect(await writtenEntryCount(db)).toBe(9);
    expect(await maybeAskForReview(db, '1.1.0', ask, memoryStore())).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks after the tenth entry, once per version', async () => {
    const db = await setup(10);
    const store = memoryStore();
    const ask = jest.fn(async () => undefined);
    expect(await maybeAskForReview(db, '1.1.0', ask, store)).toBe(true);
    expect(await maybeAskForReview(db, '1.1.0', ask, store)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await reviewDue(db, '1.2.0', store)).toBe(true);
  });

  it('imported entries do not count, and a refusing prompt does not throw', async () => {
    const db = await setup(3, 500);
    expect(await reviewDue(db, '1.1.0', memoryStore())).toBe(false);
    const db2 = await setup(10);
    await expect(maybeAskForReview(db2, '1.1.0', async () => Promise.reject(new Error('no')), memoryStore())).resolves.toBe(true);
  });
});

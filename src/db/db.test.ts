/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { LATEST_VERSION, migrate, MIGRATIONS_FOR_TEST } from './migrations';
import { DEFAULT_GROUPS, seedDefaults } from './seed';
import { getJournalSettings, getThemePreference, setJournalSetting, setThemePreference, SETTING_DEFAULTS } from './settings';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

const tables = async (db: Awaited<ReturnType<typeof freshDb>>) =>
  (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);

describe('migrations', () => {
  it('reaches the latest version and is safe to run again', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(2);
  });

  it('migration 2 creates the Mood schema and drops the template items table (also from a v1 database with rows)', async () => {
    const db = createTestDb();
    await migrate(db, MIGRATIONS_FOR_TEST.slice(0, 1));
    await db.runAsync("INSERT INTO items (title, note, created_at) VALUES ('x', '', 1)");
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    await migrate(db);
    expect(await tables(db)).toEqual(
      expect.arrayContaining(['activities', 'activity_groups', 'entries', 'entry_activities', 'goals', 'import_runs', 'moods', 'photos', 'reminders', 'settings'])
    );
    expect(await tables(db)).not.toContain('items');
    expect(await getThemePreference(db)).toBe('dark'); // settings survive
  });

  it('enforces the schema rules: level 1-5, unique activity names per group (case-insensitive), unique import refs', async () => {
    const db = await freshDb();
    await expect(db.runAsync("INSERT INTO moods (level, name, color, created_ms) VALUES (6, 'x', '#000000', 0)")).rejects.toThrow(/CHECK/);
    await db.runAsync("INSERT INTO activity_groups (name, created_ms) VALUES ('G', 0)");
    await db.runAsync("INSERT INTO activities (group_id, name, created_ms) VALUES (1, 'Sport', 0)");
    await expect(db.runAsync("INSERT INTO activities (group_id, name, created_ms) VALUES (1, 'sport', 0)")).rejects.toThrow(/UNIQUE/);
    await db.runAsync("INSERT INTO moods (level, name, color, created_ms) VALUES (3, 'meh', '#000000', 0)");
    const entry = (ref: string | null) =>
      db.runAsync(
        "INSERT INTO entries (mood_id, local_date, local_time, utc_ms, tz_offset_min, created_ms, updated_ms, source, import_ref) VALUES (1, '2026-01-01', '10:00', 0, 60, 0, 0, 'daylio_backup', ?)",
        ref
      );
    await entry('d1');
    await expect(entry('d1')).rejects.toThrow(/UNIQUE/);
    await entry(null);
    await entry(null); // app entries have no import ref; NULLs never collide
  });
});

describe('seed defaults', () => {
  it('seeds five moods (one per level) and the five groups in the device language, once', async () => {
    const db = await freshDb();
    expect(await seedDefaults(db, 'de', 1000)).toBe(true);
    expect(await seedDefaults(db, 'en', 2000)).toBe(false);
    const moods = await db.getAllAsync<{ level: number; name: string }>('SELECT level, name FROM moods ORDER BY level DESC');
    expect(moods).toEqual([
      { level: 5, name: 'Super' },
      { level: 4, name: 'Gut' },
      { level: 3, name: 'Okay' },
      { level: 2, name: 'Schlecht' },
      { level: 1, name: 'Furchtbar' },
    ]);
    const groups = await db.getAllAsync<{ name: string; n: number }>(
      'SELECT g.name, COUNT(a.id) AS n FROM activity_groups g JOIN activities a ON a.group_id = g.id GROUP BY g.id ORDER BY g.sort'
    );
    expect(groups.map((g) => g.name)).toEqual(['Gefühle', 'Aktivitäten', 'Menschen', 'Schlaf', 'Gesundheit']);
    expect(groups.map((g) => g.n)).toEqual(DEFAULT_GROUPS.map((g) => g.activities.length));
  });

  it('English names match the SPEC list', async () => {
    const db = await freshDb();
    await seedDefaults(db, 'en', 1);
    const names = (await db.getAllAsync<{ name: string }>('SELECT name FROM activities ORDER BY group_id, sort')).map((r) => r.name);
    expect(names.slice(0, 8)).toEqual(['calm', 'happy', 'grateful', 'tired', 'anxious', 'stressed', 'sad', 'angry']);
    expect(names).toContain('good sleep');
    expect(names).toContain('ate well');
  });
});

describe('settings', () => {
  it('theme defaults to system, persists changes, and ignores invalid stored values', async () => {
    const db = await freshDb();
    expect(await getThemePreference(db)).toBe('system');
    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');
    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'theme'");
    expect(await getThemePreference(db)).toBe('system');
  });

  it('journal settings have defaults, round-trip, and fall back on damaged values', async () => {
    const db = await freshDb();
    expect(await getJournalSettings(db)).toEqual(SETTING_DEFAULTS);
    await setJournalSetting(db, 'weekStart', 7);
    await setJournalSetting(db, 'dayEndHour', 3);
    await setJournalSetting(db, 'reminderSkipIfLogged', false);
    await setJournalSetting(db, 'reminderText', 'Check in?');
    const s = await getJournalSettings(db);
    expect(s).toMatchObject({ weekStart: 7, dayEndHour: 3, reminderSkipIfLogged: false, reminderText: 'Check in?' });
    await expect(setJournalSetting(db, 'dayEndHour', 5)).rejects.toThrow(/invalid/);
    await db.runAsync("UPDATE settings SET value = '9' WHERE key = 'day_end_hour'");
    expect((await getJournalSettings(db)).dayEndHour).toBe(0);
  });
});

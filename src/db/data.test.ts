/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { activityUsage, addActivity, addGroup, deleteActivity, deleteGroup, listActivities, listGroups, moveActivity, setActivityArchived, updateActivity } from './activities';
import { addEntry, addPhoto, deleteEntry, entryCreationTimes, getEntry, listEntries, listStatEntries, loggedDates, removePhoto, updateEntry, type EntryInput } from './entries';
import { addGoal, daysWithActivity, listGoals } from './goals';
import { migrate } from './migrations';
import { addMood, countEntriesForMood, listMoods, mergeMood, moveMood, setMoodArchived, setMoodLevel, updateMood } from './moods';
import { addReminder, deleteReminder, listReminders, updateReminder } from './reminders';
import { seedDefaults } from './seed';
import type { Db } from './types';

const TODAY = '2026-10-16';
const opts = { now: 1_000, today: TODAY };

async function seeded(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  await seedDefaults(db, 'en', 1);
  return db;
}

const moodId = async (db: Db, name: string) => (await listMoods(db, { includeArchived: true })).find((m) => m.name === name)!.id;
const actId = async (db: Db, name: string) => (await listActivities(db, { includeArchived: true })).find((a) => a.name === name)!.id;

function input(over: Partial<EntryInput> & { moodId: number }): EntryInput {
  return { localDate: '2026-10-15', localTime: '20:00', utcMs: 1_760_551_200_000, tzOffsetMin: 120, noteTitle: '', note: '', activityIds: [], ...over };
}

describe('moods', () => {
  it('lists best level first, adds several moods per level, and keeps one active mood per level', async () => {
    const db = await seeded();
    const okay = await moodId(db, 'Okay');
    const meh = await addMood(db, { level: 3, name: ' meh ', emoji: '😶', color: '#AABBCC' }, 5);
    expect((await listMoods(db)).map((m) => m.level)).toEqual([5, 4, 3, 3, 2, 1]);
    expect((await listMoods(db)).find((m) => m.id === meh)!.name).toBe('meh');
    await setMoodArchived(db, okay, true); // meh still active on level 3
    await expect(setMoodArchived(db, meh, true)).rejects.toMatchObject({ code: 'last-of-level' });
    expect((await listMoods(db)).filter((m) => m.level === 3).map((m) => m.name)).toEqual(['meh']);
    await expect(addMood(db, { level: 0, name: 'x', emoji: '', color: '#000000' }, 1)).rejects.toMatchObject({ code: 'invalid' });
    await expect(addMood(db, { level: 2, name: 'x', emoji: '', color: 'red' }, 1)).rejects.toMatchObject({ code: 'invalid' });
    await updateMood(db, meh, { name: 'so-so', emoji: '😑', color: '#112233' });
    expect((await listMoods(db)).find((m) => m.id === meh)).toMatchObject({ name: 'so-so', emoji: '😑', color: '#112233' });
  });

  it('changing a level re-levels the entries; the last active mood of a level cannot leave it', async () => {
    const db = await seeded();
    const good = await moodId(db, 'Good');
    const tired = await addMood(db, { level: 3, name: 'tired', emoji: '🥱', color: '#999999' }, 5);
    await addEntry(db, input({ moodId: tired }), opts);
    await addEntry(db, input({ moodId: tired, localDate: '2026-10-14' }), opts);
    expect(await countEntriesForMood(db, tired)).toBe(2);
    expect(await setMoodLevel(db, tired, 2)).toBe(2);
    expect((await listStatEntries(db)).map((e) => e.level)).toEqual([2, 2]);
    await expect(setMoodLevel(db, good, 5)).rejects.toMatchObject({ code: 'last-of-level' });
  });

  it('merge moves every entry to the other mood, then removes the mood', async () => {
    const db = await seeded();
    const okay = await moodId(db, 'Okay');
    const meh = await addMood(db, { level: 3, name: 'meh', emoji: '', color: '#AABBCC' }, 5);
    await addEntry(db, input({ moodId: meh }), opts);
    await addEntry(db, input({ moodId: meh }), opts);
    expect(await mergeMood(db, meh, okay, 2_000)).toBe(2);
    expect(await countEntriesForMood(db, okay)).toBe(2);
    expect((await listMoods(db, { includeArchived: true })).some((m) => m.id === meh)).toBe(false);
    await expect(mergeMood(db, okay, okay, 1)).rejects.toMatchObject({ code: 'same-mood' });
    // Okay is now the only level-3 mood: it cannot be merged away.
    await expect(mergeMood(db, okay, await moodId(db, 'Good'), 1)).rejects.toMatchObject({ code: 'last-of-level' });
  });

  it('reorders inside a level', async () => {
    const db = await seeded();
    const b = await addMood(db, { level: 3, name: 'b', emoji: '', color: '#000000' }, 1);
    await moveMood(db, b, -1);
    expect((await listMoods(db)).filter((m) => m.level === 3).map((m) => m.name)).toEqual(['b', 'Okay']);
  });
});

describe('activities', () => {
  it('rejects duplicate names per group regardless of case, moves and archives', async () => {
    const db = await seeded();
    const people = (await listGroups(db)).find((g) => g.name === 'People')!.id;
    await expect(addActivity(db, { groupId: people, name: 'Family', emoji: '' }, 1)).rejects.toMatchObject({ code: 'duplicate-name' });
    const pets = await addActivity(db, { groupId: people, name: 'pets', emoji: '🐶' }, 1);
    await moveActivity(db, pets, -1);
    const names = (await listActivities(db)).filter((a) => a.groupId === people).map((a) => a.name);
    expect(names).toEqual(['family', 'friends', 'partner', 'pets', 'alone']);
    await setActivityArchived(db, pets, true);
    expect((await listActivities(db)).some((a) => a.id === pets)).toBe(false);
    expect((await listActivities(db, { includeArchived: true })).find((a) => a.id === pets)!.archived).toBe(true);
    const family = await actId(db, 'family');
    await expect(updateActivity(db, family, { groupId: people, name: 'FRIENDS', emoji: '' })).rejects.toMatchObject({ code: 'duplicate-name' });
  });

  it('delete reports and removes usage in entries and goals; groups delete only when empty', async () => {
    const db = await seeded();
    const sport = await actId(db, 'sport');
    const walk = await actId(db, 'walk');
    const good = await moodId(db, 'Good');
    const e1 = await addEntry(db, input({ moodId: good, activityIds: [sport, walk] }), opts);
    await addEntry(db, input({ moodId: good, activityIds: [sport] }), opts);
    await addGoal(db, { activityId: sport, period: 'week', target: 3, startDate: '2026-10-01' }, 1);
    expect(await activityUsage(db, sport)).toEqual({ entries: 2, goals: 1 });
    expect(await deleteActivity(db, sport)).toEqual({ entries: 2, goals: 1 });
    expect((await getEntry(db, e1))!.activityIds).toEqual([walk]);
    expect(await listGoals(db, { includeArchived: true })).toEqual([]);
    const g = await addGroup(db, 'Empty', 1);
    await deleteGroup(db, g);
    const people = (await listGroups(db)).find((x) => x.name === 'People')!.id;
    await expect(deleteGroup(db, people)).rejects.toMatchObject({ code: 'group-not-empty' });
  });
});

describe('entries', () => {
  it('adds, reads, updates and deletes with activities; dates limited to 1900-01-01 … today + 1', async () => {
    const db = await seeded();
    const good = await moodId(db, 'Good');
    const walk = await actId(db, 'walk');
    const friends = await actId(db, 'friends');
    const id = await addEntry(db, input({ moodId: good, activityIds: [friends, walk, walk], noteTitle: '  Park ', note: 'Nice.\n\n' }), opts);
    const e = await getEntry(db, id);
    expect(e).toMatchObject({ level: 4, noteTitle: 'Park', note: 'Nice.', source: 'app', activityIds: [walk, friends].sort((a, b) => a - b) });
    await updateEntry(db, id, input({ moodId: await moodId(db, 'Awful'), activityIds: [] }), { now: 5, today: TODAY });
    expect(await getEntry(db, id)).toMatchObject({ level: 1, activityIds: [], updatedMs: 5, createdMs: 1_000 });
    await expect(addEntry(db, input({ moodId: good, localDate: '2026-10-18' }), opts)).rejects.toMatchObject({ code: 'future-date' });
    await addEntry(db, input({ moodId: good, localDate: '2026-10-17' }), opts); // today + 1 is allowed
    await expect(addEntry(db, input({ moodId: good, localDate: '1899-12-31' }), opts)).rejects.toMatchObject({ code: 'too-early' });
    await expect(addEntry(db, input({ moodId: good, localDate: '2026-02-29' }), opts)).rejects.toMatchObject({ code: 'invalid' });
    await expect(addEntry(db, input({ moodId: good, localTime: '24:00' }), opts)).rejects.toMatchObject({ code: 'invalid' });
    await expect(addEntry(db, input({ moodId: 999 }), opts)).rejects.toMatchObject({ code: 'not-found' });
    await expect(addEntry(db, input({ moodId: good, activityIds: [999] }), opts)).rejects.toMatchObject({ code: 'not-found' });
    expect((await listStatEntries(db)).length).toBe(2); // the failed inserts rolled back completely
    expect(await deleteEntry(db, id)).toEqual([]);
    expect(await getEntry(db, id)).toBeNull();
  });

  it('timeline: newest day first, inside a day by real moment; stat entries and logged dates', async () => {
    const db = await seeded();
    const good = await moodId(db, 'Good');
    const a = await addEntry(db, input({ moodId: good, localDate: '2026-10-14', utcMs: 100 }), opts);
    const b = await addEntry(db, input({ moodId: good, localDate: '2026-10-15', utcMs: 300 }), opts);
    const c = await addEntry(db, input({ moodId: good, localDate: '2026-10-15', utcMs: 200 }), opts);
    expect((await listEntries(db)).map((e) => e.id)).toEqual([b, c, a]);
    expect((await listEntries(db, { from: '2026-10-15', limit: 1, offset: 1 })).map((e) => e.id)).toEqual([c]);
    expect(await loggedDates(db)).toEqual(['2026-10-14', '2026-10-15']);
    expect(await entryCreationTimes(db, '2026-10-15')).toEqual([1_000, 1_000]);
  });

  it('photos: at most 3 per entry, removed rows return their files, deleting the entry returns its files', async () => {
    const db = await seeded();
    const id = await addEntry(db, input({ moodId: await moodId(db, 'Good') }), opts);
    const p = (n: number) => ({ file: `p${n}.jpg`, width: 10, height: 20, bytes: 30, sha256: 'ab' });
    const first = await addPhoto(db, id, p(1));
    await addPhoto(db, id, p(2));
    await addPhoto(db, id, p(3));
    await expect(addPhoto(db, id, p(4))).rejects.toMatchObject({ code: 'too-many-photos' });
    expect(await removePhoto(db, first)).toBe('p1.jpg');
    expect(await removePhoto(db, first)).toBeNull();
    expect((await getEntry(db, id))!.photos.map((x) => x.file)).toEqual(['p2.jpg', 'p3.jpg']);
    expect((await listEntries(db))[0].photos).toHaveLength(2);
    expect(await deleteEntry(db, id)).toEqual(['p2.jpg', 'p3.jpg']);
  });
});

describe('goals and reminders', () => {
  it('goals: day goals have target 1, archived activity marks the goal paused, days with the activity', async () => {
    const db = await seeded();
    const sport = await actId(db, 'sport');
    const good = await moodId(db, 'Good');
    await addGoal(db, { activityId: sport, period: 'day', target: 5, startDate: '2026-10-01' }, 1);
    await expect(addGoal(db, { activityId: sport, period: 'week', target: 8, startDate: '2026-10-01' }, 1)).rejects.toMatchObject({ code: 'invalid' });
    await addEntry(db, input({ moodId: good, activityIds: [sport], localDate: '2026-10-03' }), opts);
    await addEntry(db, input({ moodId: good, activityIds: [sport], localDate: '2026-10-03' }), opts);
    await addEntry(db, input({ moodId: good, activityIds: [sport], localDate: '2026-10-01' }), opts);
    expect(await daysWithActivity(db, sport)).toEqual(['2026-10-01', '2026-10-03']);
    await setActivityArchived(db, sport, true);
    expect(await listGoals(db)).toEqual([expect.objectContaining({ target: 1, period: 'day', activityArchived: true })]);
  });

  it('reminders: at most 6, validated, editable', async () => {
    const db = await seeded();
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push(await addReminder(db, { hour: 8 + i, minute: 0, weekdays: 127, enabled: true }));
    await expect(addReminder(db, { hour: 20, minute: 0, weekdays: 127, enabled: true })).rejects.toMatchObject({ code: 'too-many-reminders' });
    await expect(updateReminder(db, ids[0], { hour: 24, minute: 0, weekdays: 1, enabled: true })).rejects.toMatchObject({ code: 'invalid' });
    await updateReminder(db, ids[0], { hour: 20, minute: 30, weekdays: 0b0011111, enabled: false });
    await deleteReminder(db, ids[5]);
    const list = await listReminders(db);
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ hour: 20, minute: 30, weekdays: 31, enabled: false });
  });
});

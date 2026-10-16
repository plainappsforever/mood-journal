// Applies an import plan (src/engine/import-plan.ts) in ONE transaction: a failure leaves the journal untouched
// (SPEC "partial imports never happen"). Photos: the glue (P8) copies/downscales the files first and passes their rows
// per planned entry; this function only writes rows. Import never edits or deletes existing entries.
import { DEFAULT_MOODS } from './seed';
import type { ExistingJournal, ImportPlan, RowKey } from '@/engine/import-plan';

import { insertRows, nextId, type SqlValue } from './bulk';
import type { PhotoInput } from './entries';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

/** The rows import-plan needs, read in one unit. */
export async function readExistingJournal(db: Db, source: 'daylio_backup' | 'daylio_csv'): Promise<ExistingJournal> {
  return withRead(db, async (r) => {
    const moods = await r.getAllAsync<{ id: number; name: string; level: number }>('SELECT id, name, level FROM moods');
    const groups = await r.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM activity_groups');
    const activities = await r.getAllAsync<{ id: number; groupId: number; name: string }>('SELECT id, group_id AS groupId, name FROM activities');
    const refs = await r.getAllAsync<{ ref: string }>('SELECT import_ref AS ref FROM entries WHERE source = ? AND import_ref IS NOT NULL', source);
    return { moods, groups, activities, importRefs: new Set(refs.map((x) => x.ref)) };
  });
}

export type ImportResult = { runId: number; added: number; skipped: number; duplicates: number; photos: number; moods: number; activities: number };

export async function applyImportPlan(
  db: Db,
  plan: ImportPlan,
  opts: { now: number; fileName: string; photoRows?: ReadonlyMap<number, readonly PhotoInput[]> }
): Promise<ImportResult> {
  return withTransaction(db, async (tx) => {
    const moodIds: number[] = [];
    for (const m of plan.newMoods) {
      const look = DEFAULT_MOODS.find((d) => d.level === m.level)!;
      const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM moods WHERE level = ?', m.level);
      const r = await tx.runAsync(
        'INSERT INTO moods (level, name, emoji, color, sort, archived, created_ms, import_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        m.level,
        m.name,
        look.emoji,
        look.color,
        (max?.s ?? -1) + 1,
        // An archived Daylio mood stays archived only if its level keeps another active mood (D36).
        0,
        opts.now,
        plan.source
      );
      moodIds.push(r.lastInsertRowId);
    }
    for (const [i, m] of plan.newMoods.entries()) {
      if (!m.archived) continue;
      const other = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM moods WHERE level = ? AND archived = 0 AND id <> ?', m.level, moodIds[i]);
      if (other?.n) await tx.runAsync('UPDATE moods SET archived = 1 WHERE id = ?', moodIds[i]);
    }
    const groupIds: number[] = [];
    for (const g of plan.newGroups) {
      const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM activity_groups');
      const r = await tx.runAsync('INSERT INTO activity_groups (name, sort, created_ms, import_ref) VALUES (?, ?, ?, ?)', g.name, (max?.s ?? -1) + 1, opts.now, plan.source);
      groupIds.push(r.lastInsertRowId);
    }
    const resolve = (key: RowKey, created: number[]) => ('existing' in key ? key.existing : created[key.created]);
    const activityIds: number[] = [];
    for (const a of plan.newActivities) {
      const groupId = resolve(a.group, groupIds);
      const max = await tx.getFirstAsync<{ s: number | null }>('SELECT MAX(sort) AS s FROM activities WHERE group_id = ?', groupId);
      const r = await tx.runAsync(
        'INSERT INTO activities (group_id, name, emoji, sort, archived, created_ms, import_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
        groupId,
        a.name,
        '',
        (max?.s ?? -1) + 1,
        a.archived ? 1 : 0,
        opts.now,
        plan.source
      );
      activityIds.push(r.lastInsertRowId);
    }
    // Entries, their activities and photos as multi-row INSERTs with ids assigned here (review S9: one statement per
    // row took 15–70 s for 20k rows on the simulator/emulator). Still inside the one transaction above.
    const known = new Set(
      (await tx.getAllAsync<{ ref: string }>('SELECT import_ref AS ref FROM entries WHERE source = ? AND import_ref IS NOT NULL', plan.source)).map((x) => x.ref)
    );
    let id = await nextId(tx, 'entries');
    const entryRows: SqlValue[][] = [];
    const linkRows: SqlValue[][] = [];
    const photoRows: SqlValue[][] = [];
    let added = 0;
    let duplicates = plan.counts.duplicates;
    let photos = 0;
    for (const [i, e] of plan.entries.entries()) {
      if (known.has(e.importRef)) {
        duplicates++; // imported meanwhile (e.g. a second import of the same file)
        continue;
      }
      known.add(e.importRef);
      const entryId = id++;
      entryRows.push([entryId, resolve(e.mood, moodIds), e.localDate, e.localTime, e.utcMs, e.tzOffsetMin, e.noteTitle, e.note, opts.now, opts.now, plan.source, e.importRef]);
      for (const a of new Set(e.activities.map((k) => resolve(k, activityIds)))) linkRows.push([entryId, a]);
      for (const [sort, p] of (opts.photoRows?.get(i) ?? []).slice(0, 3).entries()) {
        photoRows.push([entryId, p.file, p.width, p.height, p.bytes, p.sha256, sort]);
        photos++;
      }
      added++;
    }
    await insertRows(tx, 'entries', ['id', 'mood_id', 'local_date', 'local_time', 'utc_ms', 'tz_offset_min', 'note_title', 'note', 'created_ms', 'updated_ms', 'source', 'import_ref'], entryRows);
    await insertRows(tx, 'entry_activities', ['entry_id', 'activity_id'], linkRows);
    await insertRows(tx, 'photos', ['entry_id', 'file', 'width', 'height', 'bytes', 'sha256', 'sort'], photoRows);
    const run = await tx.runAsync(
      'INSERT INTO import_runs (kind, file_name, started_ms, entries_added, entries_skipped, photos_added, warnings_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      plan.source,
      opts.fileName,
      opts.now,
      added,
      plan.counts.skipped + duplicates,
      photos,
      JSON.stringify(plan.warnings)
    );
    return { runId: run.lastInsertRowId, added, skipped: plan.counts.skipped, duplicates, photos, moods: moodIds.length, activities: activityIds.length };
  });
}

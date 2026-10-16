// Import plan (SPEC "Daylio import", D22): maps an ImportSource onto the user's journal. PURE — the database rows it
// needs come in as plain arrays, the writes happen in src/db/import.ts in ONE transaction.
//
// - Moods: every source mood gets a level the user confirmed (pre-filled from the source's proposal). A mood with the
//   same name (case-insensitive) on that level is reused; otherwise a new mood is created on that level.
// - Activities: by name (case-insensitive) into any existing activity; new ones go into the Daylio group of the same
//   name (backup) or "Imported from Daylio" (CSV), existing groups matched by name.
// - Entries: dedupe key = source + Daylio id + its time stamp (backup: `daylio:<id>@<datetime ms>`, so a second
//   Daylio journal whose ids restart at 1 is not swallowed as "duplicates"; an entry WITHOUT id gets
//   `daylio:t<datetime>:<mood>:<hash of title + note>`, review S3) or source + content hash (CSV: date, time, mood
//   name, sorted activities, title, note). The n-th identical key in one file gets "#n". Known keys are skipped:
//   import only ever ADDS, never edits or deletes. Dates outside 1900-01-01 … today + 1 are skipped.
// - CSV entries have no time zone: utc = local(date, time) in the device's current zone (injected).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { checkEntryDate, localToUtc, type DateStr, type OffsetAt } from './dates';
import type { ImportSource, ImportWarning, SourceEntry } from './daylio-common';

/** Photos per entry (D30); extra photos in a Daylio entry are left out with a warning. */
export const MAX_PHOTOS = 3;

export type ExistingJournal = {
  moods: readonly { id: number; name: string; level: number }[];
  groups: readonly { id: number; name: string }[];
  activities: readonly { id: number; groupId: number; name: string }[];
  /** import_ref values already stored for this source ('daylio_backup' or 'daylio_csv'). */
  importRefs: ReadonlySet<string>;
};

/** Reference to a row: an existing id or an index into the plan's new rows. */
export type RowKey = { existing: number } | { created: number };

export type PlannedEntry = {
  where: string;
  importRef: string;
  localDate: DateStr;
  localTime: string;
  utcMs: number;
  tzOffsetMin: number;
  mood: RowKey;
  activities: RowKey[];
  noteTitle: string;
  note: string;
  photos: SourceEntry['photos'];
};

export type ImportPlan = {
  source: 'daylio_backup' | 'daylio_csv';
  newMoods: { name: string; level: number; archived: boolean }[];
  newGroups: { name: string }[];
  newActivities: { name: string; group: RowKey; archived: boolean }[];
  entries: PlannedEntry[];
  counts: { entries: number; duplicates: number; skipped: number; photos: number; newMoods: number; newActivities: number; first: DateStr | null; last: DateStr | null };
  skipped: ImportSource['skipped'];
  warnings: ImportWarning[];
};

export type PlanOptions = {
  /** Source mood ref → confirmed level 1–5 (the mapping screen). */
  levels: ReadonlyMap<string, number>;
  today: DateStr;
  /** Device zone now: used for CSV rows (no offset in the file). */
  offsetAt: OffsetAt;
  /** Localized "Imported from Daylio". */
  importGroupName: string;
};

export class MappingNeededError extends Error {
  constructor(readonly moodRefs: string[]) {
    super(`levels missing for ${moodRefs.join(', ')}`);
    this.name = 'MappingNeededError';
  }
}

export function csvContentKey(e: Pick<SourceEntry, 'date' | 'time' | 'activityRefs' | 'noteTitle' | 'note'>, moodName: string): string {
  const content = JSON.stringify([e.date, e.time, moodName.trim().toLowerCase(), [...e.activityRefs].map((a) => a.toLowerCase()).sort(), e.noteTitle, e.note]);
  return shortHash(content);
}

/** Locale-free folding (review S4): a superset of SQLite's ASCII NOCASE, so a plan never violates UNIQUE … NOCASE. */
const lower = (s: string) => s.trim().toLowerCase();

const shortHash = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text))).slice(0, 32);

/** Backup dedupe key (see header). */
export function backupKey(e: Pick<SourceEntry, 'ref' | 'utcMs' | 'moodRef' | 'noteTitle' | 'note'>): string {
  if (e.ref) return `daylio:${e.ref}@${e.utcMs}`;
  return `daylio:t${e.utcMs}:${e.moodRef}:${shortHash(JSON.stringify([e.noteTitle, e.note]))}`;
}

export function planImport(source: ImportSource, existing: ExistingJournal, opts: PlanOptions): ImportPlan {
  const missing = source.moods.filter((m) => !isLevel(opts.levels.get(m.ref))).map((m) => m.ref);
  if (missing.length) throw new MappingNeededError(missing);

  // Moods
  const newMoods: ImportPlan['newMoods'] = [];
  const moodKey = new Map<string, RowKey>();
  const moodName = new Map<string, string>();
  for (const m of source.moods) {
    const level = opts.levels.get(m.ref)!;
    moodName.set(m.ref, m.name);
    const found = existing.moods.find((x) => x.level === level && lower(x.name) === lower(m.name));
    const already = newMoods.findIndex((x) => x.level === level && lower(x.name) === lower(m.name));
    if (found) moodKey.set(m.ref, { existing: found.id });
    else if (already >= 0) moodKey.set(m.ref, { created: already });
    else moodKey.set(m.ref, { created: newMoods.push({ name: m.name.trim(), level, archived: m.archived }) - 1 });
  }

  // Groups (only those needed by new activities) and activities
  const newGroups: ImportPlan['newGroups'] = [];
  const groupKeyByName = new Map<string, RowKey>();
  const groupFor = (name: string): RowKey => {
    const k = lower(name);
    let key = groupKeyByName.get(k);
    if (!key) {
      const found = existing.groups.find((g) => lower(g.name) === k);
      key = found ? { existing: found.id } : { created: newGroups.push({ name: name.trim() }) - 1 };
      groupKeyByName.set(k, key);
    }
    return key;
  };
  const sourceGroupName = new Map(source.groups.map((g) => [g.ref, g.name]));
  const newActivities: ImportPlan['newActivities'] = [];
  const activityKey = new Map<string, RowKey>();
  const createdByName = new Map<string, number>();
  for (const a of source.activities) {
    const k = lower(a.name);
    const found = existing.activities.find((x) => lower(x.name) === k);
    if (found) activityKey.set(a.ref, { existing: found.id });
    else if (createdByName.has(k)) activityKey.set(a.ref, { created: createdByName.get(k)! });
    else {
      const groupName = (a.groupRef !== null ? sourceGroupName.get(a.groupRef) : undefined) ?? opts.importGroupName;
      const index = newActivities.push({ name: a.name.trim(), group: groupFor(groupName), archived: a.archived }) - 1;
      createdByName.set(k, index);
      activityKey.set(a.ref, { created: index });
    }
  }

  // Entries
  const entries: PlannedEntry[] = [];
  const skipped = [...source.skipped];
  const warnings = [...source.warnings];
  const seen = new Set<string>();
  const occurrences = new Map<string, number>();
  let duplicates = 0;
  for (const e of source.entries) {
    const base = source.kind === 'daylio_backup' ? backupKey(e) : `csv:${csvContentKey(e, moodName.get(e.moodRef) ?? e.moodRef)}`;
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    const importRef = n === 1 ? base : `${base}#${n}`;
    if (existing.importRefs.has(importRef) || seen.has(importRef)) {
      duplicates++;
      continue;
    }
    const dateCheck = checkEntryDate(e.date, opts.today);
    if (dateCheck !== 'ok') {
      const reason = dateCheck === 'future' ? 'date in the future' : 'date out of range';
      skipped.push({ where: e.where, reason });
      warnings.push({ code: 'badRow', params: { row: e.where, reason } });
      continue;
    }
    seen.add(importRef);
    let utcMs = e.utcMs;
    let tzOffsetMin = e.tzOffsetMin;
    if (utcMs === null || tzOffsetMin === null) {
      utcMs = localToUtc(e.date, e.time, opts.offsetAt);
      tzOffsetMin = opts.offsetAt(utcMs);
    }
    entries.push({
      where: e.where,
      importRef,
      localDate: e.date,
      localTime: e.time,
      utcMs,
      tzOffsetMin,
      mood: moodKey.get(e.moodRef)!,
      activities: e.activityRefs.map((r) => activityKey.get(r)!).filter(Boolean),
      noteTitle: e.noteTitle,
      note: e.note,
      photos: e.photos.slice(0, MAX_PHOTOS),
    });
    if (e.photos.length > MAX_PHOTOS) warnings.push({ code: 'photosLimited', params: { ref: e.where, n: e.photos.length } });
  }
  if (source.goals > 0) warnings.push({ code: 'goalsNotImported' });
  const dates = entries.map((e) => e.localDate).sort();
  return {
    source: source.kind,
    newMoods,
    newGroups,
    newActivities,
    entries,
    counts: {
      entries: entries.length,
      duplicates,
      skipped: skipped.length,
      photos: entries.reduce((n, e) => n + e.photos.length, 0),
      newMoods: newMoods.length,
      newActivities: newActivities.length,
      first: dates[0] ?? null,
      last: dates.at(-1) ?? null,
    },
    skipped,
    warnings,
  };
}

function isLevel(v: number | undefined): v is number {
  return v !== undefined && Number.isInteger(v) && v >= 1 && v <= 5;
}

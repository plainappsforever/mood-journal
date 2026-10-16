// What an import WOULD add, as plain JSON — the contract for the blind fixture measurement (V1_PLAN P4, L27) and a
// compact preview. Runs the real readers and the real plan against an EMPTY journal.
//
// Output per file:
//   { file, status: 'ok' | 'error', error?: ImportErrorCode, kind?: 'daylio_csv' | 'daylio_backup',
//     entries: [{ date, time, mood, level, activities (names, sorted case-insensitively), title, note, photos }],
//     skipped: [{ where, reason }], warnings: [warning codes, in order] }
// `level` = the user's confirmed level when a mapping (lower-case mood name → level) is given, else the pre-filled
// proposal, else null (the user would have to choose). `photos` = photos that would be imported (≤ 3 per entry).
import { zoneOffsetFn, type DateStr } from './dates';
import { readDaylioBackup } from './daylio-backup';
import { ImportError, type ImportErrorCode, type ImportSource } from './daylio-common';
import { readDaylioCsv } from './daylio-csv';
import { planImport } from './import-plan';

export type ReportEntry = { date: string; time: string; mood: string; level: number | null; activities: string[]; title: string; note: string; photos: number };
export type ImportReport = {
  file: string;
  status: 'ok' | 'error';
  error?: ImportErrorCode;
  kind?: ImportSource['kind'];
  entries: ReportEntry[];
  skipped: { where: string; reason: string }[];
  warnings: string[];
};

/** CSV when the bytes do not start like a ZIP. */
export function readAnyDaylioFile(bytes: Uint8Array): ImportSource {
  const zip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip) return readDaylioBackup(bytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError('notZip', 'neither ZIP nor UTF-8 text');
  }
  return readDaylioCsv(text);
}

export function importReport(file: string, bytes: Uint8Array, opts: { today: DateStr; mapping?: ReadonlyMap<string, number> }): ImportReport {
  let source: ImportSource;
  try {
    source = readAnyDaylioFile(bytes);
  } catch (error) {
    if (error instanceof ImportError) return { file, status: 'error', error: error.code, entries: [], skipped: [], warnings: [] };
    throw error;
  }
  const levelOf = new Map<string, number | null>();
  for (const m of source.moods) levelOf.set(m.ref, opts.mapping?.get(m.name.trim().toLowerCase()) ?? m.proposedLevel ?? null);
  const plan = planImport(
    source,
    { moods: [], groups: [], activities: [], importRefs: new Set() },
    {
      levels: new Map(source.moods.map((m) => [m.ref, levelOf.get(m.ref) ?? 3])),
      today: opts.today,
      offsetAt: zoneOffsetFn('UTC'), // date/time are reported as written; the moment is not part of the report
      importGroupName: 'Imported from Daylio',
    }
  );
  const moodByRef = new Map(source.moods.map((m) => [m.ref, m]));
  const activityByRef = new Map(source.activities.map((a) => [a.ref, a]));
  const byWhere = new Map(source.entries.map((e) => [e.where, e]));
  const entries = plan.entries.map((p) => {
    const e = byWhere.get(p.where)!;
    return {
      date: p.localDate,
      time: p.localTime,
      mood: moodByRef.get(e.moodRef)!.name,
      level: levelOf.get(e.moodRef) ?? null,
      activities: e.activityRefs.map((r) => activityByRef.get(r)!.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      title: p.noteTitle,
      note: p.note,
      photos: p.photos.length,
    };
  });
  return { file, status: 'ok', kind: source.kind, entries, skipped: plan.skipped, warnings: plan.warnings.map((w) => w.code) };
}

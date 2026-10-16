// CSV export (SPEC "Import, export, backup"; A9). One row per entry:
//   date,time,weekday,mood,level,activities,note_title,note,photos
// ISO date, 24 h time, English weekday names (stable for re-import; the date is the truth), activities joined with
// " | " (Daylio-compatible), newest entry first (as Daylio and the timeline). RFC 4180 quoting, CRLF, UTF-8 BOM for
// Excel. Formula injection: a cell starting with = + - @ TAB or CR gets a leading apostrophe (OWASP CSV injection).
import { isoWeekday, type DateStr } from './dates';

export const CSV_HEADER = ['date', 'time', 'weekday', 'mood', 'level', 'activities', 'note_title', 'note', 'photos'] as const;
export const ACTIVITY_SEPARATOR = ' | ';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const BOM = '﻿';

export type CsvEntry = {
  date: DateStr;
  time: string;
  utcMs: number;
  moodName: string;
  level: number;
  activityNames: readonly string[];
  noteTitle: string;
  note: string;
  photos: number;
};

/** Neutralises spreadsheet formulas, then quotes when needed. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function entriesToCsv(entries: readonly CsvEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.date === b.date ? b.utcMs - a.utcMs : a.date < b.date ? 1 : -1));
  const lines = [CSV_HEADER.join(',')];
  for (const e of sorted) {
    lines.push(
      [e.date, e.time, WEEKDAYS[isoWeekday(e.date) - 1], e.moodName, e.level, e.activityNames.join(ACTIVITY_SEPARATOR), e.noteTitle, e.note, e.photos]
        .map(csvCell)
        .join(',')
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

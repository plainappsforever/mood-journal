// Formula 7 — pixel colour of day d = colour of level round(v(d)), round = floor(x + 0.5). Year in Pixels and the
// month grid both use it.
import { daysInMonth, isLeapYear, isoWeekday, type DateStr, type WeekStart } from '../dates';

import { dayIndex } from './days';
import { roundHalfUp, type StatEntry } from './types';
import type { DayInfo } from './days';

/** Level 1–5 per logged day. */
export function pixelLevels(days: Map<DateStr, DayInfo>): Map<DateStr, number> {
  return new Map([...days].map(([d, info]) => [d, roundHalfUp(info.value)]));
}

export type PixelCell = { date: DateStr; level: number | null };
/** 12 months; month m has exactly its number of days (29 Feb only in leap years). */
export type YearPixels = { year: number; months: PixelCell[][]; logged: number; leap: boolean };

/** Year in Pixels for `year` from all entries (entries of other years are ignored). */
export function yearPixels(all: readonly StatEntry[], year: number): YearPixels {
  const prefix = `${String(year).padStart(4, '0')}-`;
  const levels = pixelLevels(dayIndex(all.filter((e) => e.date.startsWith(prefix))));
  const months: PixelCell[][] = [];
  for (let m = 1; m <= 12; m++) {
    const cells: PixelCell[] = [];
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = `${prefix}${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date, level: levels.get(date) ?? null });
    }
    months.push(cells);
  }
  return { year, months, logged: levels.size, leap: isLeapYear(year) };
}

/** Month grid rows of 7 (null = padding outside the month), first column = `weekStart`. */
export function monthGrid(year: number, month: number, weekStart: WeekStart): (DateStr | null)[][] {
  const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const lead = (isoWeekday(first) - weekStart + 7) % 7;
  const cells: (DateStr | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(`${first.slice(0, 8)}${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const rows: (DateStr | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

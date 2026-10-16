// Journal dates (SPEC Data model, Formula 14, Edge cases "Time zones / DST"; D14, D29). PURE: no device zone, no
// Date.now(). Calendar days are 'YYYY-MM-DD' strings and all day arithmetic happens on them (never "+ 24 h"), so
// travel and DST never move an entry to another day. Moments are UTC milliseconds; the zone enters only through an
// injected `OffsetAt` (minutes east of UTC at an instant), built from the device's IANA zone by `zoneOffsetFn`.

export type DateStr = string; // 'YYYY-MM-DD'
export type TimeStr = string; // 'HH:MM' (24 h)
/** ISO weekday the week starts on: 1 = Monday, 6 = Saturday, 7 = Sunday (setting `week_start`). */
export type WeekStart = 1 | 6 | 7;
export type GoalPeriod = 'day' | 'week' | 'month';
/** Minutes east of UTC in force at `utcMs` (Berlin summer → 120, New York winter → −300). */
export type OffsetAt = (utcMs: number) => number;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const MIN_DATE: DateStr = '1900-01-01';
export const DAY_END_HOURS = [0, 1, 2, 3, 4] as const;

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function isValidTime(s: string): boolean {
  return TIME_RE.test(s);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, month: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Days since 1970-01-01 (proleptic Gregorian, computed in UTC so no zone is involved). */
export function dayNumber(s: DateStr): number {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`invalid date ${s}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function fromDayNumber(n: number): DateStr {
  const t = new Date(n * DAY_MS);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addDays(s: DateStr, n: number): DateStr {
  return fromDayNumber(dayNumber(s) + n);
}

/** b − a in days. */
export function diffDays(a: DateStr, b: DateStr): number {
  return dayNumber(b) - dayNumber(a);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(s: DateStr): number {
  // 1970-01-01 was a Thursday (4).
  return ((((dayNumber(s) + 3) % 7) + 7) % 7) + 1;
}

export function weekStartOf(s: DateStr, weekStart: WeekStart): DateStr {
  return addDays(s, -((isoWeekday(s) - weekStart + 7) % 7));
}

export function monthStartOf(s: DateStr): DateStr {
  return `${s.slice(0, 7)}-01`;
}

export function monthEndOf(s: DateStr): DateStr {
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  return `${s.slice(0, 7)}-${pad(daysInMonth(y, mo))}`;
}

/** The goal period instance (day, week by `weekStart`, calendar month) containing `s` (Formula 13). */
export function instanceOf(s: DateStr, period: GoalPeriod, weekStart: WeekStart): { start: DateStr; end: DateStr } {
  if (period === 'day') return { start: s, end: s };
  if (period === 'week') {
    const start = weekStartOf(s, weekStart);
    return { start, end: addDays(start, 6) };
  }
  return { start: monthStartOf(s), end: monthEndOf(s) };
}

/** Inclusive length of a period in days. */
export function periodLength(start: DateStr, end: DateStr): number {
  return diffDays(start, end) + 1;
}

/** How a statistics period was chosen: rolling days / custom, or a calendar month / year chip (Formula 11, D53). */
export type PeriodKind = 'days' | 'month' | 'year';

/** `s` moved by `months` calendar months; the day is clamped, and a month's last day stays the last day if `stickyEnd`. */
export function addMonths(s: DateStr, months: number, stickyEnd = false): DateStr {
  const [y, m, d] = s.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  const last = daysInMonth(ny, nm);
  const day = stickyEnd && d === daysInMonth(y, m) ? last : Math.min(d, last);
  return `${String(ny).padStart(4, '0')}-${pad(nm)}-${pad(day)}`;
}

/**
 * The comparison period of Formula 11. Rolling / custom periods: the period of equal length right before. Calendar
 * month / year chips (owner decision on review S8, D53): the previous calendar month / year — the whole of it for a
 * whole month/year, the same days of it for a period that runs to date (1–16 Oct → 1–16 Sep; 1 Jan–29 Feb 2024 →
 * 1 Jan–28 Feb 2023).
 */
export function previousPeriod(start: DateStr, end: DateStr, kind: PeriodKind = 'days'): { start: DateStr; end: DateStr } {
  if (kind === 'month' || kind === 'year') {
    const months = kind === 'month' ? -1 : -12;
    return { start: addMonths(start, months), end: addMonths(end, months, true) };
  }
  const length = periodLength(start, end);
  return { start: addDays(start, -length), end: addDays(start, -1) };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTime(hour: number, minute: number): TimeStr {
  return `${pad(hour)}:${pad(minute)}`;
}

export function parseTime(s: TimeStr): { hour: number; minute: number } {
  const m = TIME_RE.exec(s);
  if (!m) throw new Error(`invalid time ${s}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

// ---------------------------------------------------------------------------------------------------------------
// Zones

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Offset function for an IANA zone through Intl (explicit zone, so it never depends on the zone the JS engine
 * started with — a running engine keeps its start zone, warranty-wallet D42). Throws RangeError for an unknown zone.
 */
export function zoneOffsetFn(timeZone: string): OffsetAt {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  const fmt = f;
  return (utcMs: number) => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
    const whole = utcMs - (((utcMs % 1000) + 1000) % 1000);
    return Math.round((wall - whole) / MINUTE_MS);
  };
}

/**
 * The same offsets as `offsetAt`, with far fewer Intl calls (review S9: a 20k-row CSV plan made ~100,000
 * `formatToParts` calls, 8.8 s on the Android emulator). Per UTC day it asks the offset at the first and the last
 * millisecond; equal → the whole day has that offset and is answered from the cache; different → that day is always
 * asked exactly. Sound under the rule localToUtc already relies on: at most one transition in any 28 h window, so a
 * day that starts and ends on the same offset has no transition inside it.
 */
export function cachedOffsetFn(offsetAt: OffsetAt): OffsetAt {
  const days = new Map<number, number | null>();
  return (utcMs: number) => {
    const day = Math.floor(utcMs / DAY_MS);
    let o = days.get(day);
    if (o === undefined) {
      const first = offsetAt(day * DAY_MS);
      o = first === offsetAt(day * DAY_MS + DAY_MS - 1) ? first : null;
      days.set(day, o);
    }
    return o ?? offsetAt(utcMs);
  };
}

/** Wall clock of `utcMs` under `offsetAt`. */
export function wallClock(utcMs: number, offsetAt: OffsetAt): { date: DateStr; time: TimeStr; hour: number; minute: number; offsetMin: number } {
  const offsetMin = offsetAt(utcMs);
  const t = new Date(utcMs + offsetMin * MINUTE_MS);
  const hour = t.getUTCHours();
  const minute = t.getUTCMinutes();
  return { date: fromDayNumber(Math.floor((utcMs + offsetMin * MINUTE_MS) / DAY_MS)), time: formatTime(hour, minute), hour, minute, offsetMin };
}

/**
 * The UTC moment of local wall time (date, time) — SPEC DST rule: a wall time that does not exist (spring forward)
 * becomes the first valid minute after it; a repeated one (fall back) its first occurrence.
 */
export function localToUtc(date: DateStr, time: TimeStr, offsetAt: OffsetAt): number {
  const { hour, minute } = parseTime(time);
  let naive = dayNumber(date) * DAY_MS + (hour * 60 + minute) * MINUTE_MS;
  for (let step = 0; step < 24 * 60; step++, naive += MINUTE_MS) {
    // The true instant lies within ±14 h of the naive one; one transition at most in that window.
    const candidates = new Set([offsetAt(naive - 14 * 3_600_000), offsetAt(naive), offsetAt(naive + 14 * 3_600_000)]);
    let best: number | null = null;
    for (const o of candidates) {
      const u = naive - o * MINUTE_MS;
      if (offsetAt(u) === o && (best === null || u < best)) best = u;
    }
    if (best !== null) return best;
  }
  throw new Error(`no valid local time for ${date} ${time}`);
}

/**
 * Formula 14 — the journal day of a NEW entry made at `utcMs`: local wall clock; before `dayEndHour` it belongs to
 * yesterday ("Yesterday, 01:30"). `utcMs` stays the real moment.
 */
export function journalDayOf(utcMs: number, offsetAt: OffsetAt, dayEndHour: number): { localDate: DateStr; localTime: TimeStr; tzOffsetMin: number } {
  const w = wallClock(utcMs, offsetAt);
  return { localDate: w.hour < dayEndHour ? addDays(w.date, -1) : w.date, localTime: w.time, tzOffsetMin: w.offsetMin };
}

/**
 * "Today" for streaks, goals and the Stats period end (SPEC F12/F13 as clarified 2026-10-16, review S2, D54): the
 * journal day of now — before the day-end hour that is still yesterday, so a streak does not drop to 0 at midnight.
 */
export function journalToday(nowMs: number, offsetAt: OffsetAt, dayEndHour: number): DateStr {
  return journalDayOf(nowMs, offsetAt, dayEndHour).localDate;
}

/** Formula 14 — editing journal day X and time t: utc = local(X, t), or local(X + 1, t) when t's hour < dayEndHour. */
export function utcForJournalTime(date: DateStr, time: TimeStr, dayEndHour: number, offsetAt: OffsetAt): number {
  const { hour } = parseTime(time);
  return localToUtc(hour < dayEndHour ? addDays(date, 1) : date, time, offsetAt);
}

/** Entry dates are limited to 1900-01-01 … today + 1 (SPEC Edge cases "Clock changes"). */
export function checkEntryDate(date: string, today: DateStr): 'ok' | 'invalid' | 'too-early' | 'future' {
  if (!isValidDate(date)) return 'invalid';
  if (date < MIN_DATE) return 'too-early';
  if (date > addDays(today, 1)) return 'future';
  return 'ok';
}

/** Every date from start to end inclusive (both valid, start ≤ end); empty when start > end. */
export function eachDay(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const last = dayNumber(end);
  for (let n = dayNumber(start); n <= last; n++) out.push(fromDayNumber(n));
  return out;
}

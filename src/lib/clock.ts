// Device clock and zone for the screens. Engines never read the zone (D38): they get `offsetAt()` and `now()` from here.
// Dev builds can pin the clock (`debug/clock?at=…`) so Maestro can test the late-night rule (SPEC flow 2).
import { getCalendars } from 'expo-localization';

import { journalDayOf, journalToday, wallClock, zoneOffsetFn, type DateStr, type OffsetAt } from '@/engine/dates';

let pinned: { at: number; since: number } | null = null;

/** Milliseconds since epoch (dev: the pinned moment plus the time since pinning). */
export function now(): number {
  return pinned ? pinned.at + (Date.now() - pinned.since) : Date.now();
}

/** Dev only: pin the clock to `utcMs` (null = real clock). */
export function pinClock(utcMs: number | null): void {
  pinned = utcMs === null ? null : { at: utcMs, since: Date.now() };
}

/** The device's IANA zone (re-read on every call: travel changes it while the app runs). */
export function deviceZone(): string {
  try {
    return getCalendars()[0]?.timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

export function offsetAt(): OffsetAt {
  try {
    return zoneOffsetFn(deviceZone());
  } catch {
    return zoneOffsetFn('UTC');
  }
}

/** Today's journal day (D54): before the day-end hour this is still yesterday. */
export function today(dayEndHour: number): DateStr {
  return journalToday(now(), offsetAt(), dayEndHour);
}

/** The calendar date on the wall clock now (entry date limit: this + 1 day). */
export function calendarToday(): DateStr {
  return wallClock(now(), offsetAt()).date;
}

/** Journal day, wall time and offset for a new entry made now (Formula 14). */
export function newEntryMoment(dayEndHour: number) {
  const utcMs = now();
  return { utcMs, ...journalDayOf(utcMs, offsetAt(), dayEndHour) };
}

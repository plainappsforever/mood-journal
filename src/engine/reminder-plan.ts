// Reminder planner (SPEC Reminders, D21, D35). PURE: the reminders, "now", the zone (OffsetAt from the device's IANA
// zone), the day-end hour and when entries were made are parameters. The glue (P7) rebuilds the OS pending list from
// this plan on start, foreground, entry save and zone change; identifiers are deterministic so a re-plan can diff.
//
// - One-off notifications per (reminder, day): a repeating trigger cannot be skipped for one day.
// - ≤ 48 soonest (iOS keeps only 64 pending, WW D16); horizon 30 days.
// - DST: a reminder time that does not exist that day fires at the first valid minute after it; a repeated time
//   fires once, at its first occurrence (localToUtc). Two reminders landing on the same moment notify once.
// - Skip if logged (D35): skipped when an entry of the same journal day was MADE at or after the previous reminder
//   moment of that journal day (or at any time that day for its first reminder). Only "today" can have entries.
// - Quiet hours (optional; V1.5 random reminders use it, FEATURE_LEDGER F52): moments whose wall time falls inside
//   the window are dropped. Window may wrap midnight ('22:00'–'07:00'); start inclusive, end exclusive.
// - Text: the user's own text or the default — never journal content (A13).
import { addDays, formatTime, isoWeekday, journalDayOf, localToUtc, parseTime, wallClock, type DateStr, type OffsetAt, type TimeStr } from './dates';

export const MAX_SCHEDULED = 48;
export const HORIZON_DAYS = 30;
export const ID_PREFIX = 'mood-r';

export type PlanReminder = { id: number; hour: number; minute: number; weekdays: number; enabled: boolean };

export type PlanInput = {
  reminders: readonly PlanReminder[];
  nowMs: number;
  offsetAt: OffsetAt;
  dayEndHour: number;
  skipIfLogged: boolean;
  /** Creation moments (ms) of the entries of a journal day; only today's matter. */
  entriesMadeOn: (journalDate: DateStr) => readonly number[];
  quietHours?: { start: TimeStr; end: TimeStr } | null;
  /** Title and body as shown; the caller passes the user's own text or t('reminder.body'). */
  title: string;
  body: string;
  horizonDays?: number;
  max?: number;
};

export type PlannedReminder = {
  identifier: string;
  reminderId: number;
  /** Wall date and time the notification fires at (after any DST shift). */
  date: DateStr;
  time: TimeStr;
  /** Journal day the reminder asks about (day-end rule). */
  journalDate: DateStr;
  utcMs: number;
  title: string;
  body: string;
};

export type Plan = { scheduled: PlannedReminder[]; skippedLogged: number; droppedQuiet: number; truncated: boolean };

function minutesOf(t: TimeStr): number {
  const { hour, minute } = parseTime(t);
  return hour * 60 + minute;
}

export function inQuietHours(time: TimeStr, quiet: { start: TimeStr; end: TimeStr }): boolean {
  const m = minutesOf(time);
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Bit 0 = Monday … bit 6 = Sunday. */
export function remindsOn(weekdays: number, date: DateStr): boolean {
  return (weekdays & (1 << (isoWeekday(date) - 1))) !== 0;
}

export function planReminders(input: PlanInput): Plan {
  const horizon = input.horizonDays ?? HORIZON_DAYS;
  const max = input.max ?? MAX_SCHEDULED;
  const today = wallClock(input.nowMs, input.offsetAt).date;
  type Moment = { reminderId: number; date: DateStr; utcMs: number };
  const moments: Moment[] = [];
  const seen = new Set<number>();
  let droppedQuiet = 0;
  const active = input.reminders.filter((r) => r.enabled).sort((a, b) => a.id - b.id);
  // From yesterday: a reminder after midnight may still belong to yesterday's journal day and anchor "previous".
  for (let i = -1; i <= horizon; i++) {
    const date = addDays(today, i);
    for (const r of active) {
      if (!remindsOn(r.weekdays, date)) continue;
      const time = formatTime(r.hour, r.minute);
      if (input.quietHours && inQuietHours(time, input.quietHours)) {
        if (i >= 0) droppedQuiet++;
        continue;
      }
      const utcMs = localToUtc(date, time, input.offsetAt);
      if (seen.has(utcMs)) continue;
      seen.add(utcMs);
      moments.push({ reminderId: r.id, date, utcMs });
    }
  }
  moments.sort((a, b) => a.utcMs - b.utcMs);
  const scheduled: PlannedReminder[] = [];
  let skippedLogged = 0;
  const lastMomentOfJournalDay = new Map<DateStr, number>();
  for (const m of moments) {
    const jd = journalDayOf(m.utcMs, input.offsetAt, input.dayEndHour).localDate;
    const previous = lastMomentOfJournalDay.get(jd) ?? -Infinity;
    lastMomentOfJournalDay.set(jd, m.utcMs);
    if (m.utcMs <= input.nowMs) continue; // past: only an anchor for the next one
    if (input.skipIfLogged && input.entriesMadeOn(jd).some((c) => c >= previous && c < m.utcMs)) {
      skippedLogged++;
      continue;
    }
    const wall = wallClock(m.utcMs, input.offsetAt);
    scheduled.push({
      identifier: `${ID_PREFIX}${m.reminderId}-${m.date}`,
      reminderId: m.reminderId,
      date: wall.date,
      time: wall.time,
      journalDate: jd,
      utcMs: m.utcMs,
      title: input.title,
      body: input.body,
    });
  }
  return { scheduled: scheduled.slice(0, max), skippedLogged, droppedQuiet, truncated: scheduled.length > max };
}

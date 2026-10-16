// What the widgets show (SPEC flow 10, A11, D20) — PURE, so Jest pins it. iOS gets a timeline (now + the next
// journal-day start, so "today" clears at the day boundary without the app); Android gets the same facts and redraws
// itself at the boundary (modules/mood-widget). Privacy (SPEC): widgets show only a colour and the streak; with the
// app lock on they show "Mood" and the faces, never today's mood or the streak.
import { addDays, localToUtc, type DateStr, type OffsetAt } from '@/engine/dates';

export type WidgetFace = { level: number; emoji: string; color: string; name: string; url: string };

export type MoodWidgetProps = {
  locked: boolean;
  title: string;
  faces: WidgetFace[];
  /** Pixel colour of today (Formula 7), null = nothing logged today (or locked). */
  todayColor: string | null;
  todayText: string;
  streakText: string;
  /** Short streak for the round Lock Screen widget ("5"), "" when locked or none. */
  streakShort: string;
  logUrl: string;
  logLabel: string;
};

export type WidgetFacts = {
  scheme: string;
  locked: boolean;
  /** Level's first active mood, 5 → 1. */
  faces: { level: number; emoji: string; color: string; name: string }[];
  today: DateStr;
  todayColor: string | null;
  /** Current streak ending today (or yesterday, D54). */
  streak: number;
  loggedToday: boolean;
  dayEndHour: number;
};

export type WidgetWords = {
  title: string;
  locked: string;
  log: string;
  notYet: string;
  loggedToday: string;
  streak: (n: number) => string;
  noStreak: string;
};

export const faceUrl = (scheme: string, level: number) => `${scheme}://new?mood=${level}`;

function props(f: WidgetFacts, w: WidgetWords, day: { todayColor: string | null; logged: boolean; streak: number }): MoodWidgetProps {
  const faces = f.faces.map((x) => ({ ...x, url: faceUrl(f.scheme, x.level) }));
  const base = { faces, logUrl: `${f.scheme}://new`, logLabel: w.log };
  if (f.locked) return { ...base, locked: true, title: w.locked, todayColor: null, todayText: '', streakText: '', streakShort: '' };
  return {
    ...base,
    locked: false,
    title: w.title,
    todayColor: day.todayColor,
    todayText: day.logged ? w.loggedToday : w.notYet,
    streakText: day.streak > 0 ? w.streak(day.streak) : w.noStreak,
    streakShort: day.streak > 0 ? String(day.streak) : '',
  };
}

/** UTC ms when the journal day after `today` starts (its day-end hour, local; DST-safe through localToUtc). */
export function nextDayStart(today: DateStr, dayEndHour: number, offsetAt: OffsetAt): number {
  return localToUtc(addDays(today, 1), `${String(dayEndHour).padStart(2, '0')}:00`, offsetAt);
}

/**
 * Now: today as it is. From the next journal day on: nothing logged yet; the streak stays alive if today was logged
 * (it ends at yesterday, D54), else it is 0. A third entry two days ahead: the streak is broken by then.
 */
export function widgetTimeline(f: WidgetFacts, w: WidgetWords, nowMs: number, offsetAt: OffsetAt): { date: number; props: MoodWidgetProps }[] {
  const first = nextDayStart(f.today, f.dayEndHour, offsetAt);
  const second = nextDayStart(addDays(f.today, 1), f.dayEndHour, offsetAt);
  return [
    { date: nowMs, props: props(f, w, { todayColor: f.todayColor, logged: f.loggedToday, streak: f.streak }) },
    { date: first, props: props(f, w, { todayColor: null, logged: false, streak: f.loggedToday ? f.streak : 0 }) },
    { date: second, props: props(f, w, { todayColor: null, logged: false, streak: 0 }) },
  ];
}

import { zoneOffsetFn } from '@/engine/dates';

import { faceUrl, nextDayStart, widgetTimeline, type WidgetFacts, type WidgetWords } from './widget-data';

const berlin = zoneOffsetFn('Europe/Berlin');
const words: WidgetWords = { title: 'How are you?', locked: 'Mood', log: 'Log', notYet: 'Not logged yet', loggedToday: 'Logged today', streak: (n) => `${n} days in a row`, noStreak: 'Start today' };
const facts: WidgetFacts = {
  scheme: 'moodjournal',
  locked: false,
  faces: [5, 4, 3, 2, 1].map((level) => ({ level, emoji: String(level), color: '#000000', name: `L${level}` })),
  today: '2026-10-16',
  todayColor: '#2E9E5B',
  streak: 4,
  loggedToday: true,
  dayEndHour: 3,
};

describe('widget timeline (A11, D20)', () => {
  it('faces open new?mood=<level>; the plain tap opens new', () => {
    const [now] = widgetTimeline(facts, words, 1, berlin);
    expect(now.props.faces.map((f) => f.url)).toEqual([5, 4, 3, 2, 1].map((l) => `moodjournal://new?mood=${l}`));
    expect(now.props.logUrl).toBe('moodjournal://new');
    expect(faceUrl('moodjournal-dev', 3)).toBe('moodjournal-dev://new?mood=3');
  });
  it('today, then the next journal day at its day-end hour (DST-safe), then the day after', () => {
    const t = widgetTimeline(facts, words, 1, berlin);
    expect(t[0].props).toMatchObject({ todayColor: '#2E9E5B', todayText: 'Logged today', streakText: '4 days in a row', streakShort: '4' });
    expect(new Date(t[1].date).toISOString()).toBe('2026-10-17T01:00:00.000Z'); // 03:00 CEST
    expect(t[1].props).toMatchObject({ todayColor: null, todayText: 'Not logged yet', streakText: '4 days in a row' });
    expect(new Date(t[2].date).toISOString()).toBe('2026-10-18T01:00:00.000Z');
    expect(t[2].props).toMatchObject({ streakText: 'Start today', streakShort: '' });
    // across the October DST change: 03:00 CET on 26 Oct = 02:00 UTC
    expect(new Date(nextDayStart('2026-10-25', 3, berlin)).toISOString()).toBe('2026-10-26T02:00:00.000Z');
  });
  it('not logged today: the streak is gone at the next day start', () => {
    const t = widgetTimeline({ ...facts, loggedToday: false, todayColor: null, streak: 2 }, words, 1, berlin);
    expect(t[0].props.streakText).toBe('2 days in a row');
    expect(t[1].props.streakText).toBe('Start today');
  });
  it('locked: "Mood" and the faces, never today’s colour or the streak (SPEC Privacy)', () => {
    for (const e of widgetTimeline({ ...facts, locked: true }, words, 1, berlin)) {
      expect(e.props).toMatchObject({ locked: true, title: 'Mood', todayColor: null, todayText: '', streakText: '', streakShort: '' });
      expect(e.props.faces).toHaveLength(5);
    }
  });
});

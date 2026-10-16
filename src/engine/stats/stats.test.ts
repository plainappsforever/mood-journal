import { makeT } from '@/lib/i18n';

import { addDays } from '../dates';

import {
  activityDetail,
  averageMood,
  byWeekday,
  compareEntries,
  compareNextDay,
  compareSameDay,
  comparisonLabel,
  comparisonSentence,
  dayIndex,
  formatAverage,
  formatFrequency,
  formatStreak,
  frequencies,
  levelDetail,
  monthGrid,
  moodCounts,
  moodSeries,
  oftenTogether,
  overview,
  pixelLevels,
  preparePeriod,
  topPairs,
  welch,
  yearPixels,
  type StatEntry,
} from './index';

let nextId = 1;
const e = (date: string, level: number, acts: number[] = [], moodId = level): StatEntry => ({ id: nextId++, moodId, level, date, activityIds: acts });
const SPORT = 1;
const WALK = 2;
const FRIENDS = 3;

const en = { t: makeT('en'), language: 'en' as const, locale: 'en-US' };
const de = { t: makeT('de'), language: 'de' as const, locale: 'de-DE' };

describe('Formulas 1–3: day values, day-weighted average, counts', () => {
  // 1 Oct: 5, 3 (v = 4); 2 Oct: 2 (v = 2); 4 Oct: 4, 4, 1 (v = 3)
  const entries = [e('2026-10-01', 5, [SPORT]), e('2026-10-01', 3), e('2026-10-02', 2), e('2026-10-04', 4), e('2026-10-04', 4, [], 9), e('2026-10-04', 1)];
  const days = dayIndex(entries);

  it('day value = mean of the day; average = mean of day values (not of entries)', () => {
    expect([...days.values()].map((d) => [d.date, d.value, d.entries])).toEqual([
      ['2026-10-01', 4, 2],
      ['2026-10-02', 2, 1],
      ['2026-10-04', 3, 3],
    ]);
    expect(averageMood(days)).toEqual({ value: 3, rounded: 3, days: 3, entries: 6 }); // entry mean would be 3.1666
  });

  it('rounds half up to one decimal: 3.85 → 3.9, 3.25 → 3.3, 3.35 → 3.4', () => {
    const avg = (values: number[][]) => averageMood(dayIndex(values.flatMap((levels, i) => levels.map((l) => e(addDays('2026-01-01', i), l))))).rounded;
    // day values 4, 3.7 → 3.85
    expect(avg([[4], [4, 4, 4, 4, 4, 4, 4, 3, 3, 3]])).toBe(3.9); // 37/10 = 3.7
    expect(avg([[3], [3], [4], [3]])).toBe(3.3); // 13/4 = 3.25
    expect(avg([[3], [4, 3], [4], [3]])).toBe(3.4); // (3+3.5+4+3)/4 = 3.375 → 3.4
  });

  it('counts entries per mood and per level', () => {
    const c = moodCounts(entries);
    expect(c.byLevel).toEqual({ 1: 1, 2: 1, 3: 1, 4: 2, 5: 1 });
    expect(c.byMood.get(4)).toBe(1);
    expect(c.byMood.get(9)).toBe(1);
  });

  it('formats the average with its basis, in English and German', () => {
    expect(formatAverage(en, averageMood(days))).toEqual({ value: '3.0', basis: 'from 3 days, 6 entries' });
    expect(formatAverage(de, averageMood(dayIndex([e('2026-10-01', 4)])))).toEqual({ value: '4,0', basis: 'aus 1 Tag, 1 Eintrag' });
    expect(formatAverage(en, averageMood(new Map())).basis).toBe('No entries in this period');
  });
});

describe('Formulas 4–7: series, weekday, months, pixels', () => {
  it('daily series up to 92 days with gaps, weekly up to 731, monthly beyond', () => {
    const entries = [e('2026-01-05', 5), e('2026-01-07', 3), e('2026-01-07', 4), e('2026-01-12', 1)];
    const days = dayIndex(entries);
    expect(moodSeries(days, { start: '2026-01-01', end: '2026-04-02' }, 1)).toEqual({
      mode: 'day',
      points: [
        { key: '2026-01-05', value: 5, n: 1 },
        { key: '2026-01-07', value: 3.5, n: 1 },
        { key: '2026-01-12', value: 1, n: 1 },
      ],
    });
    // 93 days → weekly; Monday weeks: 5 Jan (5, 3.5) and 12 Jan (1)
    expect(moodSeries(days, { start: '2026-01-01', end: '2026-04-03' }, 1)).toEqual({
      mode: 'week',
      points: [
        { key: '2026-01-05', value: 4.25, n: 2 },
        { key: '2026-01-12', value: 1, n: 1 },
      ],
    });
    // Sunday weeks: 4 Jan (5, 3.5), 11 Jan (1)
    expect(moodSeries(days, { start: '2026-01-01', end: '2027-01-01' }, 7).points.map((p) => p.key)).toEqual(['2026-01-04', '2026-01-11']);
    expect(moodSeries(days, { start: '2025-01-01', end: '2027-01-01' }, 1)).toMatchObject({ mode: 'week' }); // 731 days
    expect(moodSeries(days, { start: '2025-01-01', end: '2027-01-02' }, 1)).toEqual({ mode: 'month', points: [{ key: '2026-01', value: 19 / 6, n: 3 }] });
  });

  it('by weekday (ISO, all seven present) and pixel levels with 3.5 → 4, 2.5 → 3', () => {
    const days = dayIndex([e('2026-10-12', 4), e('2026-10-12', 3), e('2026-10-19', 2), e('2026-10-13', 3), e('2026-10-13', 2)]);
    const wd = byWeekday(days);
    expect(wd[0]).toEqual({ mean: 2.75, n: 2 }); // Mondays 3.5 and 2
    expect(wd[1]).toEqual({ mean: 2.5, n: 1 });
    expect(wd[6]).toEqual({ mean: null, n: 0 });
    expect(Object.fromEntries(pixelLevels(days))).toEqual({ '2026-10-12': 4, '2026-10-13': 3, '2026-10-19': 2 });
  });

  it('Year in Pixels has 29 Feb only in leap years; month grid follows the week start', () => {
    const leap = yearPixels([e('2024-02-29', 2), e('2024-12-31', 5), e('2025-01-01', 1)], 2024);
    expect(leap.months.map((m) => m.length)).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(leap.months[1][28]).toEqual({ date: '2024-02-29', level: 2 });
    expect(leap.logged).toBe(2);
    expect(yearPixels([], 2025).months[1]).toHaveLength(28);
    // October 2026 starts on a Thursday
    expect(monthGrid(2026, 10, 1)[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(monthGrid(2026, 10, 7)[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(monthGrid(2021, 2, 1)).toHaveLength(4); // Feb 2021: Monday 1st, 28 days → exactly 4 rows
    expect(monthGrid(2026, 2, 1)).toHaveLength(5); // Feb 2026 starts on a Sunday
  });
});

describe('Formula 8: with / without comparisons and labels', () => {
  it('labels: not enough < 3, few < 10, then Welch |t| ≥ 3 clear (D52), ≥ 1 small, else none', () => {
    expect(welch([5, 5], [1, 1, 1], 'entries').label).toBe('notEnough');
    expect(welch([5, 5, 4], [1, 1, 1], 'entries').label).toBe('few');
    const ten = (v: number[]) => Array.from({ length: 10 }, (_, i) => v[i % v.length]);
    expect(welch(ten([5, 4]), ten([2, 1]), 'entries')).toMatchObject({ label: 'clear', withMean: 4.5, withoutMean: 1.5, delta: 3 });
    // equal variance 1/3·… : hand computed t for [4,3] vs [3.5,3] patterns
    const small = welch(ten([4, 3]), ten([3.5, 3]), 'entries'); // Δ = 0.25, s² = 0.2778 / 0.0694 → t = 1.342
    expect(small.label).toBe('small');
    expect(small.t).toBeCloseTo(0.25 / Math.sqrt(0.25 * 10 / 9 / 10 + 0.0625 * 10 / 9 / 10), 10);
    expect(welch(ten([4, 3]), ten([3, 4]), 'entries')).toMatchObject({ label: 'none', t: 0 });
    expect(welch(ten([5]), ten([1]), 'entries')).toMatchObject({ label: 'clear', t: Infinity });
    expect(welch(ten([3]), ten([3]), 'entries')).toMatchObject({ label: 'none', t: 0 });
    // review S1 / D52 boundary: t = 0.5 / √(2 · 0.2778 / 10) = 2.12 was "clear" with |t| ≥ 2, now "small"; 3.18 clear
    const two = welch(ten([4, 3]), ten([3.5, 2.5]), 'entries');
    expect(two.t).toBeCloseTo(2.1213, 3);
    expect(two.label).toBe('small');
    const three = welch(ten([4, 3]), ten([3.25, 2.25]), 'entries');
    expect(three.t).toBeCloseTo(3.182, 3);
    expect(three.label).toBe('clear');
    // 1 ≤ |t| < 3 is worded "could be chance" (D57; was "small difference", ~31 % of null comparisons land here)
    expect(comparisonLabel(en, two)).toBe('Could be chance');
    expect(comparisonLabel(de, two)).toBe('Könnte Zufall sein');
    expect(comparisonLabel(en, three)).toBe('Clear difference');
  });

  it('entries, same-day and next-day modes count different things', () => {
    // d1: sport 5, plain 3 | d2: 2 | d3: sport 4 | d5: 1 (no d4 → (d3, d4) is not a pair)
    const entries = [e('2026-10-01', 5, [SPORT]), e('2026-10-01', 3), e('2026-10-02', 2), e('2026-10-03', 4, [SPORT]), e('2026-10-05', 1)];
    const days = dayIndex(entries);
    expect(compareEntries(entries, SPORT)).toMatchObject({ withMean: 4.5, withN: 2, withoutMean: 2, withoutN: 3 });
    expect(compareSameDay(days, SPORT)).toMatchObject({ withMean: 4, withN: 2, withoutMean: 1.5, withoutN: 2 });
    // pairs: (1→2) sport day, (2→3) not → with: [2], without: [4]
    expect(compareNextDay(days, SPORT)).toMatchObject({ withMean: 2, withN: 1, withoutMean: 4, withoutN: 1, label: 'notEnough' });
  });

  it('plain-word sentences, never causal', () => {
    const c = welch([5, 4, 4], [3, 3, 4], 'entries');
    expect(comparisonSentence(en, c, 'sport')).toBe('Entries with sport: 4.3 (3). Without: 3.3 (3).');
    expect(comparisonLabel(en, c)).toBe('Few entries so far');
    expect(comparisonLabel(en, { ...c, mode: 'sameDay' })).toBe('Few days so far');
    expect(comparisonSentence(de, { ...c, mode: 'nextDay' }, 'Sport')).toBe('Tag nach Sport: 4,3 (3). Tag nach Tagen ohne: 3,3 (3).');
    expect(comparisonSentence(en, welch([5], [1, 2, 3], 'entries'), 'sport')).toBeNull();
  });
});

describe('Formulas 9–11: often together, related per level, frequency', () => {
  const entries = [
    e('2026-10-01', 5, [SPORT, WALK, FRIENDS]),
    e('2026-10-02', 4, [SPORT, WALK]),
    e('2026-10-03', 4, [SPORT, FRIENDS]),
    e('2026-10-04', 2, [SPORT, WALK]),
    e('2026-10-05', 2, [WALK, FRIENDS]),
    e('2026-10-06', 2, [WALK, FRIENDS]),
  ];

  it('often together: count desc then id, share of entries with the activity; top pairs need ≥ 3', () => {
    expect(oftenTogether(entries, SPORT)).toEqual([
      { activityId: WALK, count: 3, share: 0.75 },
      { activityId: FRIENDS, count: 2, share: 0.5 },
    ]);
    expect(topPairs(entries)).toEqual([
      { a: SPORT, b: WALK, count: 3 },
      { a: WALK, b: FRIENDS, count: 3 },
    ]);
  });

  it('related activities per level and frequency vs the previous period', () => {
    expect(levelDetail(preparePeriod(entries, { start: '2026-10-01', end: '2026-10-31' }), 2)).toEqual([
      { activityId: WALK, count: 3, share: 1 },
      { activityId: FRIENDS, count: 2, share: 2 / 3 },
      { activityId: SPORT, count: 1, share: 1 / 3 },
    ]);
    const f = frequencies(entries, { start: '2026-10-04', end: '2026-10-06' }, [SPORT, WALK, 99]);
    expect(f.get(SPORT)).toEqual({ current: 1, previous: 3, difference: -2 });
    expect(f.get(WALK)).toEqual({ current: 3, previous: 2, difference: 1 });
    expect(f.get(99)).toEqual({ current: 0, previous: 0, difference: 0 });
    expect(formatFrequency(en, -2)).toBe('2 fewer than the previous period');
    expect(formatFrequency(de, 0)).toBe('Gleich wie im vorigen Zeitraum');
  });

  it('only entries inside the period count; detail bundles agree with the single functions', () => {
    const p = { start: '2026-10-02', end: '2026-10-06' };
    const d = activityDetail(preparePeriod(entries, p), SPORT);
    expect(d.entries).toMatchObject({ withN: 3, withoutN: 2 });
    expect(d.counts.byLevel).toEqual({ 1: 0, 2: 1, 3: 0, 4: 2, 5: 0 });
    const o = overview(entries, p, 1, [SPORT, WALK, FRIENDS]);
    expect(o.average).toMatchObject({ days: 5, entries: 5 });
    expect(o.topPairs).toEqual([]); // inside the period no pair reaches 3
  });

  it('streak wording', () => {
    expect(formatStreak(en, 12, 40)).toBe('12 days in a row (longest 40)');
    expect(formatStreak(en, 1, 1)).toBe('1 day in a row (longest 1)');
    expect(formatStreak(de, 0, 0)).toBe('Noch keine Tage in Folge');
  });
});

describe('performance guard (SPEC Big journals)', () => {
  it('20,000 entries (10 years × 5/day, 30 activities): overview + every activity detail ≤ 1 s', () => {
    const big: StatEntry[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 4000; i++) {
      const date = addDays('2016-10-16', i);
      for (let k = 0; k < 5; k++) {
        const acts = Array.from({ length: 30 }, (_, a) => a + 1).filter(() => rand() < 0.15);
        big.push({ id: big.length + 1, moodId: 1, level: 1 + Math.floor(rand() * 5), date, activityIds: acts });
      }
    }
    const p = { start: '2016-10-16', end: '2027-10-01' };
    const ids = Array.from({ length: 30 }, (_, a) => a + 1);
    const started = performance.now();
    const o = overview(big, p, 1, ids);
    const overviewMs = performance.now() - started;
    for (const a of ids) activityDetail(o.data, a);
    for (let l = 1; l <= 5; l++) levelDetail(o.data, l);
    yearPixels(big, 2020);
    const ms = performance.now() - started;
    console.log(`stats for ${big.length} entries: overview ${overviewMs.toFixed(0)} ms, all ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

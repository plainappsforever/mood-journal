/**
 * @jest-environment node
 */
// Engine vs the independent Python oracle (test/oracle/stats_oracle.py, SPEC Formulas 1–14, A3, D32).
// The generator writes ORACLE_COUNT seeded random journals (default 2,000), the oracle computes the expected JSON
// with exact fractions, and this test computes the same with the TypeScript engines. Counts, labels, dates and
// orderings must be identical; means, shares and t within 1e-9 (relative for |t| > 1).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { journalDayOf, utcForJournalTime, zoneOffsetFn, type GoalPeriod, type WeekStart } from '../dates';
import { computeGoal } from '../goals';
import { computeStreak } from '../streaks';

import {
  averageMood,
  byMonth,
  byWeekday,
  byYear,
  compareEntries,
  compareNextDay,
  compareSameDay,
  dayIndex,
  entriesIn,
  frequencies,
  moodCounts,
  moodSeries,
  oftenTogether,
  pixelLevels,
  relatedForLevel,
  topPairs,
  type Comparison,
  type StatEntry,
} from './index';

type Journal = {
  id: string;
  week_start: WeekStart;
  today: string;
  period: { start: string; end: string; kind?: 'days' | 'month' | 'year' };
  moods: { id: number; level: number; archived: boolean }[];
  activities: { id: number; archived: boolean }[];
  entries: { id: number; mood_id: number; date: string; time: string; activities: number[] }[];
  goals: { id: number; activity_id: number; period: GoalPeriod; target: number; start_date: string }[];
  journal_day_cases: { zone: string; utc_ms: number; day_end_hour: number }[];
  edit_cases: { zone: string; date: string; time: string; day_end_hour: number }[];
};

const ROOT = join(__dirname, '..', '..', '..');
const OUT = join(ROOT, 'artifacts', 'oracle');
const SEED = Number(process.env.ORACLE_SEED ?? 20261016);
const COUNT = Number(process.env.ORACLE_COUNT ?? 2000);

const zones = new Map<string, ReturnType<typeof zoneOffsetFn>>();
const zone = (z: string) => zones.get(z) ?? zones.set(z, zoneOffsetFn(z)).get(z)!;

function cmp(c: Comparison) {
  const t = c.t === null ? null : c.t === Infinity ? 'inf' : c.t === -Infinity ? '-inf' : c.t;
  const label = { notEnough: 'not_enough', few: 'few', clear: 'clear', small: 'small', none: 'none' }[c.label];
  return { with_mean: c.withMean, with_n: c.withN, without_mean: c.withoutMean, without_n: c.withoutN, delta: c.delta, t, label };
}

const meanPair = (m: { mean: number | null; n: number }) => [m.mean, m.n];

/** The engine's answer in the oracle's JSON shape. */
function engine(j: Journal) {
  const levelOf = new Map(j.moods.map((m) => [m.id, m.level]));
  const all: StatEntry[] = j.entries.map((e) => ({ id: e.id, moodId: e.mood_id, level: levelOf.get(e.mood_id)!, date: e.date, activityIds: e.activities }));
  const inP = entriesIn(all, j.period);
  const days = dayIndex(inP);
  const avg = averageMood(days);
  const counts = moodCounts(inP);
  const series = moodSeries(days, j.period, j.week_start);
  const actIds = j.activities.map((a) => a.id);
  const archived = new Set(j.activities.filter((a) => a.archived).map((a) => a.id));
  const freq = frequencies(all, j.period, actIds);
  const streak = computeStreak(all.map((e) => e.date), j.today);
  return {
    id: j.id,
    day_values: Object.fromEntries([...days].map(([d, i]) => [d, i.value])),
    average: { value: avg.value, display: avg.rounded === null ? null : avg.rounded.toFixed(1), days: avg.days, entries: avg.entries },
    counts: {
      by_mood: Object.fromEntries([...counts.byMood].map(([k, v]) => [String(k), v])),
      by_level: Object.fromEntries(Object.entries(counts.byLevel).map(([k, v]) => [k, v])),
    },
    series: { mode: series.mode, points: series.points.map((p) => [p.key, p.value, p.n]) },
    weekday: Object.fromEntries(byWeekday(days).map((m, i) => [String(i + 1), meanPair(m)])),
    monthly: Object.fromEntries([...byMonth(days)].map(([k, m]) => [k, meanPair(m)])),
    yearly: Object.fromEntries([...byYear(days)].map(([k, m]) => [k, meanPair(m)])),
    pixels: Object.fromEntries(pixelLevels(days)),
    comparisons: Object.fromEntries(
      actIds.map((a) => [String(a), { entries: cmp(compareEntries(inP, a)), same_day: cmp(compareSameDay(days, a)), next_day: cmp(compareNextDay(days, a)) }])
    ),
    together: Object.fromEntries(actIds.map((a) => [String(a), oftenTogether(inP, a).map((r) => [r.activityId, r.count, r.share])])),
    top_pairs: topPairs(inP).map((p) => [p.a, p.b, p.count]),
    related: Object.fromEntries([1, 2, 3, 4, 5].map((l) => [String(l), relatedForLevel(inP, l).map((r) => [r.activityId, r.count, r.share])])),
    frequency: Object.fromEntries(actIds.map((a) => [String(a), [freq.get(a)!.current, freq.get(a)!.previous, freq.get(a)!.difference]])),
    streak: [streak.current, streak.longest],
    goals: Object.fromEntries(
      j.goals.map((g) => {
        const daysWith = all.filter((e) => e.activityIds.includes(g.activity_id)).map((e) => e.date);
        const r = computeGoal({ period: g.period, target: g.target, startDate: g.start_date, activityArchived: archived.has(g.activity_id) }, daysWith, j.today, j.week_start);
        return [
          String(g.id),
          { paused: r.paused, instances: r.instances.map((i) => [i.start, i.end, i.count, i.success, i.complete]), streak: r.streak, success_rate: r.successRate },
        ];
      })
    ),
    journal_day: j.journal_day_cases.map((c) => {
      const r = journalDayOf(c.utc_ms, zone(c.zone), c.day_end_hour);
      return [r.localDate, r.localTime];
    }),
    edit_utc: j.edit_cases.map((c) => utcForJournalTime(c.date, c.time, c.day_end_hour, zone(c.zone))),
  };
}

/** Deep comparison; returns the paths that differ. */
function diff(expected: unknown, actual: unknown, path: string, out: string[]) {
  if (out.length > 50) return;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tol = Math.max(1e-9, 1e-9 * Math.abs(expected));
    if (!(Math.abs(expected - actual) <= tol)) out.push(`${path}: expected ${expected}, got ${actual}`);
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push(`${path}: length ${expected.length} vs ${actual.length}`);
    else expected.forEach((e, i) => diff(e, actual[i], `${path}[${i}]`, out));
    return;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const ek = Object.keys(expected).sort();
    const ak = Object.keys(actual).sort();
    if (ek.join() !== ak.join()) {
      out.push(`${path}: keys ${ek.filter((k) => !ak.includes(k)).join(',')} missing / ${ak.filter((k) => !ek.includes(k)).join(',')} extra`);
      return;
    }
    for (const k of ek) diff((expected as Record<string, unknown>)[k], (actual as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  if (expected !== actual) out.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

describe('statistics engine vs independent oracle', () => {
  let journals: Journal[];
  let expected: ReturnType<typeof engine>[];

  beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
    const journalsFile = join(OUT, 'journals.json');
    const expectedFile = join(OUT, 'expected.json');
    execFileSync('python3', ['-I', join(ROOT, 'test/oracle/gen_journals.py'), String(SEED), String(COUNT), journalsFile]);
    execFileSync('python3', ['-I', join(ROOT, 'test/oracle/stats_oracle.py'), journalsFile, expectedFile]);
    journals = JSON.parse(readFileSync(journalsFile, 'utf8'));
    expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
  }, 180_000);

  it(`matches on every journal (seed ${SEED}, ${COUNT} journals)`, () => {
    expect(journals.length).toBe(COUNT);
    const mismatches: string[] = [];
    let entries = 0;
    for (let i = 0; i < journals.length; i++) {
      entries += journals[i].entries.length;
      diff(expected[i], engine(journals[i]), journals[i].id, mismatches);
    }
    // Coverage of the edge cases the generator promises.
    const labels = new Set(expected.flatMap((e) => Object.values(e.comparisons).flatMap((c) => [c.entries.label, c.same_day.label, c.next_day.label])));
    const modes = new Set(expected.map((e) => e.series.mode));
    const kinds = journals.reduce<Record<string, number>>((k, j) => ({ ...k, [j.period.kind ?? 'days']: (k[j.period.kind ?? 'days'] ?? 0) + 1 }), {});
    console.log(
      `oracle: ${journals.length} journals, ${entries} entries, labels ${[...labels].sort().join('/')}, series ${[...modes].sort().join('/')}, periods ${JSON.stringify(kinds)}, mismatches ${mismatches.length}`
    );
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect([...labels].sort()).toEqual(['clear', 'few', 'none', 'not_enough', 'small']);
    expect([...modes].sort()).toEqual(['day', 'month', 'week']);
    expect(Object.keys(kinds).sort()).toEqual(['days', 'month', 'year']); // calendar chips of Formula 11 (D53) covered
    const infinite = expected.some((e) => Object.values(e.comparisons).some((c) => c.entries.t === 'inf' || c.entries.t === '-inf'));
    expect(infinite).toBe(true);
  });

  it('the comparison itself catches a wrong engine (mutation self-check)', () => {
    const j = journals.find((x) => x.entries.length > 50)!;
    const e = expected[journals.indexOf(j)];
    const wrong = engine(j);
    const day = Object.keys(wrong.day_values)[0];
    wrong.day_values[day] += 1e-6;
    wrong.streak = [wrong.streak[0] + 1, wrong.streak[1]];
    const found: string[] = [];
    diff(e, wrong, j.id, found);
    expect(found).toHaveLength(2);
  });
});

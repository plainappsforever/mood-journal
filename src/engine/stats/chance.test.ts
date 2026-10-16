// Review S1 / D52: how often do the comparison labels fire on pure chance? 200 seeded one-year journals, ~2 entries a
// day, 20 activities statistically independent of mood (the reviewer's null-hypothesis probe, rebuilt in the repo).
// With |t| ≥ 2 the reviewer measured "clear" in 4.8–5.5 % of comparisons and in 193 of 200 journals.
import { addDays } from '../dates';

import { compareEntries, compareNextDay, compareSameDay, type CompareLabel, type Comparison } from './compare';
import { dayIndex, entriesIn, nextDayPairs } from './days';
import type { StatEntry } from './types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JOURNALS = 200;
const ACTIVITIES = 20;
const START = '2025-10-17';
const END = '2026-10-16';

function nullJournal(rng: () => number): StatEntry[] {
  const p = Array.from({ length: ACTIVITIES }, () => 0.05 + rng() * 0.45);
  const weights = [0.08, 0.15, 0.3, 0.3, 0.17]; // level 1…5, a typical skew; independent of every activity
  const level = () => {
    let r = rng();
    for (let l = 0; l < 5; l++) if ((r -= weights[l]) < 0) return l + 1;
    return 5;
  };
  const out: StatEntry[] = [];
  for (let day = START; day <= END; day = addDays(day, 1)) {
    if (rng() < 0.15) continue; // unlogged day
    const n = 1 + Math.floor(rng() * 3); // 1–3 entries, ~2 a day
    for (let k = 0; k < n; k++) {
      out.push({ id: out.length + 1, moodId: 1, level: level(), date: day, activityIds: p.flatMap((q, a) => (rng() < q ? [a + 1] : [])) });
    }
  }
  return out;
}

type Tally = Record<CompareLabel, number>;
const empty = (): Tally => ({ notEnough: 0, few: 0, clear: 0, small: 0, none: 0 });
const pct = (t: Tally, k: CompareLabel) => (100 * t[k]) / Object.values(t).reduce((a, b) => a + b, 0);

describe('comparison labels on chance (review S1, D52)', () => {
  it('|t| ≥ 3: "clear difference" fires on well under 1 % of null comparisons', () => {
    const rng = mulberry32(20261016);
    const modes = { entries: empty(), sameDay: empty(), nextDay: empty(), last30entries: empty() };
    let journalsWithClear = 0;
    let journalsWithOldClear = 0; // the same comparisons judged with the old |t| ≥ 2
    let oldClear = 0;
    let labelled = 0;
    for (let j = 0; j < JOURNALS; j++) {
      const all = nullJournal(rng);
      const days = dayIndex(all);
      const pairs = nextDayPairs(days);
      const last30 = entriesIn(all, { start: addDays(END, -29), end: END });
      let clear = false;
      let old = false;
      for (let a = 1; a <= ACTIVITIES; a++) {
        const results: [keyof typeof modes, Comparison][] = [
          ['entries', compareEntries(all, a)],
          ['sameDay', compareSameDay(days, a)],
          ['nextDay', compareNextDay(days, a, pairs)],
          ['last30entries', compareEntries(last30, a)],
        ];
        for (const [m, c] of results) {
          modes[m][c.label]++;
          if (c.label === 'clear') clear = true;
          if (c.t !== null) {
            labelled++;
            if (Math.abs(c.t) >= 2) {
              oldClear++;
              old = true;
            }
          }
        }
      }
      if (clear) journalsWithClear++;
      if (old) journalsWithOldClear++;
    }
    const rows = Object.entries(modes).map(([m, t]) => `${m}: none ${pct(t, 'none').toFixed(1)} % · small ${pct(t, 'small').toFixed(1)} % · clear ${pct(t, 'clear').toFixed(2)} % · few/notEnough ${(pct(t, 'few') + pct(t, 'notEnough')).toFixed(1)} %`);
    console.log(`chance test (${JOURNALS} journals × ${ACTIVITIES} activities, |t| ≥ 3):\n${rows.join('\n')}\njournals with ≥ 1 "clear": ${journalsWithClear} / ${JOURNALS}\nold rule |t| ≥ 2 on the same data: ${((100 * oldClear) / labelled).toFixed(2)} % of labelled comparisons, ${journalsWithOldClear} / ${JOURNALS} journals`);
    for (const m of ['entries', 'sameDay', 'nextDay'] as const) expect(pct(modes[m], 'clear')).toBeLessThan(1);
    expect(journalsWithClear).toBeLessThan(JOURNALS / 2);
    expect(journalsWithOldClear).toBeGreaterThan(journalsWithClear); // the probe really is noisy
  });
});

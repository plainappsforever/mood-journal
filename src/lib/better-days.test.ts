import type { StatEntry } from '@/engine/stats';

import { betterDaysActivity } from './better-days';

let n = 0;
const e = (date: string, level: number, activityIds: number[]): StatEntry => ({ id: ++n, moodId: level, level, date, activityIds });
const day = (i: number) => `2026-03-${String(i).padStart(2, '0')}`;

describe('better days activity', () => {
  it('stays hidden with fewer than 7 logged days', () => {
    expect(betterDaysActivity([1, 2, 3, 4, 5, 6].map((i) => e(day(i), 5, [1])))).toBeNull();
  });

  it('finds the activity that is mostly on good days', () => {
    const all = [
      ...[1, 2, 3, 4].map((i) => e(day(i), 5, [7])), // walk on good days
      ...[5, 6, 7, 8].map((i) => e(day(i), 2, [9])), // gaming on bad days
      e(day(9), 4, []),
      e(day(10), 1, []),
    ];
    expect(betterDaysActivity(all)).toBe(7);
  });

  it('says nothing when no activity beats the overall share', () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => e(day(i), i % 2 ? 5 : 1, [3]));
    expect(betterDaysActivity(all)).toBeNull();
  });
});

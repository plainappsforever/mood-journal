import { computeGoal, type GoalInput } from './goals';

const goal = (over: Partial<GoalInput>): GoalInput => ({ period: 'week', target: 3, startDate: '2026-09-28', activityArchived: false, ...over });

describe('Formula 13 — goals', () => {
  // Weeks (Monday start): 28 Sep, 5 Oct, 12 Oct (current; today Fri 16 Oct)
  const sport = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-13', '2026-10-14', '2026-10-15'];

  it('week goal: counts distinct days, success, streak incl. the already successful current week, rate', () => {
    const r = computeGoal(goal({}), [...sport, '2026-10-15'], '2026-10-16', 1);
    expect(r.instances.map((i) => [i.start, i.count, i.success, i.complete])).toEqual([
      ['2026-09-28', 3, true, true],
      ['2026-10-05', 2, false, true],
      ['2026-10-12', 3, true, false],
    ]);
    expect(r.current).toMatchObject({ start: '2026-10-12', end: '2026-10-18', count: 3 });
    expect(r.streak).toBe(1); // last complete week failed; current already successful
    expect(r.successRate).toBe(0.5);
  });

  it('week start Sunday and Saturday change the instances', () => {
    expect(computeGoal(goal({}), sport, '2026-10-16', 7).instances.map((i) => [i.start, i.count])).toEqual([
      ['2026-09-27', 3],
      ['2026-10-04', 2],
      ['2026-10-11', 3],
    ]);
    expect(computeGoal(goal({}), sport, '2026-10-16', 6).instances.map((i) => [i.start, i.count])).toEqual([
      ['2026-09-26', 3],
      ['2026-10-03', 2],
      ['2026-10-10', 3],
    ]);
  });

  it('day goals use target 1; streak counts back from yesterday plus today when done', () => {
    const r = computeGoal(goal({ period: 'day', target: 4, startDate: '2026-10-12' }), sport, '2026-10-16', 1);
    expect(r.target).toBe(1);
    expect(r.instances.map((i) => i.success)).toEqual([false, true, true, true, false]);
    expect(r.streak).toBe(3);
    expect(r.successRate).toBe(0.75);
    const done = computeGoal(goal({ period: 'day', startDate: '2026-10-12' }), [...sport, '2026-10-16'], '2026-10-16', 1);
    expect(done.streak).toBe(4);
  });

  it('month goals across a year end and in February of a leap year', () => {
    const r = computeGoal(goal({ period: 'month', target: 2, startDate: '2023-12-15' }), ['2023-12-01', '2023-12-31', '2024-01-05', '2024-02-29', '2024-02-01'], '2024-03-02', 1);
    expect(r.instances.map((i) => [i.start, i.end, i.count, i.success, i.complete])).toEqual([
      ['2023-12-01', '2023-12-31', 2, true, true],
      ['2024-01-01', '2024-01-31', 1, false, true],
      ['2024-02-01', '2024-02-29', 2, true, true],
      ['2024-03-01', '2024-03-31', 0, false, false],
    ]);
    expect(r.streak).toBe(1);
    expect(r.successRate).toBeCloseTo(2 / 3, 12);
  });

  it('archived activity pauses the goal; a goal starting after today has no instances', () => {
    expect(computeGoal(goal({ activityArchived: true }), sport, '2026-10-16', 1)).toMatchObject({ paused: true, instances: [], streak: 0, successRate: null, current: null });
    expect(computeGoal(goal({ startDate: '2026-10-20' }), sport, '2026-10-16', 1)).toMatchObject({ paused: false, instances: [], streak: 0, successRate: null });
  });
});

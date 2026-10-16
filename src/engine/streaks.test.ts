import { computeStreak } from './streaks';

describe('Formula 12 — streaks', () => {
  const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15'];
  it.each([
    ['today logged', [...days, '2026-10-16'], '2026-10-16', 3, 3],
    ['today not yet logged, yesterday logged', days, '2026-10-16', 2, 3],
    ['neither today nor yesterday', days, '2026-10-17', 0, 3],
    ['empty history', [], '2026-10-16', 0, 0],
    ['duplicates and order do not matter', ['2026-10-15', '2026-10-14', '2026-10-15'], '2026-10-15', 2, 2],
    ['across a leap day and year end', ['2024-02-28', '2024-02-29', '2024-03-01', '2025-12-31', '2026-01-01'], '2026-01-01', 2, 3],
    ['tomorrow logged (allowed date) does not extend today', ['2026-10-16', '2026-10-17'], '2026-10-16', 1, 2],
  ])('%s', (_name, logged, today, current, longest) => {
    expect(computeStreak(logged, today)).toEqual({ current, longest });
  });
});

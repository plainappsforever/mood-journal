import { addDays, type DateStr } from '@/engine/dates';
import type { Period } from '@/engine/stats';

export type PeriodChoice = '30d' | 'month' | 'year' | 'all' | 'custom';

/** Stats period for a chip; `today` = the journal day (D54); month/year run to date with `kind` for Formula 11 (D53). */
export function makePeriod(choice: PeriodChoice, today: DateStr, firstDate: DateStr | null, custom?: { start: DateStr; end: DateStr }): Period {
  switch (choice) {
    case '30d':
      return { start: addDays(today, -29), end: today };
    case 'month':
      return { start: `${today.slice(0, 7)}-01`, end: today, kind: 'month' };
    case 'year':
      return { start: `${today.slice(0, 4)}-01-01`, end: today, kind: 'year' };
    case 'all':
      return { start: firstDate && firstDate < today ? firstDate : today, end: today };
    case 'custom':
      return custom && custom.start <= custom.end ? { start: custom.start, end: custom.end } : { start: addDays(today, -29), end: today };
  }
}

/** Route params for detail screens. */
export function periodParams(p: Period): string {
  return `start=${p.start}&end=${p.end}${p.kind ? `&kind=${p.kind}` : ''}`;
}

export function periodFromParams(params: { start?: string; end?: string; kind?: string }, fallback: Period): Period {
  if (!params.start || !params.end) return fallback;
  const kind = params.kind === 'month' || params.kind === 'year' ? params.kind : undefined;
  return { start: params.start, end: params.end, ...(kind ? { kind } : {}) };
}

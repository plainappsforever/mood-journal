// Plain-word output of the statistics (SPEC "Honest promises": what happened together and how many days or entries
// it is based on — never why). Pure: the translator and the number locale are parameters.
import type { Language, Translator } from '@/lib/i18n';
import { translatePlural } from '@/lib/i18n';

import type { Comparison } from './compare';
import type { Average } from './summary';

export type Formatter = { t: Translator; language: Language; locale: string };

export function formatNumber(f: Formatter, value: number, decimals = 1): string {
  return new Intl.NumberFormat(f.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** "3.8 · from 28 days, 41 entries" pieces. */
export function formatAverage(f: Formatter, avg: Average): { value: string; basis: string } {
  if (avg.rounded === null) return { value: '–', basis: f.t('stats.average.none') };
  return {
    value: formatNumber(f, avg.rounded),
    basis: f.t('stats.average.basis', {
      days: translatePlural(f.language, 'count.days', avg.days),
      entries: translatePlural(f.language, 'count.entries', avg.entries),
    }),
  };
}

export function comparisonLabel(f: Formatter, c: Comparison): string {
  switch (c.label) {
    case 'notEnough':
      return f.t('stats.label.notEnough');
    case 'few':
      return f.t(c.mode === 'entries' ? 'stats.label.few.entries' : 'stats.label.few.days');
    case 'clear':
      return f.t('stats.label.clear');
    case 'small':
      return f.t('stats.label.small');
    default:
      return f.t('stats.label.none');
  }
}

/** "Entries with sport: 4.1 (23). Without: 3.4 (61)." — null while not enough data. */
export function comparisonSentence(f: Formatter, c: Comparison, activity: string): string | null {
  if (c.label === 'notEnough' || c.withMean === null || c.withoutMean === null) return null;
  const key = c.mode === 'entries' ? 'stats.cmp.entries' : c.mode === 'sameDay' ? 'stats.cmp.sameDay' : 'stats.cmp.nextDay';
  return f.t(key, {
    activity,
    with: formatNumber(f, Math.floor(c.withMean * 10 + 0.5 + 1e-9) / 10),
    nWith: c.withN,
    without: formatNumber(f, Math.floor(c.withoutMean * 10 + 0.5 + 1e-9) / 10),
    nWithout: c.withoutN,
  });
}

/** "12 days in a row (longest 40)". */
export function formatStreak(f: Formatter, current: number, longest: number): string {
  if (current === 0 && longest === 0) return f.t('streak.none');
  return f.t('streak.text', { days: translatePlural(f.language, 'count.days', current), longest });
}

export function formatFrequency(f: Formatter, difference: number): string {
  if (difference === 0) return f.t('stats.frequency.same');
  return f.t(difference > 0 ? 'stats.frequency.more' : 'stats.frequency.fewer', { n: Math.abs(difference) });
}

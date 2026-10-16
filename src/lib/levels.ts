import type { MoodBook } from '@/hooks/use-journal';

/** Colour of a level (its first active mood), for pixels, calendar cells and bars (Formula 7). */
export function levelColor(moods: MoodBook, level: number): string {
  const l = Math.min(5, Math.max(1, Math.floor(level + 0.5)));
  return moods.firstOfLevel.get(l)?.color ?? '#999999';
}

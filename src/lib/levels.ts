import type { MoodBook } from '@/hooks/use-journal';

/** Colour of a level (its first active mood), for pixels, calendar cells and bars (Formula 7). */
export function levelColor(moods: MoodBook, level: number): string {
  const l = Math.min(5, Math.max(1, Math.floor(level + 0.5)));
  return moods.firstOfLevel.get(l)?.color ?? '#999999';
}

/** Black or white, whichever reads better on a mood colour (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? '#1A1A1A' : '#FFFFFF';
}

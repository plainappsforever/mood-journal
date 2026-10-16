// Pure chart geometry (D27): one tested set of paths/rects for react-native-svg on screen and inline SVG in the PDF.
// Levels run 1 (bottom) … 5 (top). Gaps are gaps in daily mode (SPEC Formula 4): the line breaks on a day without a
// value; in week/month mode consecutive buckets are joined.

export type Box = { width: number; height: number; padLeft?: number; padRight?: number; padTop?: number; padBottom?: number };
export type LinePoint = { x: number; value: number };
export type LineChart = { segments: string[]; dots: { cx: number; cy: number }[]; levelLines: { level: number; y: number }[] };
export type Bar = { x: number; y: number; width: number; height: number; value: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

function frame(box: Box) {
  const left = box.padLeft ?? 8;
  const right = box.width - (box.padRight ?? 8);
  const top = box.padTop ?? 8;
  const bottom = box.height - (box.padBottom ?? 8);
  return { left, right, top, bottom };
}

/** y of a level value (1 … 5). */
export function levelY(box: Box, value: number): number {
  const f = frame(box);
  return r2(f.bottom - ((value - 1) / 4) * (f.bottom - f.top));
}

/**
 * Line chart over x positions 0 … xMax (e.g. day offsets from the period start, or bucket indexes).
 * `breakGaps`: start a new segment when two neighbouring points are more than one x step apart.
 */
export function lineChart(points: readonly LinePoint[], xMax: number, box: Box, breakGaps: boolean): LineChart {
  const f = frame(box);
  const span = Math.max(1, xMax);
  const px = (x: number) => r2(f.left + (x / span) * (f.right - f.left));
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const segments: string[] = [];
  let current: string[] = [];
  let prevX: number | null = null;
  for (const p of sorted) {
    const cmd = `${px(p.x)},${levelY(box, p.value)}`;
    if (prevX !== null && breakGaps && p.x - prevX > 1) {
      segments.push(current.join(' '));
      current = [];
    }
    current.push(current.length === 0 ? `M${cmd}` : `L${cmd}`);
    prevX = p.x;
  }
  if (current.length) segments.push(current.join(' '));
  return {
    segments,
    dots: sorted.map((p) => ({ cx: px(p.x), cy: levelY(box, p.value) })),
    levelLines: [1, 2, 3, 4, 5].map((level) => ({ level, y: levelY(box, level) })),
  };
}

/** Vertical bars for level means (e.g. by weekday); a null value is an empty slot. */
export function barChart(values: readonly (number | null)[], box: Box, gap = 0.25): Bar[] {
  const f = frame(box);
  const slot = (f.right - f.left) / Math.max(1, values.length);
  const width = r2(slot * (1 - gap));
  return values.map((value, i) => {
    const x = r2(f.left + i * slot + (slot - width) / 2);
    if (value === null) return { x, y: f.bottom, width, height: 0, value };
    // Bars start below level 1 so a mean of 1.0 is still visible: 0 … 5 scale.
    const y = r2(f.bottom - (value / 5) * (f.bottom - f.top));
    return { x, y, width, height: r2(f.bottom - y), value };
  });
}

/** The SVG document for the PDF (inline). Colours and stroke are parameters; text is escaped by the caller. */
export function lineChartSvg(chart: LineChart, box: Box, color: string): string {
  const grid = chart.levelLines.map((l) => `<line x1="0" x2="${box.width}" y1="${l.y}" y2="${l.y}" stroke="#ddd" stroke-width="0.5"/>`).join('');
  const paths = chart.segments.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>`).join('');
  const dots = chart.dots.map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="1.6" fill="${color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}">${grid}${paths}${dots}</svg>`;
}

export function barChartSvg(bars: readonly Bar[], box: Box, colorFor: (value: number) => string, labels: readonly string[]): string {
  const rects = bars
    .map((b) => (b.value === null ? '' : `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${colorFor(b.value)}"/>`))
    .join('');
  const text = bars.map((b, i) => `<text x="${r2(b.x + b.width / 2)}" y="${box.height - 1}" font-size="7" text-anchor="middle">${labels[i] ?? ''}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}">${rects}${text}</svg>`;
}

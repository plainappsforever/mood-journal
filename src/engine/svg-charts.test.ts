import { barChart, barChartSvg, levelY, lineChart, lineChartSvg } from './svg-charts';

const box = { width: 108, height: 48, padLeft: 4, padRight: 4, padTop: 4, padBottom: 4 };

describe('svg charts', () => {
  it('maps levels 1 … 5 to the bottom … top of the frame', () => {
    expect(levelY(box, 1)).toBe(44);
    expect(levelY(box, 5)).toBe(4);
    expect(levelY(box, 3)).toBe(24);
  });

  it('daily mode breaks the line at days without a value; week/month mode joins buckets', () => {
    const pts = [
      { x: 0, value: 5 },
      { x: 1, value: 3 },
      { x: 4, value: 1 },
    ];
    const daily = lineChart(pts, 10, box, true);
    expect(daily.segments).toEqual(['M4,4 L14,24', 'M44,44']);
    expect(daily.dots).toHaveLength(3);
    expect(lineChart(pts, 10, box, false).segments).toEqual(['M4,4 L14,24 L44,44']);
    expect(lineChart([], 10, box, true).segments).toEqual([]);
  });

  it('bars on a 0 … 5 scale with empty slots for missing values', () => {
    const bars = barChart([5, null, 2.5], { width: 64, height: 54, padLeft: 2, padRight: 2, padTop: 4, padBottom: 0 }, 0.5);
    expect(bars[0]).toEqual({ x: 7, y: 4, width: 10, height: 50, value: 5 });
    expect(bars[1]).toMatchObject({ height: 0, value: null });
    expect(bars[2]).toEqual({ x: 47, y: 29, width: 10, height: 25, value: 2.5 });
    expect(barChartSvg(bars, box, () => '#000', ['M', 'T', 'W'])).toContain('<rect x="47" y="29" width="10" height="25"');
    expect(lineChartSvg(lineChart([{ x: 0, value: 2 }], 1, box, true), box, '#123456')).toContain('<circle cx="4" cy="34" r="1.6" fill="#123456"/>');
  });
});

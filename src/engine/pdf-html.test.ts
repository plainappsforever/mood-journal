import { makeT } from '@/lib/i18n';

import { escapeHtml, formatDateRange, paperForRegion, renderPdfHtml, type PdfInput } from './pdf-html';
import { compareEntries, overview, type StatEntry } from './stats';

const entries: StatEntry[] = [
  { id: 1, moodId: 1, level: 5, date: '2026-09-01', activityIds: [10] },
  { id: 2, moodId: 2, level: 2, date: '2026-09-03', activityIds: [] },
  { id: 3, moodId: 1, level: 5, date: '2026-09-04', activityIds: [10] },
];

function input(over: Partial<PdfInput> = {}): PdfInput {
  const period = { start: '2026-09-01', end: '2026-09-30' };
  return {
    t: makeT('en'),
    language: 'en',
    locale: 'en-GB',
    paper: 'A4',
    weekStart: 1,
    overview: overview(entries, period, 1, [10]),
    streak: { current: 2, longest: 3 },
    moods: new Map([
      [1, { name: 'Great', emoji: '😄', color: '#2E9E5B', level: 5 }],
      [2, { name: 'Bad <b>', emoji: '🙁', color: '#F08A4B', level: 2 }],
    ]),
    levelColors: { 1: '#D64545', 2: '#F08A4B', 3: '#F2C14E', 4: '#8BC34A', 5: '#2E9E5B' },
    activities: new Map([[10, { name: 'sport', emoji: '🏃' }]]),
    comparisons: [{ activityId: 10, comparison: compareEntries(entries, 10) }],
    days: [
      { date: '2026-09-03', entries: [{ time: '21:00', moodId: 2, activityIds: [], noteTitle: '', note: '<script>alert(1)</script>\nline 2', photos: ['data:image/jpeg;base64,AAAA', 'javascript:alert(1)'] }] },
      { date: '2026-09-01', entries: [{ time: '08:00', moodId: 1, activityIds: [10], noteTitle: 'Run', note: '', photos: [] }] },
      { date: '2026-10-01', entries: [{ time: '08:00', moodId: 1, activityIds: [], noteTitle: 'outside the period', note: '', photos: [] }] },
    ],
    includePhotos: true,
    ...over,
  };
}

describe('PDF report HTML', () => {
  it('date ranges per locale', () => {
    expect(formatDateRange('2026-09-01', '2026-09-30', 'en-GB')).toMatch(/^1–30 Sept? 2026$/);
    expect(formatDateRange('2026-09-01', '2026-09-30', 'en-US')).toBe('Sep 1–30, 2026');
    expect(formatDateRange('2026-09-01', '2026-09-30', 'de-DE')).toBe('1.–30. Sept. 2026');
    expect(formatDateRange('2026-09-25', '2026-10-02', 'en-US')).toBe('Sep 25, 2026 – Oct 2, 2026');
    expect(formatDateRange('2026-09-25', '2026-09-25', 'en-US')).toBe('Sep 25, 2026');
  });

  it('paper by region', () => {
    expect(paperForRegion('US')).toBe('Letter');
    expect(paperForRegion('de')).toBe('A4');
    expect(paperForRegion(null)).toBe('A4');
  });

  it('title, summary, charts, comparisons, entries in date order inside the period, escaped text, safe photos only', () => {
    const html = renderPdfHtml(input());
    expect(html).toMatch(/<h1>Mood journal · 1–30 Sept? 2026<\/h1>/);
    expect(html).toContain('<b>4.0</b> · from 3 days, 3 entries');
    expect(html).toContain('2 days in a row (longest 3)');
    expect(html).toContain('@page { size: A4;');
    expect((html.match(/<svg /g) ?? []).length).toBe(2);
    expect(html).not.toContain('Entries with sport'); // n = 2 vs 1: no numbers, only the label
    expect(html).toContain('Not enough data yet');
    expect(html.indexOf('Tuesday, 1 September 2026')).toBeLessThan(html.indexOf('Thursday, 3 September 2026'));
    expect(html).not.toContain('outside the period');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>line 2');
    expect(html).toContain('Bad &lt;b&gt;');
    expect(html).toContain('<img class="photo" src="data:image/jpeg;base64,AAAA"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('A personal journal, not a medical record.');
  });

  it('without photos, in German, Letter paper, empty period', () => {
    const html = renderPdfHtml(input({ includePhotos: false, t: makeT('de'), language: 'de', locale: 'de-DE', paper: 'Letter' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('Stimmungstagebuch · 1.–30. Sept. 2026');
    expect(html).toContain('@page { size: letter;');
    const empty = renderPdfHtml(input({ overview: overview([], { start: '2026-01-01', end: '2026-01-31' }, 1, []), days: [], comparisons: [] }));
    expect(empty).toContain('No entries in this period.');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('a crafted mood colour never reaches the style attribute (review S7)', () => {
    const evil = '#000"><script>x()</script>';
    const html = renderPdfHtml(
      input({
        moods: new Map([
          [1, { name: 'Great', emoji: '😄', color: evil, level: 5 }],
          [2, { name: 'Bad', emoji: '🙁', color: 'red', level: 2 }],
        ]),
        levelColors: { 1: evil, 2: evil, 3: evil, 4: evil, 5: evil },
      })
    );
    expect(html).not.toContain('<script>x()');
    expect(html).toContain('style="background:#888888"');
  });
});

describe('PDF moods row labels (P8)', () => {
  it('each count carries its level label, escaped; without labels only dots and numbers', () => {
    const html = renderPdfHtml(input({ levelLabels: { 5: '😄 Great', 4: '🙂 Good', 3: '😐 Okay', 2: '🙁 Bad <i>', 1: '😞 Awful' } }));
    expect(html).toMatch(/😄 Great <b>\d+<\/b>/);
    expect(html).toContain('🙁 Bad &lt;i&gt; <b>');
    expect(renderPdfHtml(input())).not.toContain('Great <b>');
  });
});

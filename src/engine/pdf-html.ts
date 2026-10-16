// PDF period report as HTML (SPEC "PDF export", D27). PURE: the caller passes the statistics, names, colours,
// translator and (optionally) photos as data URIs; expo-print turns the HTML into a PDF in P8 (per-platform zoom,
// sibling pattern). Neutral wording, no scores (L26): average, counts, streak, charts, with/without, entries.
import type { Language, Translator } from '@/lib/i18n';

import { addDays, diffDays, isoWeekday, type DateStr, type WeekStart } from './dates';
import { barChart, barChartSvg, lineChart, lineChartSvg } from './svg-charts';
import { comparisonLabel, comparisonSentence, formatAverage, formatStreak, type Comparison, type Overview } from './stats';

export type Paper = 'A4' | 'Letter';
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR', 'CR', 'PA', 'DO', 'SV', 'NI', 'HN', 'BZ']);

export function paperForRegion(region: string | null | undefined): Paper {
  return region && LETTER_REGIONS.has(region.toUpperCase()) ? 'Letter' : 'A4';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const utcDate = (d: DateStr) => new Date(`${d}T12:00:00Z`);

/** "1–30 Sep 2026" / "1.–30. Sept. 2026" / "Sep 1–30, 2026"; across months both dates in full. */
export function formatDateRange(start: DateStr, end: DateStr, locale: string): string {
  const f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (start === end) return f.format(utcDate(start));
  if (start.slice(0, 7) !== end.slice(0, 7)) return `${f.format(utcDate(start))} – ${f.format(utcDate(end))}`;
  const startParts = f.formatToParts(utcDate(start));
  const startDay = startParts.find((p) => p.type === 'day')!.value;
  const afterDay = startParts[startParts.findIndex((p) => p.type === 'day') + 1];
  const dayMark = afterDay?.type === 'literal' && afterDay.value.trim() === '.' ? '.' : '';
  return f
    .formatToParts(utcDate(end))
    .map((p) => (p.type === 'day' ? `${startDay}${dayMark}–${p.value}` : p.value))
    .join('');
}

export type PdfEntry = { time: string; moodId: number; activityIds: readonly number[]; noteTitle: string; note: string; photos: readonly string[] };

export type PdfInput = {
  t: Translator;
  language: Language;
  locale: string;
  paper: Paper;
  weekStart: WeekStart;
  overview: Overview;
  streak: { current: number; longest: number };
  moods: ReadonlyMap<number, { name: string; emoji: string; color: string; level: number }>;
  levelColors: Readonly<Record<number, string>>;
  /** Label per level for the counts row ("🙂 Good": the level's first active mood); missing = colour dot only. */
  levelLabels?: Readonly<Record<number, string>>;
  activities: ReadonlyMap<number, { name: string; emoji: string }>;
  /** Activities with their entry-mode comparison, in display order (caller picks the top ones). */
  comparisons: readonly { activityId: number; comparison: Comparison }[];
  /** Days with entries, any order; entries inside a day in display order. */
  days: readonly { date: DateStr; entries: readonly PdfEntry[] }[];
  includePhotos: boolean;
};

const DATA_URI = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

/** Only #RRGGBB reaches the style attribute (review S7: a restored colour is file data). */
const safeColor = (c: string | undefined) => (c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#888888');

function text(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, '<br>');
}

export function renderPdfHtml(input: PdfInput): string {
  const { t, overview: o, locale } = input;
  const range = formatDateRange(o.period.start, o.period.end, locale);
  const fmt = { t, language: input.language, locale };
  const avg = formatAverage(fmt, o.average);
  const levelColor = (v: number) => safeColor(input.levelColors[Math.min(5, Math.max(1, Math.floor(v + 0.5 + 1e-9)))]);

  // Mood over time
  const box = { width: 480, height: 120, padLeft: 6, padRight: 6, padTop: 6, padBottom: 6 };
  const mode = o.series.mode;
  const xOf = (key: string) =>
    mode === 'day' ? diffDays(o.period.start, key) : mode === 'week' ? Math.round(diffDays(o.period.start, key) / 7) : monthIndex(key) - monthIndex(o.period.start.slice(0, 7));
  const xMax = mode === 'day' ? diffDays(o.period.start, o.period.end) : mode === 'week' ? Math.ceil(diffDays(o.period.start, o.period.end) / 7) : monthIndex(o.period.end.slice(0, 7)) - monthIndex(o.period.start.slice(0, 7));
  const line = lineChart(
    o.series.points.map((p) => ({ x: xOf(p.key), value: p.value })),
    xMax,
    box,
    mode === 'day'
  );
  const moodChart = lineChartSvg(line, box, '#4A6FA5');

  // By weekday, starting at the week start
  const order = Array.from({ length: 7 }, (_, i) => ((input.weekStart - 1 + i) % 7) + 1);
  const names = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const monday = '2024-01-01';
  const labels = order.map((w) => names.format(utcDate(addDays(monday, w - 1))));
  const wbox = { width: 240, height: 110, padLeft: 4, padRight: 4, padTop: 6, padBottom: 12 };
  const weekdayChart = barChartSvg(
    barChart(
      order.map((w) => o.weekday[w - 1].mean),
      wbox
    ),
    wbox,
    levelColor,
    labels.map(escapeHtml)
  );

  const counts = [5, 4, 3, 2, 1]
    .map((l) => {
      const label = input.levelLabels?.[l];
      return `<span class="count"><span class="dot" style="background:${safeColor(input.levelColors[l])}"></span>${label ? `${escapeHtml(label)} ` : ''}<b>${o.counts.byLevel[l as 1 | 2 | 3 | 4 | 5]}</b></span>`;
    })
    .join(' ');

  const cmpRows = input.comparisons
    .map(({ activityId, comparison }) => {
      const a = input.activities.get(activityId);
      if (!a) return '';
      const sentence = comparisonSentence(fmt, comparison, a.name) ?? '';
      return `<tr><td>${escapeHtml(a.emoji)} ${escapeHtml(a.name)}</td><td>${escapeHtml(sentence)}</td><td>${escapeHtml(comparisonLabel(fmt, comparison))}</td></tr>`;
    })
    .join('');

  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const days = [...input.days]
    .filter((d) => d.date >= o.period.start && d.date <= o.period.end)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => {
      const rows = d.entries
        .map((e) => {
          const m = input.moods.get(e.moodId);
          const acts = e.activityIds.map((id) => input.activities.get(id)).filter(Boolean).map((a) => `${escapeHtml(a!.emoji)} ${escapeHtml(a!.name)}`).join(' · ');
          const photos = input.includePhotos ? e.photos.filter((p) => DATA_URI.test(p)).map((p) => `<img class="photo" src="${p}" alt="${escapeHtml(t('pdf.photo'))}">`).join('') : '';
          return `<div class="entry"><div class="head"><span class="dot" style="background:${safeColor(m?.color)}"></span><b>${escapeHtml(m ? `${m.emoji} ${m.name}` : '?')}</b> <span class="time">${escapeHtml(e.time)}</span></div>${
            acts ? `<div class="acts">${acts}</div>` : ''
          }${e.noteTitle ? `<div class="title">${text(e.noteTitle)}</div>` : ''}${e.note ? `<div class="note">${text(e.note)}</div>` : ''}${photos ? `<div class="photos">${photos}</div>` : ''}</div>`;
        })
        .join('');
      return `<section class="day"><h3>${escapeHtml(dayFmt.format(utcDate(d.date)))}</h3>${rows}</section>`;
    })
    .join('');

  const pageSize = input.paper === 'Letter' ? 'letter' : 'A4';
  return `<!DOCTYPE html><html lang="${escapeHtml(input.language)}"><head><meta charset="utf-8"><title>${escapeHtml(t('pdf.title', { range }))}</title><style>
@page { size: ${pageSize}; margin: 16mm; }
body { font-family: -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; color: #222; }
h1 { font-size: 16pt; margin: 0 0 8px; } h2 { font-size: 12pt; margin: 18px 0 6px; } h3 { font-size: 10.5pt; margin: 12px 0 4px; }
.summary td { padding: 2px 12px 2px 0; } .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
.count { margin-right: 10px; } table.cmp { border-collapse: collapse; width: 100%; } table.cmp td { border-top: 1px solid #ddd; padding: 3px 6px 3px 0; vertical-align: top; }
.entry { margin: 0 0 8px; page-break-inside: avoid; } .time { color: #666; } .acts { color: #444; } .title { font-weight: 600; margin-top: 2px; }
.note { margin-top: 2px; } .photo { max-width: 160px; max-height: 160px; margin: 4px 6px 0 0; } .day { page-break-inside: auto; }
footer { margin-top: 24px; color: #777; font-size: 8.5pt; }
</style></head><body>
<h1>${escapeHtml(t('pdf.title', { range }))}</h1>
<h2>${escapeHtml(t('pdf.summary'))}</h2>
<table class="summary"><tr><td>${escapeHtml(t('pdf.average'))}</td><td><b>${escapeHtml(avg.value)}</b> · ${escapeHtml(avg.basis)}</td></tr>
<tr><td>${escapeHtml(t('pdf.counts'))}</td><td>${counts}</td></tr>
<tr><td>${escapeHtml(t('pdf.streak'))}</td><td>${escapeHtml(formatStreak(fmt, input.streak.current, input.streak.longest))}</td></tr></table>
<h2>${escapeHtml(t('pdf.moodChart'))}</h2>${moodChart}
<h2>${escapeHtml(t('pdf.weekdayChart'))}</h2>${weekdayChart}
${cmpRows ? `<h2>${escapeHtml(t('pdf.topActivities'))}</h2><table class="cmp">${cmpRows}</table>` : ''}
<h2>${escapeHtml(t('pdf.entries'))}</h2>${days || `<p>${escapeHtml(t('pdf.noEntries'))}</p>`}
<footer>${escapeHtml(t('pdf.footer'))}</footer>
</body></html>`;
}

function monthIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

/** Weekday helper for callers building `days` (ISO 1 = Monday). */
export { isoWeekday };

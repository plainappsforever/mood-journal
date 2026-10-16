// CSV and PDF exports through the share sheet (SPEC "Import, export, backup", A9, D46, D50).
import { getLocales } from 'expo-localization';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

import { listActivities } from '@/db/activities';
import { listEntries, loggedDates, type Entry } from '@/db/entries';
import { listMoods } from '@/db/moods';
import { retryRace } from '@/db/native-retry';
import { getJournalSettings } from '@/db/settings';
import type { Db } from '@/db/types';
import type { DateStr } from '@/engine/dates';
import { entriesToCsv, type CsvEntry } from '@/engine/csv-export';
import { paperForRegion, renderPdfHtml, type PdfEntry } from '@/engine/pdf-html';
import { compareEntries, overview, type Period } from '@/engine/stats';
import { computeStreak } from '@/engine/streaks';
import type { Language, Translator } from '@/lib/i18n';
import { calendarToday, today } from '@/lib/clock';
import { cacheFile, writeBytes } from '@/lib/files';
import { inspectPdf, type PdfInfo } from '@/lib/pdf-inspect';
import { engineOptions, PRINT_PROFILE, printHtml } from '@/lib/print-html';
import { photoExists, photoUri } from '@/lib/photos';
import { statEntries } from '@/lib/stat-cache';
import { withTimeout } from '@/lib/timeout';

const PAGE = 2000;

async function allEntries(db: Db, from?: DateStr, to?: DateStr): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await listEntries(db, { from, to, limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Whole journal as CSV (UTF-8 with BOM, newest first, injection-safe cells). */
export async function exportCsv(db: Db): Promise<{ file: File; rows: number }> {
  const [entries, moods, acts] = await Promise.all([allEntries(db), listMoods(db, { includeArchived: true }), listActivities(db, { includeArchived: true })]);
  const moodById = new Map(moods.map((m) => [m.id, m]));
  const actById = new Map(acts.map((a) => [a.id, a]));
  const rows: CsvEntry[] = entries.map((e) => ({
    date: e.localDate,
    time: e.localTime,
    utcMs: e.utcMs,
    moodName: moodById.get(e.moodId)?.name ?? '',
    level: e.level,
    activityNames: e.activityIds.map((id) => actById.get(id)?.name ?? ''),
    noteTitle: e.noteTitle,
    note: e.note,
    photos: e.photos.length,
  }));
  const file = cacheFile('export', `mood-${calendarToday()}.csv`);
  writeBytes(file, entriesToCsv(rows));
  return { file, rows: rows.length };
}

async function photoDataUri(name: string): Promise<string | null> {
  if (!photoExists(name)) return null;
  const context = ImageManipulator.manipulate(photoUri(name));
  try {
    context.resize({ width: 600 });
    const image = await retryRace(() => context.renderAsync());
    try {
      const saved = await retryRace(() => image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true }));
      return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

export type PdfResult = { file: File; info: PdfInfo; ms: number; entries: number };

/** Period report (title, summary, charts, with/without, entries by day; photos optional at 600 px). */
export async function exportPdf(db: Db, period: Period, opts: { t: Translator; language: Language; locale: string; includePhotos: boolean }): Promise<PdfResult> {
  const started = Date.now();
  const settings = await getJournalSettings(db);
  const [all, moods, acts, dates, entries] = await Promise.all([
    statEntries(db),
    listMoods(db, { includeArchived: true }),
    listActivities(db, { includeArchived: true }),
    loggedDates(db),
    allEntries(db, period.start, period.end),
  ]);
  const o = overview(all, period, settings.weekStart, acts.map((a) => a.id));
  const top = [...o.frequency.entries()].filter(([, f]) => f.current > 0).sort((a, b) => b[1].current - a[1].current).slice(0, 8);
  const levelColors: Record<number, string> = {};
  const levelLabels: Record<number, string> = {};
  for (const m of moods) if (!m.archived && !(m.level in levelColors)) {
    levelColors[m.level] = m.color;
    levelLabels[m.level] = `${m.emoji} ${m.name}`.trim();
  }
  const byDay = new Map<DateStr, PdfEntry[]>();
  for (const e of [...entries].reverse()) {
    const photos: string[] = [];
    if (opts.includePhotos) for (const p of e.photos) {
      const uri = await photoDataUri(p.file);
      if (uri) photos.push(uri);
    }
    const list = byDay.get(e.localDate) ?? [];
    list.push({ time: e.localTime, moodId: e.moodId, activityIds: e.activityIds, noteTitle: e.noteTitle, note: e.note, photos });
    byDay.set(e.localDate, list);
  }
  let region: string | null = null;
  try {
    region = getLocales()[0]?.regionCode ?? null;
  } catch {
    region = null;
  }
  const paper = paperForRegion(region);
  const html = renderPdfHtml({
    t: opts.t,
    language: opts.language,
    locale: opts.locale,
    paper,
    weekStart: settings.weekStart,
    overview: o,
    streak: computeStreak(dates, today(settings.dayEndHour)),
    moods: new Map(moods.map((m) => [m.id, { name: m.name, emoji: m.emoji, color: m.color, level: m.level }])),
    levelColors,
    levelLabels,
    activities: new Map(acts.map((a) => [a.id, { name: a.name, emoji: a.emoji }])),
    comparisons: top.map(([activityId]) => ({ activityId, comparison: compareEntries(o.data.entries, activityId) })),
    days: [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, list]) => ({ date, entries: list })),
    includePhotos: opts.includePhotos,
  });
  const size = paper === 'A4' ? { width: 595, height: 842 } : { width: 612, height: 792 };
  const profile = PRINT_PROFILE[Platform.OS === 'ios' ? 'ios' : 'android']; // per-engine calibration (D64)
  const out = await withTimeout(Print.printToFileAsync({ html: printHtml(html, profile), ...size, ...engineOptions(profile) }), 60_000, 'Creating the PDF');
  const file = cacheFile('export', `mood-${period.start}-${period.end}.pdf`);
  const bytes = await new File(out.uri).bytes();
  writeBytes(file, bytes);
  return { file, info: inspectPdf(bytes), ms: Date.now() - started, entries: entries.length };
}

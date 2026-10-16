// Daylio CSV import (SPEC "Daylio import", D22, RESEARCH §3.1).
//
// DOCUMENTED (sources in RESEARCH §3.1):
//   current header (8 columns) full_date,date,weekday,time,mood,activities,note_title,note
//   legacy header  (7 columns) year,date,weekday,time,mood,activities,note — date like "23-Jan" or "January 23"
//   activities joined with " | "; mood = the user's own name (may have trailing spaces); newest entry first;
//   quoted commas/newlines; time 12 h ("10:00 pm") or 24 h; no time zone, no mood level, no photos.
// UNCONFIRMED (marked where used): localized headers and weekday/month names in non-English installs (→ columns read
//   by position when the column count matches, with a warning); whether full_date is always ISO (→ fall back to
//   year + date); whether CSV notes ever carry HTML (→ converted only when they contain known tags).
// SPREADSHEET RE-SAVES (review S5; UNCONFIRMED path, never written by Daylio itself): `;` or TAB between columns
//   (German Excel) → detected from the header line; `full_date` rewritten as 16.10.2026 / 10/16/2026 / 2026/10/16 →
//   day/month order decided ONCE per file: a part > 12 proves it, and the weekday column must agree (each weekday
//   cell maps to one weekday); if both orders stay possible, rows whose two readings differ are skipped as
//   "ambiguous date". Two-digit years are never guessed.
// Rows with fewer OR more cells than the header are malformed: skipped and listed (SPEC; blind set 1).
import { isoWeekday, isValidDate } from './dates';
import { htmlToText, ImportError, looksLikeHtml, proposeLevel, type ImportSource, type ImportWarning } from './daylio-common';

/** RFC 4180 records (BOM stripped, CRLF / LF / CR, quoted fields with "" escapes and line breaks). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (quoted) throw new ImportError('damaged', 'unterminated quote');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const CURRENT = ['full_date', 'date', 'weekday', 'time', 'mood', 'activities', 'note_title', 'note'];
const LEGACY = ['year', 'date', 'weekday', 'time', 'mood', 'activities', 'note'];

type Layout = { kind: 'current' | 'legacy'; index: Record<string, number>; guessed: boolean };

export function detectLayout(header: readonly string[], allowGuess = true): Layout | null {
  const names = header.map((h) => h.trim().toLowerCase());
  for (const [kind, cols] of [
    ['current', CURRENT],
    ['legacy', LEGACY],
  ] as const) {
    if (cols.every((c) => names.includes(c))) return { kind, index: Object.fromEntries(cols.map((c) => [c, names.indexOf(c)])), guessed: false };
  }
  if (!allowGuess) return null;
  // UNCONFIRMED: a localized Daylio header — same column count, read by position.
  if (names.length === CURRENT.length) return { kind: 'current', index: Object.fromEntries(CURRENT.map((c, i) => [c, i])), guessed: true };
  if (names.length === LEGACY.length) return { kind: 'legacy', index: Object.fromEntries(LEGACY.map((c, i) => [c, i])), guessed: true };
  return null;
}

const DELIMITERS = [',', ';', '\t'] as const;

/** Column separator from the header line: Daylio's `,` first; `;` / TAB only when they give a Daylio header. */
export function detectDelimiter(text: string): (typeof DELIMITERS)[number] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const end = s.search(/[\r\n]/);
  const line = end < 0 ? s : s.slice(0, end);
  const header = (d: string) => {
    try {
      return parseCsv(line, d)[0] ?? [];
    } catch {
      return [];
    }
  };
  for (const allowGuess of [false, true]) for (const d of DELIMITERS) if (detectLayout(header(d), allowGuess)) return d;
  return ',';
}

const WEEKDAYS_EN = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
type NumericDate = { a: number; b: number; y: number; sep: string };

/** "16.10.2026", "10/16/2026", "16-10-2026" (4-digit year last) → parts; null otherwise. */
function numericDate(raw: string): NumericDate | null {
  const m = /^\s*(\d{1,2})([./-])(\d{1,2})\2(\d{4})\s*$/.exec(raw);
  return m ? { a: Number(m[1]), b: Number(m[3]), y: Number(m[4]), sep: m[2] } : null;
}

const ymd = (y: number, month: number, day: number) => {
  const iso = `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
};

/**
 * Day/month order of a spreadsheet-rewritten `full_date` column, decided once per file. Returns the readings the file
 * allows: 'dmy', 'mdy', both (still ambiguous) or none (the weekday column contradicts both).
 */
export function numericDateOrders(rows: readonly { date: NumericDate; weekday: string }[]): ('dmy' | 'mdy')[] {
  const orders: ('dmy' | 'mdy')[] = [];
  for (const order of ['dmy', 'mdy'] as const) {
    const cellToDay = new Map<string, number>();
    const dayToCell = new Map<number, string>();
    let ok = true;
    for (const r of rows) {
      const dmy = ymd(r.date.y, r.date.b, r.date.a);
      const mdy = ymd(r.date.y, r.date.a, r.date.b);
      if (!dmy && !mdy) continue; // impossible either way: that row is skipped on its own
      const iso = order === 'dmy' ? dmy : mdy;
      if (!iso) {
        ok = false;
        break;
      }
      const cell = r.weekday.trim().toLowerCase();
      if (!cell) continue;
      const wd = isoWeekday(iso);
      const english = WEEKDAYS_EN.findIndex((w) => w === cell || (cell.length >= 3 && w.startsWith(cell.replace(/\.$/, ''))));
      if ((english >= 0 && english + 1 !== wd) || (cellToDay.get(cell) ?? wd) !== wd || (dayToCell.get(wd) ?? cell) !== cell) {
        ok = false;
        break;
      }
      cellToDay.set(cell, wd);
      dayToCell.set(wd, cell);
    }
    if (ok) orders.push(order);
  }
  return orders;
}

/** "10:00 pm", "10:00 PM", "10:00 p.m.", "9:05am", "22:00", "22:00:00" → 'HH:MM'; null when unreadable. */
export function parseDaylioTime(raw: string): string | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap])?\.?\s*(m\.?)?\s*$/i.exec(raw);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (minute > 59) return null;
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ap === 'p' ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '');
  const i = MONTHS.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w)));
  return i + 1;
}

/** Day and month from "23-Jan", "January 23", "23 January", "Jan 23" (English month names; others UNCONFIRMED). */
export function parseDayMonth(raw: string): { month: number; day: number } | null {
  const s = raw.trim();
  let m = /^(\d{1,2})[\s\-./]+([A-Za-z]+\.?)$/.exec(s);
  if (m) {
    const month = monthIndex(m[2]);
    return month ? { month, day: Number(m[1]) } : null;
  }
  m = /^([A-Za-z]+\.?)[\s\-./]+(\d{1,2})$/.exec(s);
  if (m) {
    const month = monthIndex(m[1]);
    return month ? { month, day: Number(m[2]) } : null;
  }
  return null;
}

function isoFrom(year: number, dm: { month: number; day: number } | null): string | null {
  if (!dm || !Number.isInteger(year)) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(dm.month).padStart(2, '0')}-${String(dm.day).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

/**
 * Parses a Daylio CSV export into an ImportSource. `knownNames` (lower-case mood name → level) pre-fills levels from
 * the user's own moods; Daylio's default names are always known. Throws ImportError for a file it cannot read at all.
 */
export function readDaylioCsv(text: string, knownNames: ReadonlyMap<string, number> = new Map()): ImportSource {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) throw new ImportError('noEntries');
  const layout = detectLayout(rows[0]);
  if (!layout) throw new ImportError('unknownHeader', rows[0].join(','));
  const warnings: ImportWarning[] = [];
  if (delimiter !== ',') warnings.push({ code: 'separator', params: { sep: delimiter === '\t' ? 'TAB' : delimiter } });
  if (layout.guessed) warnings.push({ code: 'headerGuessed' });
  const skipped: ImportSource['skipped'] = [];
  const moods = new Map<string, { ref: string; name: string; proposedLevel: number | null; archived: boolean }>();
  const activities = new Map<string, { ref: string; name: string; groupRef: null; archived: boolean }>();
  const entries: ImportSource['entries'] = [];
  const col = (r: string[], name: string) => (r[layout.index[name]] ?? '').toString();
  const width = rows[0].length;
  // Spreadsheet-rewritten full_date (numeric, year last): one day/month order for the whole file.
  let orders: ('dmy' | 'mdy')[] = [];
  let sep = '.';
  if (layout.kind === 'current') {
    const numeric = rows
      .slice(1)
      .filter((r) => r.length === width)
      .map((r) => ({ date: numericDate(col(r, 'full_date')), weekday: col(r, 'weekday') }))
      .filter((r): r is { date: NumericDate; weekday: string } => r.date !== null);
    if (numeric.length) {
      orders = numericDateOrders(numeric);
      sep = numeric[0].date.sep;
      if (orders.length === 1) {
        const order = orders[0] === 'dmy' ? ['DD', 'MM', 'YYYY'] : ['MM', 'DD', 'YYYY'];
        warnings.push({ code: 'dateOrder', params: { order: order.join(sep) } });
      }
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const where = String(i + 1);
    const skip = (reason: string) => {
      skipped.push({ where, reason });
      warnings.push({ code: 'badRow', params: { row: where, reason } });
    };
    if (r.length !== width) {
      skip(r.length < width ? 'missing columns' : 'extra columns');
      continue;
    }
    let date: string | null = null;
    if (layout.kind === 'current') {
      const full = col(r, 'full_date').trim();
      const n = numericDate(full);
      const ymdParts = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(full);
      if (isValidDate(full)) date = full;
      else if (ymdParts) date = ymd(Number(ymdParts[1]), Number(ymdParts[2]), Number(ymdParts[3]));
      else if (n) {
        const dmy = ymd(n.y, n.b, n.a);
        const mdy = ymd(n.y, n.a, n.b);
        if (orders.length === 0) {
          skip('date and weekday disagree');
          continue;
        }
        if (orders.length === 2 && dmy !== mdy) {
          skip('ambiguous date');
          continue;
        }
        date = orders[0] === 'dmy' ? dmy : mdy;
      } else {
        // UNCONFIRMED fallback: a 4-digit year anywhere in full_date + the English day-month of the date cell.
        const year = /(?:^|\D)(\d{4})(?:\D|$)/.exec(full);
        date = year ? isoFrom(Number(year[1]), parseDayMonth(col(r, 'date'))) : null;
      }
    } else {
      date = isoFrom(Number(col(r, 'year').trim()), parseDayMonth(col(r, 'date')));
    }
    if (!date) {
      skip('unreadable date');
      continue;
    }
    const time = parseDaylioTime(col(r, 'time'));
    if (!time) {
      skip('unreadable time');
      continue;
    }
    const moodName = col(r, 'mood').trim();
    if (!moodName) {
      skip('no mood');
      continue;
    }
    const moodRef = moodName.toLowerCase();
    if (!moods.has(moodRef)) moods.set(moodRef, { ref: moodRef, name: moodName, proposedLevel: proposeLevel(moodName, knownNames), archived: false });
    const activityRefs: string[] = [];
    for (const raw of col(r, 'activities').split('|')) {
      const name = raw.trim();
      if (!name) continue;
      const ref = name.toLowerCase();
      if (!activities.has(ref)) activities.set(ref, { ref, name, groupRef: null, archived: false });
      if (!activityRefs.includes(ref)) activityRefs.push(ref);
    }
    const rawNote = col(r, 'note');
    const note = looksLikeHtml(rawNote) ? htmlToText(rawNote) : rawNote.replace(/\r\n?/g, '\n').trim();
    const noteTitle = layout.kind === 'current' ? col(r, 'note_title').trim() : '';
    entries.push({ ref: null, where, date, time, utcMs: null, tzOffsetMin: null, moodRef, activityRefs, noteTitle, note, photos: [] });
  }
  if (entries.length === 0 && skipped.length === 0) throw new ImportError('noEntries');
  return { kind: 'daylio_csv', moods: [...moods.values()], groups: [], activities: [...activities.values()], entries, warnings, skipped, goals: 0 };
}

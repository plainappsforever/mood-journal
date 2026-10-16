// Shared pieces of the Daylio importers (SPEC "Daylio import", D22, RESEARCH §3).

/** Daylio's predefined mood names (documented: predefined_name_id 1 = rad … 5 = awful) → our level (5 = best). */
export const DAYLIO_DEFAULT_LEVELS: Record<string, number> = { rad: 5, good: 4, meh: 3, bad: 2, awful: 1 };
export const DAYLIO_PREDEFINED_NAMES = ['rad', 'good', 'meh', 'bad', 'awful'] as const;

export type ImportWarning = { code: ImportWarningCode; params?: Record<string, string | number> };
export type ImportWarningCode =
  | 'version'
  | 'badRow'
  | 'dateMismatch'
  | 'missingPhoto'
  | 'unknownMood'
  | 'unknownTag'
  | 'goalsNotImported'
  | 'rawJson'
  | 'headerGuessed'
  | 'photosLimited'
  | 'noOffset'
  | 'splitFieldsUsed'
  | 'separator'
  | 'dateOrder';
export type ImportErrorCode = 'notZip' | 'notDaylio' | 'encrypted' | 'zip64' | 'tooLarge' | 'damaged' | 'noEntries' | 'unknownHeader';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ImportError';
  }
}

export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

/** The normalized result of either importer; `import-plan.ts` maps it onto the user's journal. */
export type ImportSource = {
  kind: 'daylio_backup' | 'daylio_csv';
  /** Backup schema version (backup only). */
  version?: number;
  moods: { ref: string; name: string; proposedLevel: number | null; archived: boolean }[];
  groups: { ref: string; name: string }[];
  activities: { ref: string; name: string; groupRef: string | null; archived: boolean }[];
  entries: SourceEntry[];
  warnings: ImportWarning[];
  /** Rows / entries that could not be read (with their row number or Daylio id). */
  skipped: { where: string; reason: string }[];
  /** Goals present in the file (not imported, said in the result). */
  goals: number;
};

export type SourceEntry = {
  /** Daylio entry id (backup) or null (CSV). */
  ref: string | null;
  /** CSV row number (header = 1) or the backup's entry id, for messages. */
  where: string;
  date: string;
  time: string;
  /** Real moment when the file has it (backup); CSV entries get it from the device zone in the plan. */
  utcMs: number | null;
  tzOffsetMin: number | null;
  moodRef: string;
  activityRefs: string[];
  noteTitle: string;
  note: string;
  photos: { member: string; bytes: Uint8Array }[];
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Tags Daylio's rich-text notes are known or expected to use. Only these are removed; any other `<` stays (M1). */
const KNOWN_TAG = /<\/?(?:p|div|span|b|i|u|s|strike|strong|em|ul|ol|li|h[1-6]|br|font|a|blockquote|sup|sub)(?:\s[^<>]*)?\/?>/gi;

/**
 * Daylio notes may carry HTML (review M1: plain text must survive). `<br>` and `</p>` (and `</div>`, `</li>`,
 * `</h1-6>`) → newline, other KNOWN tags removed, entities decoded. Everything else — a lone `<` or `>`, `<3`,
 * `x<y>z`, spaces and blank lines — stays exactly as written; only the trailing whitespace (e.g. the newline a final
 * `</p>` leaves) and leading newlines are dropped.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(KNOWN_TAG, '');
  return decodeEntities(text).replace(/\u00a0/g, ' ').trimEnd().replace(/^\n+/, '');
}

/** True when a note contains HTML tags Daylio is known to write (CSV notes: UNCONFIRMED whether they ever do). */
export function looksLikeHtml(s: string): boolean {
  return /<(br|p|\/p|div|\/div|b|\/b|i|\/i|strong|em|span|ul|ol|li)\b[^>]*>/i.test(s);
}

/**
 * Level proposal for a mood name: Daylio's defaults (rad … awful), then the names the user's journal already has
 * (our localized defaults and own moods). Everything else is null and must be chosen on the mapping screen.
 */
export function proposeLevel(name: string, knownNames: ReadonlyMap<string, number>): number | null {
  const key = name.trim().toLowerCase();
  return DAYLIO_DEFAULT_LEVELS[key] ?? knownNames.get(key) ?? null;
}

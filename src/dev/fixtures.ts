// Dev-build fixtures for the import and S9 flows (never imported by release code paths except behind __DEV__ links).
// The backup is the engine's TUNING fixture (src/engine/__fixtures__/daylio, D24), built in memory like the Jest tests.
import { strToU8, zipSync } from 'fflate';

import { BACKUP_V15, PHOTO_BYTES } from '@/engine/__fixtures__/daylio/build-backup';
import { addDays, isoWeekday, type DateStr } from '@/engine/dates';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without Node's Buffer (Hermes has none). */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

/** The same ZIP as the Jest builder (build-backup.ts), without Buffer. */
export function daylioBackupFixture(): Uint8Array {
  return zipSync({ 'backup.daylio': strToU8(base64(strToU8(JSON.stringify(BACKUP_V15)))), 'assets/abc123.jpg': PHOTO_BYTES });
}

/** A small Daylio CSV in the current 8-column layout (12 h times, a custom mood, a quoted note with a comma). */
export function daylioCsvFixture(): Uint8Array {
  const rows = [
    'full_date,date,weekday,time,mood,activities,note_title,note',
    '2026-10-10,October 10,Saturday,8:15 PM,rad,friends | sport,Good day,"Long walk, then dinner"',
    '2026-10-09,October 9,Friday,9:00 PM,meh,work,,',
    '2026-10-08,October 8,Thursday,7:30 AM,sleepy,bad sleep,,Too little sleep',
    '2026-10-07,October 7,Wednesday,10:05 PM,good,reading | walk,,',
  ];
  return strToU8(`${rows.join('\n')}\n`);
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MOODS = ['rad', 'good', 'meh', 'bad', 'awful'];
const ACTS = ['work', 'sport', 'walk', 'friends', 'family', 'reading', 'good sleep', 'cooking'];

/** S9: a Daylio CSV with `days × perDay` rows ending at `end` (deterministic). */
export function daylioCsvLarge(days: number, perDay: number, end: DateStr): Uint8Array {
  const lines = ['full_date,date,weekday,time,mood,activities,note_title,note'];
  let n = 0;
  for (let d = 0; d < days; d++) {
    const date = addDays(end, -d);
    const month = Number(date.slice(5, 7));
    for (let k = perDay - 1; k >= 0; k--) {
      n++;
      const hour = 8 + k * 3;
      const acts = ACTS.filter((_, i) => (n + i) % 4 === 0).join(' | ');
      const note = n % 5 === 0 ? `"Note ${n}, with a comma"` : '';
      lines.push(`${date},${MONTHS[month - 1]} ${Number(date.slice(8))},${WEEKDAYS[isoWeekday(date) - 1]},${String(hour).padStart(2, '0')}:${String(n % 60).padStart(2, '0')},${MOODS[n % 5]},${acts},,${note}`);
    }
  }
  return strToU8(`${lines.join('\n')}\n`);
}

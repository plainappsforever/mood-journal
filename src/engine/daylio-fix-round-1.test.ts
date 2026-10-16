/**
 * @jest-environment node
 */
// Regression tests for fix round 1 (docs/REVIEW_ENGINE.md M1, S3–S6, N3 and the parser bugs found by blind set 1,
// test/blind/daylio-1). Each test names the finding it protects.
import { strToU8, zipSync } from 'fflate';

import { BACKUP_V15 } from './__fixtures__/daylio/build-backup';
import { zoneOffsetFn } from './dates';
import { crc32, readDaylioBackup } from './daylio-backup';
import { htmlToText, ImportError, type ImportSource } from './daylio-common';
import { detectDelimiter, readDaylioCsv } from './daylio-csv';
import { importReport } from './import-report';
import { planImport } from './import-plan';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
  return 'no error';
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Entry = Record<string, unknown>;
const zipOf = (payload: Uint8Array, level: 0 | 6 = 6) => zipSync({ 'backup.daylio': [payload, { level }] });
const backupOf = (json: unknown) => zipOf(strToU8(Buffer.from(JSON.stringify(json), 'utf8').toString('base64')));
const HEADER = 'full_date,date,weekday,time,mood,activities,note_title,note';
const plan = (source: ImportSource, existing: Partial<Parameters<typeof planImport>[1]> = {}) =>
  planImport(
    source,
    { moods: [], groups: [], activities: [], importRefs: new Set(), ...existing },
    { levels: new Map(source.moods.map((m) => [m.ref, m.proposedLevel ?? 3])), today: '2026-10-16', offsetAt: zoneOffsetFn('UTC'), importGroupName: 'Imported from Daylio' }
  );

/** One backup entry at a local wall time with a given offset (minutes) and 0-based split fields. */
function entryAt(id: number | null, local: string, offsetMin: number | null, extra: Entry = {}): Entry {
  const [d, t] = local.split(' ');
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const wallMs = Date.UTC(y, mo - 1, day, h, mi, 17);
  const e: Entry = { datetime: wallMs - (offsetMin ?? 0) * 60_000, year: y, month: mo - 1, day, hour: h, minute: mi, mood: 1, note: '', note_title: '', tags: [], assets: [], ...extra };
  if (id !== null) e.id = id;
  if (offsetMin !== null) e.timeZoneOffset = offsetMin * 60_000;
  return e;
}
const journal = (entries: Entry[]) => ({ ...clone(BACKUP_V15), dayEntries: entries, assets: [], goals: [] });

describe('M1 — backup notes keep plain text (no blind stripping of every <…>)', () => {
  it('keeps lone angle brackets, emoticons and unknown tags; converts only known tags', () => {
    expect(htmlToText('a < b and c > d')).toBe('a < b and c > d');
    expect(htmlToText('price 5<10 but >3')).toBe('price 5<10 but >3');
    expect(htmlToText('I <3 you >_<')).toBe('I <3 you >_<');
    expect(htmlToText('x<y>z')).toBe('x<y>z');
    expect(htmlToText('line1\n\n\n\nline2')).toBe('line1\n\n\n\nline2');
    expect(htmlToText('<p>First paragraph</p><p>Second paragraph</p>')).toBe('First paragraph\nSecond paragraph');
    expect(htmlToText('<b>Bold</b> and <i>italic</i> &amp; more <span style="x">s</span>')).toBe('Bold and italic & more s');
    expect(htmlToText('1 &lt; 2 &gt; 0, &quot;quoted&quot; and it&#39;s')).toBe('1 < 2 > 0, "quoted" and it\'s');
    // blind set 1, backup-html-notes: the space before a break and repeated breaks are kept
    expect(htmlToText('Emoji 🎉 and <br/>self-closing<br />tags')).toBe('Emoji 🎉 and \nself-closing\ntags');
    expect(htmlToText('a<br><br><br>b')).toBe('a\n\n\nb');
  });

  it('backup titles are only entity-decoded; notes go through the tag-aware converter', () => {
    const s = readDaylioBackup(backupOf(journal([entryAt(1, '2026-05-01 10:00', 120, { note_title: 'x<y>z &amp; co', note: 'a < b and c > d<br>ok' })])));
    expect(s.entries[0]).toMatchObject({ noteTitle: 'x<y>z & co', note: 'a < b and c > d\nok' });
  });
});

describe('blind set 1 — damaged backups are refused, never half-imported', () => {
  it('CRC-32 mismatch in a stored member → damaged (JSON still valid)', () => {
    const json = strToU8(JSON.stringify(journal([entryAt(1, '2026-05-01 10:00', 120, { note: 'Hello' })])));
    const zip = zipOf(json, 0);
    expect(code(() => readDaylioBackup(zip))).toBe('no error');
    const i = Buffer.from(zip).indexOf('Hello');
    const changed = zip.slice();
    changed[i] = 'J'.charCodeAt(0); // "Jello": valid JSON, wrong CRC
    expect(code(() => readDaylioBackup(changed))).toBe('damaged');
    expect(importReport('x.daylio', changed, { today: '2026-10-16' })).toMatchObject({ status: 'error', error: 'damaged', entries: [] });
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926); // the standard check value
  });

  it('Latin-1 payload (ü = 0xFC) → damaged, not mojibake', () => {
    const text = JSON.stringify(journal([entryAt(1, '2026-05-01 10:00', 120, { note: 'Grüße' })]));
    const latin1 = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    expect(code(() => readDaylioBackup(zipOf(strToU8(Buffer.from(latin1).toString('base64')))))).toBe('damaged');
    expect(code(() => readDaylioBackup(zipOf(latin1)))).toBe('damaged'); // raw-JSON member, same rule
  });
});

describe('S6 — backup local time when datetime/offset and the split fields disagree', () => {
  it('missing timeZoneOffset: the split fields (what Daylio showed) win, with a warning — never silent UTC', () => {
    const s = readDaylioBackup(backupOf(journal([entryAt(1, '2026-01-01 00:30', null), { ...entryAt(2, '2026-07-14 21:30', 120), timeZoneOffset: undefined }])));
    // entry 1: no offset, datetime = wall (offset 0) → UTC equals wall; entry 2: datetime is 19:30Z, split says 21:30
    expect(s.entries.map((e) => [e.date, e.time, e.tzOffsetMin])).toEqual([
      ['2026-01-01', '00:30', 0],
      ['2026-07-14', '21:30', 120],
    ]);
    expect(s.warnings.filter((w) => w.code === 'noOffset')).toEqual([{ code: 'noOffset', params: { n: 2 } }]);
  });

  it('missing offset AND missing split fields: UTC with the warning', () => {
    const e = entryAt(1, '2026-03-01 23:30', null);
    for (const k of ['year', 'month', 'day', 'hour', 'minute']) delete e[k];
    const s = readDaylioBackup(backupOf(journal([e])));
    expect(s.entries[0]).toMatchObject({ date: '2026-03-01', time: '23:30', tzOffsetMin: 0 });
    expect(s.warnings.map((w) => w.code)).toContain('noOffset');
  });

  it('sign-flipped offsets across the file: the split fields win for every entry, real moment kept', () => {
    const shown = ['2026-01-05 21:30', '2026-02-10 08:00', '2026-03-15 23:45', '2026-04-20 00:15', '2026-05-25 12:00', '2026-06-30 18:20'];
    const entries = shown.map((w, i) => {
      const e = entryAt(i + 1, w, 120);
      e.timeZoneOffset = -120 * 60_000; // wrong sign in the file
      return e;
    });
    const s = readDaylioBackup(backupOf(journal(entries)));
    expect(s.entries.map((e) => `${e.date} ${e.time}`)).toEqual(shown);
    expect(s.entries.every((e) => e.tzOffsetMin === 120)).toBe(true);
    expect(s.entries[0].utcMs).toBe(entries[0].datetime);
    expect(s.warnings).toContainEqual({ code: 'splitFieldsUsed', params: { n: 6, of: 6 } });
    expect(s.warnings.map((w) => w.code)).not.toContain('dateMismatch');
  });

  it('a few disagreeing entries (or a tiny file): datetime + offset win, one dateMismatch per entry (SPEC)', () => {
    const ok = ['2026-01-05 21:30', '2026-02-10 08:00', '2026-03-15 23:45', '2026-04-20 00:15'].map((w, i) => entryAt(i + 1, w, 60));
    const off = { ...entryAt(9, '2026-05-25 12:00', 60), hour: 11 };
    const s = readDaylioBackup(backupOf(journal([...ok, off])));
    expect(s.entries.at(-1)).toMatchObject({ date: '2026-05-25', time: '12:00' });
    expect(s.warnings.filter((w) => w.code === 'dateMismatch')).toEqual([{ code: 'dateMismatch', params: { ref: '9' } }]);
    // 3 of 4 disagree, but 4 entries are no evidence of a systematic error → still datetime (blind set 1 split-mismatch)
    const tiny = readDaylioBackup(backupOf(journal([ok[0], { ...ok[1], hour: 3 }, { ...ok[2], day: 16 }, { ...ok[3], minute: 1 }])));
    expect(tiny.entries.map((e) => e.time)).toEqual(['21:30', '08:00', '23:45', '00:15']);
    expect(tiny.warnings.map((w) => w.code)).not.toContain('splitFieldsUsed');
  });

  it('month base decided once per file: a 1-based file reads correctly', () => {
    const entries = ['2026-01-05 21:30', '2026-02-10 08:00', '2026-12-15 23:45'].map((w, i) => {
      const e = entryAt(i + 1, w, 60);
      e.month = (e.month as number) + 1;
      return e;
    });
    const s = readDaylioBackup(backupOf(journal(entries)));
    expect(s.entries.map((e) => e.date)).toEqual(['2026-01-05', '2026-02-10', '2026-12-15']);
    expect(s.warnings.map((w) => w.code)).not.toContain('dateMismatch');
  });
});

describe('S3 — backup dedupe keys', () => {
  it('entries without an id are all planned (no collision on "daylio:")', () => {
    const entries = ['2026-01-05 21:30', '2026-02-10 08:00', '2026-03-15 23:45', '2026-04-20 00:15', '2026-05-25 12:00'].map((w) => entryAt(null, w, 60));
    const s = readDaylioBackup(backupOf(journal(entries)));
    const p = plan(s);
    expect(p.counts).toMatchObject({ entries: 5, duplicates: 0 });
    expect(new Set(p.entries.map((e) => e.importRef)).size).toBe(5);
    expect(s.entries.map((e) => e.where)).toEqual(['#1', '#2', '#3', '#4', '#5']);
    // re-import of the same file adds nothing
    expect(plan(s, { importRefs: new Set(p.entries.map((e) => e.importRef)) }).counts).toMatchObject({ entries: 0, duplicates: 5 });
  });

  it('a second Daylio journal whose ids restart at 1 is not swallowed as duplicates', () => {
    const a = readDaylioBackup(backupOf(journal([entryAt(1, '2024-01-05 21:30', 60), entryAt(2, '2024-01-06 21:30', 60)])));
    const b = readDaylioBackup(backupOf(journal([entryAt(1, '2026-03-01 09:00', 60), entryAt(2, '2026-03-02 09:00', 60)])));
    const first = plan(a);
    expect(plan(b, { importRefs: new Set(first.entries.map((e) => e.importRef)) }).counts).toMatchObject({ entries: 2, duplicates: 0 });
    expect(plan(a, { importRefs: new Set(first.entries.map((e) => e.importRef)) }).counts).toMatchObject({ entries: 0, duplicates: 2 });
  });
});

describe('S4 — name matching does not depend on the device locale', () => {
  it('Turkish lower-casing (I → ı) cannot split "WIFI" and "wifi" into two activities', () => {
    const original = String.prototype.toLocaleLowerCase;
    // Simulates a tr-TR device; the plan must not call toLocaleLowerCase at all.
    // eslint-disable-next-line no-extend-native -- the point of the test: a tr-TR String.prototype
    String.prototype.toLocaleLowerCase = function (this: string) {
      return original.call(this.replace(/I/g, 'ı'), 'en');
    };
    try {
      const source = readDaylioCsv(`${HEADER}\n2026-01-01,1 January,Thursday,10:00,rad,"wifi","",""\n`);
      const p = plan(source, { groups: [{ id: 7, name: 'Imported from Daylio' }], activities: [{ id: 70, groupId: 7, name: 'WIFI' }] });
      expect(p.newActivities).toEqual([]);
      expect(p.entries[0].activities).toEqual([{ existing: 70 }]);
    } finally {
      // eslint-disable-next-line no-extend-native -- restore
      String.prototype.toLocaleLowerCase = original;
    }
  });
});

describe('S5 — CSV re-saved by a spreadsheet app', () => {
  it('semicolon separator (German Excel) and DD.MM.YYYY dates, checked against the weekday column', () => {
    const text = '﻿full_date;date;weekday;time;mood;activities;note_title;note\r\n15.09.2021;15. September;Mittwoch;20:47;gut;Familie | Arbeit;;\r\n03.09.2021;3. September;Freitag;08:00;super;;;Notiz; mit Semikolon\r\n';
    expect(detectDelimiter(text)).toBe(';');
    const s = readDaylioCsv(text);
    expect(s.entries.map((e) => [e.date, e.time])).toEqual([['2021-09-15', '20:47']]);
    expect(s.skipped).toEqual([{ where: '3', reason: 'extra columns' }]); // an unquoted ";" in a note is malformed, listed
    expect(s.warnings.map((w) => [w.code, w.params?.sep ?? w.params?.order ?? w.params?.row])).toEqual([
      ['separator', ';'],
      ['dateOrder', 'DD.MM.YYYY'],
      ['badRow', '3'],
    ]);
  });

  it('US Excel M/D/YYYY and "10:00:00 PM"; numeric order proven by a part > 12', () => {
    const s = readDaylioCsv(`${HEADER}\n9/15/2021,15 September,Wednesday,10:52:00 AM,rad,gaming,,\n9/3/2021,3 September,Friday,2:13:00 PM,meh,,,\n`);
    expect(s.entries.map((e) => [e.date, e.time])).toEqual([
      ['2021-09-15', '10:52'],
      ['2021-09-03', '14:13'],
    ]);
  });

  it('all parts ≤ 12: the weekday column decides; without it the differing rows are skipped as ambiguous', () => {
    // 03/09/2021 is Friday 3 Sept (D.M) or Tuesday 9 March (M.D); 04/09 Saturday 4 Sept or Friday 9 April
    const withWeekday = readDaylioCsv(`${HEADER}\n03/09/2021,x,Friday,10:00,rad,,,\n04/09/2021,x,Saturday,10:00,rad,,,\n`);
    expect(withWeekday.entries.map((e) => e.date)).toEqual(['2021-09-03', '2021-09-04']);
    const german = readDaylioCsv(`${HEADER}\n03/09/2021,x,Freitag,10:00,rad,,,\n04/09/2021,x,Samstag,10:00,rad,,,\n10/09/2021,x,Freitag,10:00,rad,,,\n`);
    expect(german.entries.map((e) => e.date)).toEqual(['2021-09-03', '2021-09-04', '2021-09-10']); // same cell ↔ same weekday
    const none = readDaylioCsv(`${HEADER}\n03/09/2021,x,,10:00,rad,,,\n05/05/2021,x,,11:00,rad,,,\n`);
    expect(none.entries.map((e) => e.date)).toEqual(['2021-05-05']);
    expect(none.skipped).toEqual([{ where: '2', reason: 'ambiguous date' }]);
    const contradicted = readDaylioCsv(`${HEADER}\n03/09/2021,x,Sunday,10:00,rad,,,\n`);
    expect(contradicted.skipped).toEqual([{ where: '2', reason: 'date and weekday disagree' }]);
  });

  it('two-digit years are never guessed; YYYY/MM/DD and a year anywhere still read', () => {
    const s = readDaylioCsv(`${HEADER}\n9/15/21,15 September,Wednesday,10:00,rad,,,\n2021/09/14,x,Tuesday,10:00,rad,,,\nTue 2021,13 September,Monday,10:00,rad,,,\n`);
    expect(s.entries.map((e) => e.date)).toEqual(['2021-09-14', '2021-09-13']);
    expect(s.skipped).toEqual([{ where: '2', reason: 'unreadable date' }]);
  });
});

describe('N3 / blind set 1 — rows with more cells than the header are malformed', () => {
  it('skipped and listed; a 9-column header with "scales" still reads', () => {
    const s = readDaylioCsv(`${HEADER}\n2021-06-02,2 June,Wednesday,10:00,good,"","","",""\n2021-06-01,1 June,Tuesday,09:00,rad,"sport","","first"\n`);
    expect(s.entries.map((e) => e.date)).toEqual(['2021-06-01']);
    expect(s.skipped).toEqual([{ where: '2', reason: 'extra columns' }]);
    const scales = readDaylioCsv('full_date,date,weekday,time,mood,activities,scales,note_title,note\n2026-09-21,21 settembre,lunedì,10:00,rad,"","Stress: 3/5","",""\n');
    expect(scales.entries).toHaveLength(1);
  });
});

describe('truncated files (orchestrator rule = SPEC)', () => {
  it('cut inside a quoted cell → refused; cut mid-row outside quotes → that row skipped, the rest imports', () => {
    expect(code(() => readDaylioCsv(`${HEADER}\n2021-06-01,1 June,Tuesday,09:00,rad,"sport","","first\n`))).toBe('damaged');
    const s = readDaylioCsv(`${HEADER}\n2021-06-02,2 June,Wednesday,10:00,good,"","",""\n2021-06-01,1 June,Tue`);
    expect(s.entries).toHaveLength(1);
    expect(s.skipped).toEqual([{ where: '3', reason: 'missing columns' }]);
  });
});

describe('cost of the new checks (CRC-32, strict UTF-8, per-file timing pass)', () => {
  it('a 20,000-entry backup still reads and plans in Node well under the old budget', () => {
    const entries = Array.from({ length: 20_000 }, (_, i) => {
      const day = new Date(Date.UTC(2015, 0, 1) + Math.floor(i / 5) * 86_400_000).toISOString().slice(0, 10);
      return entryAt(i + 1, `${day} ${String(8 + (i % 5) * 3).padStart(2, '0')}:15`, 60, { note: `<p>Note ${i} with &amp; and a < b</p>`, tags: [1, 2] });
    });
    const zip = backupOf(journal(entries));
    const t0 = performance.now();
    const s = readDaylioBackup(zip);
    const t1 = performance.now();
    const p = plan(s);
    const t2 = performance.now();
    console.log(`20k backup (${(zip.length / 1e6).toFixed(1)} MB zip): read ${Math.round(t1 - t0)} ms, plan ${Math.round(t2 - t1)} ms`);
    expect(p.counts.entries).toBe(20_000);
    expect(t1 - t0).toBeLessThan(3000);
  });
});

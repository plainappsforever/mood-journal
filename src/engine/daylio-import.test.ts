/**
 * @jest-environment node
 */
// Daylio importers against the hand-made TUNING fixtures (D24 — not accuracy evidence; the blind set is P4).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { BACKUP_V15, buildDaylioZip, markEncrypted, markZip64, PHOTO_BYTES } from './__fixtures__/daylio/build-backup';
import { readDaylioBackup } from './daylio-backup';
import { htmlToText, ImportError, proposeLevel } from './daylio-common';
import { detectLayout, parseCsv, parseDaylioTime, parseDayMonth, readDaylioCsv } from './daylio-csv';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__/daylio', name), 'utf8');
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
  return 'no error';
};

describe('CSV parsing', () => {
  it('RFC 4180: BOM, quotes, escaped quotes, line breaks in quotes, CRLF/LF/CR, blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n"multi\nline",z\rlast,\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', 'z'],
      ['last', ''],
    ]);
    expect(code(() => parseCsv('a,"open'))).toBe('damaged');
  });

  it('times: 12 h and 24 h variants', () => {
    expect(['10:00 pm', '10:00 PM', '8:15 am', '12:00 am', '12:30 pm', '11:59 PM', '10:00 p.m.', '9:05am', '22:00', '07:05', '22:00:00'].map(parseDaylioTime)).toEqual([
      '22:00', '22:00', '08:15', '00:00', '12:30', '23:59', '22:00', '09:05', '22:00', '07:05', '22:00',
    ]);
    expect(['25:00', '13:00 pm', '0:00 am', 'noon', '10:60'].map(parseDaylioTime)).toEqual([null, null, null, null, null]);
  });

  it('legacy day-month formats (English month names)', () => {
    expect(parseDayMonth('23-Jan')).toEqual({ month: 1, day: 23 });
    expect(parseDayMonth('January 23')).toEqual({ month: 1, day: 23 });
    expect(parseDayMonth('28 September')).toEqual({ month: 9, day: 28 });
    expect(parseDayMonth('Sept. 3')).toEqual({ month: 9, day: 3 });
    expect(parseDayMonth('23-Janvier')).toBeNull();
  });

  it('header detection: current, legacy, guessed by position (UNCONFIRMED), unknown', () => {
    expect(detectLayout(['full_date', 'date', 'weekday', 'time', 'mood', 'activities', 'note_title', 'note'])).toMatchObject({ kind: 'current', guessed: false });
    expect(detectLayout(['year', 'date', 'weekday', 'time', 'mood', 'activities', 'note'])).toMatchObject({ kind: 'legacy', guessed: false });
    expect(detectLayout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toMatchObject({ kind: 'current', guessed: true });
    expect(detectLayout(['a', 'b'])).toBeNull();
  });
});

describe('Daylio CSV import (tuning fixtures)', () => {
  it('current 8-column export: entries, moods with proposals, activities, notes', () => {
    const s = readDaylioCsv(fixture('current-12h.csv'), new Map([['average', 3]]));
    expect(s.kind).toBe('daylio_csv');
    expect(s.entries.map((e) => [e.where, e.date, e.time, e.moodRef, e.activityRefs.join('|')])).toEqual([
      ['2', '2021-09-28', '22:00', 'sad', 'clean|music|movies / tv'],
      ['3', '2021-09-28', '08:15', 'rad', 'sport|friends'],
      ['4', '2021-09-27', '00:00', 'meh', ''],
      ['5', '2021-09-26', '12:30', 'average', 'family|süßes|café'],
      ['6', '2021-09-25', '23:59', 'awful', 'sick'],
    ]);
    expect(s.entries[1]).toMatchObject({ noteTitle: 'Morning, finally', note: 'Ran 5 km, then "coffee".\nFelt great.', utcMs: null });
    expect(s.entries[3].note).toBe('Kuchen 🍰 mit Oma');
    expect(s.moods).toEqual([
      { ref: 'sad', name: 'sad', proposedLevel: null, archived: false }, // custom name, trailing space trimmed: user must choose
      { ref: 'rad', name: 'rad', proposedLevel: 5, archived: false },
      { ref: 'meh', name: 'meh', proposedLevel: 3, archived: false },
      { ref: 'average', name: 'average', proposedLevel: 3, archived: false }, // known from the user's journal
      { ref: 'awful', name: 'awful', proposedLevel: 1, archived: false },
    ]);
    expect(s.activities.find((a) => a.ref === 'süßes')).toEqual({ ref: 'süßes', name: 'Süßes', groupRef: null, archived: false });
    expect(s.warnings).toEqual([]);
  });

  it('legacy 7-column export: year + day-month, impossible dates skipped by row number', () => {
    const s = readDaylioCsv(fixture('legacy-24h.csv'));
    expect(s.entries.map((e) => [e.date, e.time, e.moodRef, e.note])).toEqual([
      ['2019-01-23', '21:30', 'good', 'Long day'],
      ['2019-01-22', '07:05', 'meh', ''],
      ['2020-02-29', '23:00', 'rad', 'Leap day, at last'],
    ]);
    expect(s.skipped).toEqual([{ where: '4', reason: 'unreadable date' }]);
    expect(s.entries[0].noteTitle).toBe('');
  });

  it('malformed rows are skipped and listed by row number; good rows survive', () => {
    const s = readDaylioCsv(fixture('malformed.csv'));
    expect(s.skipped).toEqual([
      { where: '2', reason: 'unreadable time' },
      { where: '3', reason: 'unreadable date' },
      { where: '4', reason: 'no mood' },
      { where: '5', reason: 'missing columns' },
    ]);
    expect(s.entries.map((e) => [e.where, e.time])).toEqual([['6', '09:00']]);
    expect(s.warnings.filter((w) => w.code === 'badRow')).toHaveLength(4);
  });

  it('UNCONFIRMED localized header: read by position with a warning', () => {
    const s = readDaylioCsv(fixture('localized-header.csv'));
    expect(s.warnings).toEqual([{ code: 'headerGuessed' }]);
    expect(s.entries[0]).toMatchObject({ date: '2024-03-31', time: '02:30', moodRef: 'gut', activityRefs: ['familie'] });
  });

  it('HTML notes are converted; plain "<" text is kept', () => {
    const s = readDaylioCsv(fixture('html-note.csv'));
    expect(s.entries[0]).toMatchObject({ noteTitle: 'Title &amp; more', note: 'First line\nSecond & third\nfourth' });
    expect(s.entries[1].note).toBe('I <3 tea, 2 < 3');
  });

  it('files it cannot read', () => {
    expect(code(() => readDaylioCsv(''))).toBe('noEntries');
    expect(code(() => readDaylioCsv('foo,bar\n1,2'))).toBe('unknownHeader');
    expect(code(() => readDaylioCsv('full_date,date,weekday,time,mood,activities,note_title,note\n'))).toBe('noEntries');
  });
});

describe('Daylio backup import (tuning fixtures)', () => {
  const zip = buildDaylioZip();

  it('reads moods with level proposals, groups, activities, entries with local time from datetime + offset', () => {
    const s = readDaylioBackup(zip);
    expect(s).toMatchObject({ kind: 'daylio_backup', version: 15, goals: 1 });
    expect(s.moods.map((m) => [m.ref, m.name, m.proposedLevel, m.archived])).toEqual([
      ['1', 'rad', 5, false],
      ['2', 'good', 4, false],
      ['3', 'meh', 3, false],
      ['4', 'bad', 2, false],
      ['5', 'awful', 1, false],
      ['12', 'tired', 3, false],
      ['13', 'sad', 2, true],
    ]);
    expect(s.groups).toEqual([
      { ref: '2', name: 'People' },
      { ref: '1', name: 'Hobbies' },
    ]);
    expect(s.activities.map((a) => [a.ref, a.name, a.groupRef, a.archived])).toEqual([
      ['1', 'sport', '1', false],
      ['3', 'reading', '1', false],
      ['2', 'friends', '2', false],
      ['4', 'old hobby', '1', true],
      ['5', 'café & cake', null, false],
    ]);
    expect(s.entries.map((e) => [e.ref, e.date, e.time, e.tzOffsetMin, e.moodRef, e.activityRefs.join(','), e.photos.length])).toEqual([
      ['101', '2026-07-14', '21:30', 120, '1', '1,2', 1],
      ['102', '2026-01-10', '08:05', 60, '12', '3', 0],
      ['103', '2026-03-07', '22:00', -300, '13', '4', 0],
      ['104', '2026-01-01', '00:30', 60, '3', '5', 0],
      ['105', '2026-02-01', '12:00', 0, '2', '', 0],
    ]);
    expect(s.entries[0]).toMatchObject({ noteTitle: 'Summer', note: 'Lake swim\nCold & clear\nagain', utcMs: 1784057400000 });
    expect(s.entries[0].photos[0]).toEqual({ member: 'assets/abc123.jpg', bytes: PHOTO_BYTES });
    expect(s.skipped).toEqual([
      { where: '106', reason: 'unknown mood' },
      { where: '107', reason: 'no time stamp' },
    ]);
    expect(s.warnings.map((w) => [w.code, w.params?.ref ?? w.params?.row])).toEqual([
      ['dateMismatch', '102'], // month base is decided once per file (0-based here, review S6); 102 is 1-based
      ['missingPhoto', '102'],
      ['unknownTag', '103'],
      ['dateMismatch', '105'],
      ['unknownMood', '106'],
      ['badRow', '107'],
    ]);
  });

  it('accepts line-wrapped base64, raw JSON (with a warning), nested member paths and photo folders', () => {
    expect(readDaylioBackup(buildDaylioZip(BACKUP_V15, { wrapLines: true })).entries).toHaveLength(5);
    expect(readDaylioBackup(buildDaylioZip(BACKUP_V15, { raw: true })).warnings[0]).toEqual({ code: 'rawJson' });
    const nested = zipSync({ 'Daylio/backup.daylio': strToU8(Buffer.from(JSON.stringify(BACKUP_V15)).toString('base64')), 'assets/photos/2026/7/abc123.jpeg': PHOTO_BYTES });
    expect(readDaylioBackup(nested).entries[0].photos[0].member).toBe('assets/photos/2026/7/abc123.jpeg');
  });

  it('other versions are attempted with a warning', () => {
    const s = readDaylioBackup(buildDaylioZip({ ...BACKUP_V15, version: 16 }));
    expect(s.warnings[0]).toEqual({ code: 'version', params: { version: 16 } });
    expect(s.entries).toHaveLength(5);
  });

  it('refuses what it cannot read, with a reason', () => {
    expect(code(() => readDaylioBackup(new TextEncoder().encode('full_date,date')))).toBe('notZip');
    expect(code(() => readDaylioBackup(zipSync({ 'other.txt': strToU8('x') })))).toBe('notDaylio');
    expect(code(() => readDaylioBackup(markEncrypted(zip)))).toBe('encrypted');
    expect(code(() => readDaylioBackup(markZip64(zip)))).toBe('zip64');
    expect(code(() => readDaylioBackup(zip.subarray(0, zip.length - 30)))).toBe('damaged');
    expect(code(() => readDaylioBackup(zipSync({ 'backup.daylio': strToU8('not base64 ***') })))).toBe('damaged');
    expect(code(() => readDaylioBackup(zipSync({ 'backup.daylio': strToU8(Buffer.from('{"a":1}').toString('base64')) })))).toBe('notDaylio');
    expect(code(() => readDaylioBackup(buildDaylioZip({ ...BACKUP_V15, dayEntries: [] })))).toBe('noEntries');
    const big = { length: 300 * 1024 * 1024 + 1 } as Uint8Array;
    expect(code(() => readDaylioBackup(big))).toBe('tooLarge');
  });
});

describe('shared helpers', () => {
  it('HTML → text and level proposals', () => {
    expect(htmlToText('<p>a</p><p>b&nbsp;c<br/>d &#128512; &#x1F600; &lt;3</p>')).toBe('a\nb c\nd 😀 😀 <3');
    expect(htmlToText('<b>bold</b> <i>it</i>\r\n\r\n\r\n\r\nend')).toBe('bold it\n\n\n\nend'); // blank lines kept (M1)
    expect(proposeLevel(' RAD ', new Map())).toBe(5);
    expect(proposeLevel('Super', new Map([['super', 5]]))).toBe(5);
    expect(proposeLevel('average', new Map())).toBeNull();
  });
});

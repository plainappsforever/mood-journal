import { csvCell, entriesToCsv, type CsvEntry } from './csv-export';
import { parseCsv } from './daylio-csv';

const entry = (over: Partial<CsvEntry>): CsvEntry => ({
  date: '2026-10-15',
  time: '20:00',
  utcMs: 1,
  moodName: 'Good',
  level: 4,
  activityNames: ['walk', 'friends'],
  noteTitle: '',
  note: '',
  photos: 0,
  ...over,
});

describe('CSV export (A9)', () => {
  it('writes the documented columns, BOM, CRLF, newest first (within a day by moment)', () => {
    const csv = entriesToCsv([entry({ date: '2026-10-14' }), entry({ utcMs: 5, time: '21:00' }), entry({ utcMs: 2, time: '08:00', photos: 2 })]);
    expect(csv.startsWith('﻿date,time,weekday,mood,level,activities,note_title,note,photos\r\n')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines.slice(1)).toEqual([
      '2026-10-15,21:00,Thursday,Good,4,walk | friends,,,0',
      '2026-10-15,08:00,Thursday,Good,4,walk | friends,,,2',
      '2026-10-14,20:00,Wednesday,Good,4,walk | friends,,,0',
    ]);
  });

  it('neutralises formula injection and quotes commas, quotes and newlines', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe(`"'\rx"`);
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(4)).toBe('4');
    expect(csvCell('fine')).toBe('fine');
  });

  it('round-trips through the CSV parser (unicode, emoji, quotes, newlines)', () => {
    const tricky = entry({ moodName: 'müde 😴', noteTitle: 'He said "hi", then', note: 'a\nb, c\r\nd', activityNames: ['Süßes', 'café'] });
    const rows = parseCsv(entriesToCsv([tricky]));
    expect(rows[1]).toEqual(['2026-10-15', '20:00', 'Thursday', 'müde 😴', '4', 'Süßes | café', 'He said "hi", then', 'a\nb, c\r\nd', '0']);
  });
});

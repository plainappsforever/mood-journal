/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDaylioZip } from './__fixtures__/daylio/build-backup';
import { importReport } from './import-report';

const bytes = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__/daylio', name)));

describe('import report (blind-set contract)', () => {
  it('CSV: proposals or the given mapping, sorted activity names, skipped rows', () => {
    const r = importReport('current-12h.csv', bytes('current-12h.csv'), { today: '2026-10-16', mapping: new Map([['sad', 2]]) });
    expect(r).toMatchObject({ status: 'ok', kind: 'daylio_csv', skipped: [], warnings: [] });
    expect(r.entries[0]).toEqual({ date: '2021-09-28', time: '22:00', mood: 'sad', level: 2, activities: ['clean', 'movies / tv', 'music'], title: '', note: '', photos: 0 });
    expect(r.entries.find((e) => e.mood === 'average')!.level).toBeNull(); // no proposal, no mapping
    expect(importReport('malformed.csv', bytes('malformed.csv'), { today: '2026-10-16' }).skipped).toHaveLength(4);
  });

  it('backup: photos counted, warnings as codes; unreadable files report their error', () => {
    const r = importReport('b.daylio', buildDaylioZip(), { today: '2026-10-16' });
    expect(r.kind).toBe('daylio_backup');
    expect(r.entries.map((e) => [e.date, e.time, e.mood, e.level, e.photos])[0]).toEqual(['2026-07-14', '21:30', 'rad', 5, 1]);
    expect(r.warnings).toEqual(['dateMismatch', 'missingPhoto', 'unknownTag', 'dateMismatch', 'unknownMood', 'badRow', 'goalsNotImported']);
    expect(importReport('x.bin', new Uint8Array([0xff, 0xfe, 0x00]), { today: '2026-10-16' })).toMatchObject({ status: 'error', error: 'notZip' });
    expect(importReport('x.zip', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), { today: '2026-10-16' })).toMatchObject({ status: 'error', error: 'damaged' });
  });
});

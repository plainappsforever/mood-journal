import { strFromU8 } from 'fflate';

import { base64, daylioBackupFixture, daylioCsvFixture, daylioCsvLarge } from '@/dev/fixtures';
import { buildDaylioZip } from '@/engine/__fixtures__/daylio/build-backup';
import { readDaylioBackup } from '@/engine/daylio-backup';
import { readDaylioCsv } from '@/engine/daylio-csv';

// The dev-link fixtures (Maestro import flow, S9) must be valid Daylio files for the real readers.
describe('dev fixtures', () => {
  it('small CSV: 4 entries, a custom mood without a proposed level, nothing skipped', () => {
    const s = readDaylioCsv(strFromU8(daylioCsvFixture()));
    expect(s.entries).toHaveLength(4);
    expect(s.skipped).toEqual([]);
    expect(s.moods.find((m) => m.name === 'sleepy')?.proposedLevel).toBeNull();
    expect(s.moods.find((m) => m.name === 'rad')?.proposedLevel).toBe(5);
  });
  it('base64 matches Node and the backup equals the Jest builder', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 300]) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(base64(b)).toBe(Buffer.from(b).toString('base64'));
    }
    expect(readDaylioBackup(daylioBackupFixture()).entries).toEqual(readDaylioBackup(buildDaylioZip()).entries);
  });
  it('backup fixture reads; S9 CSV has days × perDay rows', () => {
    expect(readDaylioBackup(daylioBackupFixture()).entries.length).toBeGreaterThan(0);
    const big = readDaylioCsv(strFromU8(daylioCsvLarge(400, 5, '2026-10-16')));
    expect(big.entries).toHaveLength(2000);
    expect(big.skipped).toEqual([]);
  });
});

import { autoFileName, errorCode, generatePassword, isAutoName, isDue, lastOk, rotation, type AutoState } from './auto-backup-plan';

const base: AutoState = { on: true, hasFolder: true, changedMs: null, status: null };
const ok = (day: string, atMs: number) => ({ ok: true as const, atMs, day, name: `mood-auto-${day}.moodbackup`, files: 1 });

describe('isDue (SPEC: background, changed since the last automatic file, at most once per local day)', () => {
  it('needs the switch and a folder', () => {
    expect(isDue({ ...base, on: false }, '2026-10-16')).toBe(false);
    expect(isDue({ ...base, hasFolder: false }, '2026-10-16')).toBe(false);
  });
  it('first file is due at once', () => expect(isDue(base, '2026-10-16')).toBe(true));
  it('once per day, even with changes', () => expect(isDue({ ...base, changedMs: 9e12, status: ok('2026-10-16', 100) }, '2026-10-16')).toBe(false));
  it('next day only if the journal changed after the last file', () => {
    expect(isDue({ ...base, changedMs: 50, status: ok('2026-10-15', 100) }, '2026-10-16')).toBe(false);
    expect(isDue({ ...base, changedMs: null, status: ok('2026-10-15', 100) }, '2026-10-16')).toBe(false);
    expect(isDue({ ...base, changedMs: 150, status: ok('2026-10-15', 100) }, '2026-10-16')).toBe(true);
  });
  it('a failure does not count as today’s file; the last good one still decides', () => {
    const failed = { ok: false as const, atMs: 200, error: 'missing' as const, lastOk: ok('2026-10-15', 100) };
    expect(lastOk(failed)?.day).toBe('2026-10-15');
    expect(isDue({ ...base, changedMs: 150, status: failed }, '2026-10-16')).toBe(true);
    expect(isDue({ ...base, changedMs: 150, status: { ok: false, atMs: 200, error: 'write' } }, '2026-10-16')).toBe(true);
  });
});

describe('file names and rotation', () => {
  it('never overwrites: -2, -3 when the name exists', () => {
    expect(autoFileName('2026-10-16', [])).toBe('mood-auto-2026-10-16.moodbackup');
    expect(autoFileName('2026-10-16', ['mood-auto-2026-10-16.moodbackup'])).toBe('mood-auto-2026-10-16-2.moodbackup');
    expect(autoFileName('2026-10-16', ['mood-auto-2026-10-16.moodbackup', 'mood-auto-2026-10-16-2.moodbackup'])).toBe('mood-auto-2026-10-16-3.moodbackup');
    expect(isAutoName('mood-auto-2026-10-16-3.moodbackup')).toBe(true);
    expect(isAutoName('mood-2026-10-16.moodbackup')).toBe(false);
    expect(isAutoName('mood-auto-2026-10-16.moodbackup.txt')).toBe(false);
  });
  it('deletes only the oldest files this app wrote, keeps foreign and manual files', () => {
    const written = ['mood-auto-2026-10-01.moodbackup', 'mood-auto-2026-10-02.moodbackup', 'mood-auto-2026-10-02-2.moodbackup', 'mood-auto-2026-10-03.moodbackup'];
    const present = [...written, 'mood-auto-2026-09-30.moodbackup' /* other phone */, 'mood-2026-10-01.moodbackup' /* manual */, 'notes.txt'];
    expect(rotation(written, present, 2)).toEqual({ remove: written.slice(0, 2), written: written.slice(2) });
    expect(rotation(written, present, 0)).toEqual({ remove: [], written });
    expect(rotation(written, present, 10)).toEqual({ remove: [], written });
  });
  it('forgets files that are gone and ignores names that are not automatic backups', () => {
    expect(rotation(['mood-auto-2026-10-01.moodbackup', 'evil.txt', 'mood-auto-2026-10-02.moodbackup'], ['mood-auto-2026-10-02.moodbackup', 'evil.txt'], 1)).toEqual({
      remove: [],
      written: ['mood-auto-2026-10-02.moodbackup'],
    });
  });
});

describe('generated password and error codes', () => {
  it('20 symbols in 5 groups, no look-alikes, rejection sampling', () => {
    const bytes = new Uint8Array(64).map((_, i) => (i * 37 + 11) % 256);
    const p = generatePassword(bytes);
    expect(p).toMatch(/^([a-hj-km-np-z2-9]{4}-){4}[a-hj-km-np-z2-9]{4}$/);
    expect(() => generatePassword(new Uint8Array(19))).toThrow();
    expect(generatePassword(new Uint8Array(40).fill(250).map((v, i) => (i < 5 ? v : i)))).toHaveLength(24);
  });
  it('maps native messages', () => {
    expect(errorCode("Calling the 'writeFile' function has failed → Caused by: missing: folder not found")).toBe('missing');
    expect(errorCode('java.lang.SecurityException: Permission Denial')).toBe('access');
    expect(errorCode('ENOSPC: no space left')).toBe('full');
    expect(errorCode('something else')).toBe('write');
  });
});

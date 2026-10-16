// cachedOffsetFn (review S9) must give exactly the offsets of the Intl function, also on transition days.
import { cachedOffsetFn, localToUtc, zoneOffsetFn } from './dates';
import { prngForTest } from '../../test/prng';

const ZONES = ['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kolkata', 'Europe/Moscow', 'America/Sao_Paulo', 'Pacific/Apia', 'Asia/Tehran', 'UTC'];
const FROM = Date.UTC(1900, 0, 1);
const TO = Date.UTC(2036, 0, 1);

describe('cachedOffsetFn', () => {
  it.each(ZONES)('%s: same offset as Intl at random instants and around every transition', (zone) => {
    const exact = zoneOffsetFn(zone);
    const cached = cachedOffsetFn(exact);
    const rnd = prngForTest(20261016);
    for (let i = 0; i < 1500; i++) {
      const t = Math.floor(FROM + rnd() * (TO - FROM));
      expect([zone, t, cached(t)]).toEqual([zone, t, exact(t)]);
    }
    // Transitions 1970–2035, found in 12 h steps; every 5 minutes from 1 h before to 1 h after the step must agree.
    let checked = 0;
    const STEP = 12 * 3_600_000;
    for (let t = Date.UTC(1970, 0, 1); t < TO; t += STEP) {
      if (exact(t) === exact(t + STEP)) continue;
      for (let m = -60; m <= 12 * 60 + 60; m += 5) expect(cached(t + m * 60_000)).toBe(exact(t + m * 60_000));
      checked++;
    }
    if (zone !== 'UTC' && zone !== 'Asia/Kolkata') expect(checked).toBeGreaterThan(0);
  });

  it('localToUtc gives the same instants with the cache (DST gaps and overlaps included)', () => {
    for (const zone of ['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe']) {
      const exact = zoneOffsetFn(zone);
      const cached = cachedOffsetFn(exact);
      const rnd = prngForTest(7);
      for (let i = 0; i < 2000; i++) {
        const day = new Date(Date.UTC(1990, 0, 1) + Math.floor(rnd() * 16000) * 86_400_000).toISOString().slice(0, 10);
        const time = `${String(Math.floor(rnd() * 24)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`;
        expect(localToUtc(day, time, cached)).toBe(localToUtc(day, time, exact));
      }
      for (const [d, t] of [['2026-03-29', '02:30'], ['2026-10-25', '02:30'], ['2026-03-08', '02:15'], ['2026-11-01', '01:30'], ['2026-04-05', '01:45'], ['2026-10-04', '02:10']]) {
        expect(localToUtc(d, t, cached)).toBe(localToUtc(d, t, exact));
      }
    }
  });

  it('asks Intl far less often for a 20k-entry span', () => {
    let calls = 0;
    const exact = zoneOffsetFn('Europe/Berlin');
    const counting = (t: number) => (calls++, exact(t));
    const cached = cachedOffsetFn(counting);
    for (let d = 0; d < 4000; d++) for (const h of [8, 12, 16, 20, 23]) localToUtc(new Date(Date.UTC(2015, 0, 1) + d * 86_400_000).toISOString().slice(0, 10), `${h}:05`.padStart(5, '0'), cached);
    expect(calls).toBeLessThan(4000 * 3);
  });
});

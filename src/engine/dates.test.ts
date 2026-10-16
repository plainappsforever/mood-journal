import {
  addDays,
  addMonths,
  checkEntryDate,
  diffDays,
  eachDay,
  instanceOf,
  isoWeekday,
  isValidDate,
  journalDayOf,
  localToUtc,
  previousPeriod,
  utcForJournalTime,
  wallClock,
  weekStartOf,
  zoneOffsetFn,
} from './dates';

const berlin = zoneOffsetFn('Europe/Berlin');
const newYork = zoneOffsetFn('America/New_York');
const lordHowe = zoneOffsetFn('Australia/Lord_Howe');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const utc = (s: string) => Date.parse(`${s}:00Z`);

describe('date strings', () => {
  it('validates real calendar dates incl. leap years', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2000-02-29')).toBe(true);
    expect(isValidDate('1900-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
  });

  it('adds days across month, year and leap-day boundaries, never by 24 h', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // Berlin DST day
    expect(addDays('1900-01-01', -1)).toBe('1899-12-31');
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
    expect(eachDay('2024-02-27', '2024-03-01')).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
    expect(eachDay('2024-03-02', '2024-03-01')).toEqual([]);
  });

  it('weekdays and week instances for week starts Monday, Sunday and Saturday', () => {
    expect(isoWeekday('2026-10-16')).toBe(5); // Friday
    expect(isoWeekday('1970-01-01')).toBe(4);
    expect(isoWeekday('1900-01-01')).toBe(1);
    expect(weekStartOf('2026-10-16', 1)).toBe('2026-10-12');
    expect(weekStartOf('2026-10-16', 7)).toBe('2026-10-11');
    expect(weekStartOf('2026-10-16', 6)).toBe('2026-10-10');
    expect(weekStartOf('2026-10-10', 6)).toBe('2026-10-10');
    // across the year end
    expect(instanceOf('2026-01-01', 'week', 1)).toEqual({ start: '2025-12-29', end: '2026-01-04' });
    expect(instanceOf('2027-01-01', 'week', 7)).toEqual({ start: '2026-12-27', end: '2027-01-02' });
    expect(instanceOf('2024-02-10', 'month', 1)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(instanceOf('2025-02-10', 'month', 1)).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ start: '2026-01-29', end: '2026-02-28' });
  });

  it('entry dates: 1900-01-01 … today + 1', () => {
    expect(checkEntryDate('2026-10-17', '2026-10-16')).toBe('ok');
    expect(checkEntryDate('2026-10-18', '2026-10-16')).toBe('future');
    expect(checkEntryDate('1900-01-01', '2026-10-16')).toBe('ok');
    expect(checkEntryDate('1899-12-31', '2026-10-16')).toBe('too-early');
    expect(checkEntryDate('2026-02-30', '2026-10-16')).toBe('invalid');
  });
});

describe('zones', () => {
  it('offsets in Berlin and New York around DST changes', () => {
    expect(berlin(utc('2026-03-29T00:59'))).toBe(60);
    expect(berlin(utc('2026-03-29T01:00'))).toBe(120);
    expect(berlin(utc('2026-10-25T00:59'))).toBe(120);
    expect(berlin(utc('2026-10-25T01:00'))).toBe(60);
    expect(newYork(utc('2026-03-08T06:59'))).toBe(-300);
    expect(newYork(utc('2026-03-08T07:00'))).toBe(-240);
    expect(lordHowe(utc('2026-01-01T00:00'))).toBe(660);
  });

  it('local → UTC: normal, spring-forward gap = first valid minute after, fall-back overlap = first occurrence', () => {
    expect(iso(localToUtc('2026-07-01', '12:00', berlin))).toBe('2026-07-01T10:00');
    expect(iso(localToUtc('2026-03-29', '02:30', berlin))).toBe('2026-03-29T01:00'); // = 03:00 CEST
    expect(iso(localToUtc('2026-03-29', '02:00', berlin))).toBe('2026-03-29T01:00');
    expect(iso(localToUtc('2026-03-29', '03:00', berlin))).toBe('2026-03-29T01:00');
    expect(iso(localToUtc('2026-10-25', '02:30', berlin))).toBe('2026-10-25T00:30'); // first 02:30 (CEST)
    expect(iso(localToUtc('2026-10-25', '03:00', berlin))).toBe('2026-10-25T02:00');
    expect(iso(localToUtc('2026-03-08', '02:15', newYork))).toBe('2026-03-08T07:00'); // = 03:00 EDT
    expect(iso(localToUtc('2026-11-01', '01:30', newYork))).toBe('2026-11-01T05:30'); // first 01:30 (EDT)
    expect(iso(localToUtc('2026-10-04', '02:10', lordHowe))).toBe('2026-10-03T15:30'); // 30-minute gap → 02:30
  });

  it('wall clock of a moment', () => {
    expect(wallClock(utc('2026-10-25T00:30'), berlin)).toMatchObject({ date: '2026-10-25', time: '02:30', offsetMin: 120 });
    expect(wallClock(utc('2026-10-25T01:30'), berlin)).toMatchObject({ date: '2026-10-25', time: '02:30', offsetMin: 60 });
    expect(wallClock(utc('2026-01-01T03:00'), newYork)).toMatchObject({ date: '2025-12-31', time: '22:00', offsetMin: -300 });
  });
});

describe('Formula 14 — journal day', () => {
  it('a new entry before the day-end hour belongs to yesterday; utc stays the real moment', () => {
    // 01:30 Berlin (CEST) on 16 Oct
    const moment = utc('2026-10-15T23:30');
    expect(journalDayOf(moment, berlin, 0)).toEqual({ localDate: '2026-10-16', localTime: '01:30', tzOffsetMin: 120 });
    expect(journalDayOf(moment, berlin, 1)).toEqual({ localDate: '2026-10-16', localTime: '01:30', tzOffsetMin: 120 });
    expect(journalDayOf(moment, berlin, 2)).toEqual({ localDate: '2026-10-15', localTime: '01:30', tzOffsetMin: 120 });
    expect(journalDayOf(moment, berlin, 3).localDate).toBe('2026-10-15');
    // New York on its fall-back night, 01:30 EST (the second 01:30) with "my day ends at 2:00"
    expect(journalDayOf(utc('2026-11-01T06:30'), newYork, 2)).toEqual({ localDate: '2026-10-31', localTime: '01:30', tzOffsetMin: -300 });
    // 1 Jan 00:10 with day end 1 → 31 Dec of the previous year
    expect(journalDayOf(utc('2026-12-31T23:10'), berlin, 1).localDate).toBe('2026-12-31');
    expect(journalDayOf(utc('2027-01-01T00:10'), berlin, 2).localDate).toBe('2026-12-31');
  });

  it('editing journal day X at time t: local(X, t), or local(X + 1, t) when t is before the day-end hour', () => {
    expect(iso(utcForJournalTime('2026-10-15', '01:30', 3, berlin))).toBe('2026-10-15T23:30');
    expect(iso(utcForJournalTime('2026-10-15', '01:30', 0, berlin))).toBe('2026-10-14T23:30');
    expect(iso(utcForJournalTime('2026-10-15', '03:00', 3, berlin))).toBe('2026-10-15T01:00');
    // X + 1 lands on Berlin's spring-forward night: 02:30 does not exist → 03:00 CEST
    expect(iso(utcForJournalTime('2026-03-28', '02:30', 4, berlin))).toBe('2026-03-29T01:00');
    // round trip: the edited moment's journal day is X again
    const u = utcForJournalTime('2026-11-01', '01:15', 2, newYork);
    expect(journalDayOf(u, newYork, 2)).toMatchObject({ localDate: '2026-11-01', localTime: '01:15' });
  });
});

describe('previous period (Formula 11, review S8, D53)', () => {
  it('rolling and custom periods: equal length right before', () => {
    expect(previousPeriod('2026-09-17', '2026-10-16')).toEqual({ start: '2026-08-18', end: '2026-09-16' });
  });
  it('calendar month chip: the previous calendar month, or the same days of it when running to date', () => {
    expect(previousPeriod('2026-09-01', '2026-09-30', 'month')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(previousPeriod('2026-03-01', '2026-03-31', 'month')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousPeriod('2024-03-01', '2024-03-31', 'month')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(previousPeriod('2026-02-01', '2026-02-28', 'month')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(previousPeriod('2026-10-01', '2026-10-16', 'month')).toEqual({ start: '2026-09-01', end: '2026-09-16' });
    expect(previousPeriod('2026-01-01', '2026-01-31', 'month')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });
  it('calendar year chip: the previous calendar year (leap years included), or the same days of it', () => {
    expect(previousPeriod('2024-01-01', '2024-12-31', 'year')).toEqual({ start: '2023-01-01', end: '2023-12-31' });
    expect(previousPeriod('2025-01-01', '2025-12-31', 'year')).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(previousPeriod('2024-01-01', '2024-02-29', 'year')).toEqual({ start: '2023-01-01', end: '2023-02-28' });
    expect(previousPeriod('2026-01-01', '2026-10-16', 'year')).toEqual({ start: '2025-01-01', end: '2025-10-16' });
  });
  it('addMonths clamps the day and keeps month ends sticky on request', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', -1, true)).toBe('2026-01-31');
    expect(addMonths('2026-02-28', -1)).toBe('2026-01-28');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
  });
});

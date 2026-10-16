#!/usr/bin/env python3
"""Seeded random journal generator for the statistics oracle (SPEC "Formulas" 1-14, acceptance A3).

Writes a JSON list of journals. Each journal is the input contract shared by stats_oracle.py and the Jest runner
(src/engine/stats/oracle.test.ts). The generator knows nothing about the engine; it only produces inputs, with deliberate
edge cases: empty journals, one entry, zero variance, an activity on every entry, several entries per day, archived
moods/activities, leap days, year ends, week starts Monday/Sunday/Saturday, periods at the 92/731-day series limits,
DST days in Europe/Berlin, America/New_York and Australia/Lord_Howe (30-minute shift).

Usage: python3 -I gen_journals.py <seed> <count> <out.json>
"""
import datetime as dt
import json
import random
import sys

ZONES = ["Europe/Berlin", "America/New_York", "Australia/Lord_Howe", "Asia/Kolkata", "UTC"]
WEEK_STARTS = [1, 7, 6]  # ISO weekday the week starts on: Monday, Sunday, Saturday


def iso(d):
    return d.isoformat()


def rand_time(rng):
    return "%02d:%02d" % (rng.randrange(24), rng.randrange(60))


def dst_like_day(rng):
    """A day near a DST change in one of the zones (late Mar, late Oct, early/mid Mar, early Nov, early Apr/Oct)."""
    year = rng.randrange(2015, 2031)
    month, lo, hi = rng.choice([(3, 24, 31), (10, 24, 31), (3, 7, 15), (11, 1, 8), (4, 1, 8), (10, 1, 8)])
    return dt.date(year, month, rng.randrange(lo, hi + 1))


def make_journal(rng, index):
    kind = index % 20  # deterministic share of edge cases
    week_start = rng.choice(WEEK_STARTS)
    # Base start date: bias towards leap years and year ends.
    year = rng.choice([2015, 2016, 2019, 2020, 2023, 2024, 2025, 2026, 2027, 2028])
    if rng.random() < 0.3:
        start = dt.date(year, 12, rng.randrange(1, 32))
    elif rng.random() < 0.3:
        start = dt.date(year, 2, rng.randrange(1, 29))
    else:
        start = dt.date(year, 1, 1) + dt.timedelta(days=rng.randrange(365))
    span = rng.choice([1, 5, 20, 40, 95, 200, 400, 800, 1200])
    if kind == 0:
        span = 0  # empty journal
    n_moods = rng.randrange(5, 10)
    moods = []
    for level in range(1, 6):
        moods.append({"id": len(moods) + 1, "level": level, "archived": False})
    while len(moods) < n_moods:
        moods.append({"id": len(moods) + 1, "level": rng.randrange(1, 6), "archived": rng.random() < 0.3})
    n_acts = rng.randrange(3, 13)
    activities = [{"id": 100 + i, "archived": rng.random() < 0.15} for i in range(n_acts)]
    act_prob = {a["id"]: rng.choice([0.05, 0.2, 0.4, 0.7, 1.0]) for a in activities}
    if kind == 3:
        act_prob[activities[0]["id"]] = 1.0  # activity on every entry: "without" has n = 0
    if kind == 4:
        act_prob[activities[0]["id"]] = 0.5
    log_prob = rng.choice([0.3, 0.6, 0.9, 1.0])
    max_per_day = rng.choice([1, 2, 3, 6])
    fixed_level_mood = rng.choice(moods)["id"] if kind == 2 else None  # zero variance everywhere
    entries = []
    for offset in range(span):
        day = start + dt.timedelta(days=offset)
        if kind == 1 and entries:
            break  # a single entry
        if rng.random() > log_prob:
            continue
        for _ in range(rng.randrange(1, max_per_day + 1)):
            mood = fixed_level_mood if fixed_level_mood else rng.choice(moods)["id"]
            acts = sorted(a for a, p in act_prob.items() if rng.random() < p)
            if kind == 4:  # level fully determined by one activity: both variances 0, delta != 0 -> |t| = infinity
                mood = 1 if activities[0]["id"] in acts else 5
            entries.append({"id": len(entries) + 1, "mood_id": mood, "date": iso(day), "time": rand_time(rng), "activities": acts})
    rng.shuffle(entries)  # the engine must not rely on input order
    last = start + dt.timedelta(days=max(span - 1, 0))
    today = last + dt.timedelta(days=rng.choice([-3, -1, 0, 0, 0, 1, 2, 10]))
    # Period: a random sub-range, often at the series limits.
    length = rng.choice([1, 7, 30, 92, 93, 180, 365, 366, 731, 732, 1000, max(span, 1)])
    p_end = today if rng.random() < 0.6 else start + dt.timedelta(days=rng.randrange(max(span, 1)))
    p_start = p_end - dt.timedelta(days=length - 1)
    stats_period = {"start": iso(p_start), "end": iso(p_end)}
    # Calendar month / year chips (Formula 11 previous calendar period, D53): own RNG, so the rest stays as before.
    krng = random.Random(index * 7919 + 17)
    pick = krng.random()
    if pick < 0.3:
        anchor = p_end
        if krng.random() < 0.3:  # month ends and leap days, where clamping matters
            special = krng.choice([dt.date(2024, 2, 29), dt.date(2024, 3, 31), dt.date(2025, 3, 31), dt.date(2023, 12, 31), dt.date(2024, 5, 31), dt.date(2024, 12, 31)])
            anchor = min(max(special, start), today)
        full = krng.random() < 0.5
        if pick < 0.2:
            m_end = dt.date(anchor.year + anchor.month // 12, anchor.month % 12 + 1, 1) - dt.timedelta(days=1)
            stats_period = {"start": iso(anchor.replace(day=1)), "end": iso(m_end if full else anchor), "kind": "month"}
        else:
            stats_period = {"start": iso(dt.date(anchor.year, 1, 1)), "end": iso(dt.date(anchor.year, 12, 31) if full else anchor), "kind": "year"}
    goals = []
    for g in range(rng.randrange(0, 5)):
        period = rng.choice(["day", "week", "month"])
        target = 1 if period == "day" else rng.randrange(1, 6 if period == "week" else 20)
        s = start + dt.timedelta(days=rng.randrange(-10, max(span, 1) + 5))
        goals.append({"id": g + 1, "activity_id": rng.choice(activities)["id"], "period": period, "target": target, "start_date": iso(s)})
    journal_day_cases = []
    edit_cases = []
    for _ in range(6):
        zone = rng.choice(ZONES)
        day = dst_like_day(rng)
        base = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)
        utc_ms = int((base + dt.timedelta(minutes=rng.randrange(-24 * 60, 48 * 60))).timestamp() * 1000)
        journal_day_cases.append({"zone": zone, "utc_ms": utc_ms, "day_end_hour": rng.randrange(0, 5)})
        hour = rng.choice([0, 1, 2, 2, 3, 4, rng.randrange(24)])
        edit_cases.append({"zone": zone, "date": iso(day), "time": "%02d:%02d" % (hour, rng.choice([0, 15, 30, 45, 59, rng.randrange(60)])), "day_end_hour": rng.randrange(0, 5)})
    return {
        "id": "j%05d" % index,
        "week_start": week_start,
        "today": iso(today),
        "period": stats_period,
        "moods": moods,
        "activities": activities,
        "entries": entries,
        "goals": goals,
        "journal_day_cases": journal_day_cases,
        "edit_cases": edit_cases,
    }


def main():
    seed, count, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    journals = [make_journal(random.Random(seed * 1_000_003 + i), i) for i in range(count)]
    with open(out, "w", encoding="utf-8") as f:
        json.dump(journals, f)


if __name__ == "__main__":
    main()

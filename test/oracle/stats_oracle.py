#!/usr/bin/env python3
"""Independent statistics oracle for Mood (SPEC "Formulas" 1-14; acceptance A3; WORKFLOW L27).

Implements the SPEC text only — it was written before src/engine/stats existed and never imports or mirrors it.
Exact arithmetic: every mean, variance and Welch t^2 is a Fraction; floats appear only in the JSON output.
Time zones: zoneinfo (system tz database). Local -> UTC rule (SPEC Edge cases, DST): a wall time that does not exist
(spring forward) maps to the first valid minute after it; a repeated wall time (fall back) maps to its first occurrence.

Usage: python3 -I stats_oracle.py <journals.json> <expected.json>
"""
import calendar
import datetime as dt
import json
import math
import sys
from fractions import Fraction
from zoneinfo import ZoneInfo

ONE_DAY = dt.timedelta(days=1)


def d(s):
    return dt.date.fromisoformat(s)


def f(x):
    return None if x is None else float(x)


def mean(values):
    return Fraction(sum(values), len(values)) if values else None


def sample_var(values):
    m = mean(values)
    return sum((v - m) ** 2 for v in values) / (len(values) - 1)


def week_start_of(day, week_start):
    return day - dt.timedelta(days=(day.isoweekday() - week_start) % 7)


def month_end(day):
    nxt = dt.date(day.year + (day.month == 12), day.month % 12 + 1, 1)
    return nxt - ONE_DAY


def compare(with_vals, without_vals):
    """Formula 8 for one mode: means, n, delta, Welch t and the plain-word label."""
    n1, n2 = len(with_vals), len(without_vals)
    m1, m2 = mean(with_vals), mean(without_vals)
    out = {"with_mean": f(m1), "with_n": n1, "without_mean": f(m2), "without_n": n2,
           "delta": f(m1 - m2) if n1 and n2 else None, "t": None}
    if min(n1, n2) < 3:
        out["label"] = "not_enough"
        return out
    if min(n1, n2) < 10:
        out["label"] = "few"
        return out
    delta = m1 - m2
    v1, v2 = sample_var(with_vals), sample_var(without_vals)
    if v1 == 0 and v2 == 0:
        if delta == 0:
            t2, t = Fraction(0), 0.0
        else:
            t2, t = None, ("inf" if delta > 0 else "-inf")
    else:
        t2 = delta * delta / (v1 / n1 + v2 / n2)
        t = math.copysign(math.sqrt(float(t2)), float(delta)) if delta != 0 else 0.0
    out["t"] = t
    if t2 is None or t2 >= 9:  # |t| >= 3 (SPEC F8 as amended 2026-10-16, D52)
        out["label"] = "clear"
    elif t2 >= 1:
        out["label"] = "small"
    else:
        out["label"] = "none"
    return out


def local_to_utc_ms(date_str, time_str, zone):
    z = ZoneInfo(zone)
    day = d(date_str)
    hh, mm = (int(x) for x in time_str.split(":"))
    wall = dt.datetime(day.year, day.month, day.day, hh, mm)
    for _ in range(24 * 60):
        valid = []
        for fold in (0, 1):
            u = wall.replace(tzinfo=z, fold=fold).timestamp()
            back = dt.datetime.fromtimestamp(u, z).replace(tzinfo=None)
            if back == wall:
                valid.append(u)
        if valid:
            return int(round(min(valid) * 1000))
        wall += dt.timedelta(minutes=1)  # inside a gap: the first valid minute after it
    raise ValueError("no valid local time")


def journal_day(case):
    z = ZoneInfo(case["zone"])
    wall = dt.datetime.fromtimestamp(case["utc_ms"] / 1000, z)
    day = wall.date()
    if wall.hour < case["day_end_hour"]:
        day -= ONE_DAY
    return [day.isoformat(), "%02d:%02d" % (wall.hour, wall.minute)]


def edit_utc(case):
    hour = int(case["time"].split(":")[0])
    day = d(case["date"])
    if hour < case["day_end_hour"]:
        day += ONE_DAY
    return local_to_utc_ms(day.isoformat(), case["time"], case["zone"])


def run(j):
    level_of = {m["id"]: m["level"] for m in j["moods"]}
    p_start, p_end = d(j["period"]["start"]), d(j["period"]["end"])
    today = d(j["today"])
    week_start = j["week_start"]
    act_ids = [a["id"] for a in j["activities"]]
    archived_act = {a["id"] for a in j["activities"] if a["archived"]}
    all_entries = j["entries"]
    in_p = [e for e in all_entries if p_start <= d(e["date"]) <= p_end]

    # 1. day values
    by_day = {}
    for e in in_p:
        by_day.setdefault(e["date"], []).append(level_of[e["mood_id"]])
    v = {day: mean(levels) for day, levels in by_day.items()}
    acts_on_day = {}
    for e in in_p:
        acts_on_day.setdefault(e["date"], set()).update(e["activities"])

    # 2. average (day-weighted), display with one decimal, round half up
    avg = mean(list(v.values()))
    display = None
    if avg is not None:
        q = math.floor(avg * 10 + Fraction(1, 2))
        display = "%d.%d" % (q // 10, q % 10)
    average = {"value": f(avg), "display": display, "days": len(v), "entries": len(in_p)}

    # 3. counts (entry-weighted)
    by_mood, by_level = {}, {str(level): 0 for level in range(1, 6)}
    for e in in_p:
        by_mood[str(e["mood_id"])] = by_mood.get(str(e["mood_id"]), 0) + 1
        by_level[str(level_of[e["mood_id"]])] += 1

    # 4. chart series
    length = (p_end - p_start).days + 1
    mode = "day" if length <= 92 else ("week" if length <= 731 else "month")
    buckets = {}
    for day, value in v.items():
        day_d = d(day)
        key = day if mode == "day" else (week_start_of(day_d, week_start).isoformat() if mode == "week" else day[:7])
        buckets.setdefault(key, []).append(value)
    series = {"mode": mode, "points": [[k, f(mean(vals)), len(vals)] for k, vals in sorted(buckets.items())]}

    # 5. weekday (ISO 1 = Monday ... 7 = Sunday)
    wd = {str(i): [] for i in range(1, 8)}
    for day, value in v.items():
        wd[str(d(day).isoweekday())].append(value)
    weekday = {k: [f(mean(vals)), len(vals)] for k, vals in wd.items()}

    # 6. monthly / yearly
    months, years = {}, {}
    for day, value in v.items():
        months.setdefault(day[:7], []).append(value)
        years.setdefault(day[:4], []).append(value)
    monthly = {k: [f(mean(vals)), len(vals)] for k, vals in months.items()}
    yearly = {k: [f(mean(vals)), len(vals)] for k, vals in years.items()}

    # 7. pixel colour level
    pixels = {day: math.floor(value + Fraction(1, 2)) for day, value in v.items()}

    # 8. comparisons
    comparisons = {}
    for a in act_ids:
        ent_with = [level_of[e["mood_id"]] for e in in_p if a in e["activities"]]
        ent_without = [level_of[e["mood_id"]] for e in in_p if a not in e["activities"]]
        day_with = [value for day, value in v.items() if a in acts_on_day[day]]
        day_without = [value for day, value in v.items() if a not in acts_on_day[day]]
        nd_with, nd_without = [], []
        for day in v:
            nxt = (d(day) + ONE_DAY).isoformat()
            if nxt in v:  # both logged; both in P because v only holds days in P
                (nd_with if a in acts_on_day[day] else nd_without).append(v[nxt])
        comparisons[str(a)] = {"entries": compare(ent_with, ent_without),
                               "same_day": compare(day_with, day_without),
                               "next_day": compare(nd_with, nd_without)}

    # 9. often together
    count_a = {a: 0 for a in act_ids}
    pair = {}
    for e in in_p:
        acts = sorted(set(e["activities"]))
        for a in acts:
            count_a[a] += 1
        for i, a in enumerate(acts):
            for b in acts[i + 1:]:
                pair[(a, b)] = pair.get((a, b), 0) + 1
    together = {}
    for a in act_ids:
        rows = []
        for b in act_ids:
            if b == a:
                continue
            c = pair.get((min(a, b), max(a, b)), 0)
            if c > 0:
                rows.append([b, c, f(Fraction(c, count_a[a]))])
        rows.sort(key=lambda r: (-r[1], r[0]))
        together[str(a)] = rows
    top = sorted(([a, b, c] for (a, b), c in pair.items() if c >= 3), key=lambda r: (-r[2], r[0], r[1]))[:10]

    # 10. related activities per level
    related = {}
    for level in range(1, 6):
        at_level = [e for e in in_p if level_of[e["mood_id"]] == level]
        rows = []
        for a in act_ids:
            c = sum(1 for e in at_level if a in e["activities"])
            if c > 0:
                rows.append([a, c, f(Fraction(c, len(at_level)))])
        rows.sort(key=lambda r: (-r[1], r[0]))
        related[str(level)] = rows[:10]

    # 11. frequency vs the previous period: equal length right before; for calendar month / year chips the previous
    # calendar month / year (same days of it when the period runs to date; a month's last day maps to the last day).
    kind = j["period"].get("kind", "days")
    if kind in ("month", "year"):
        back = 1 if kind == "month" else 12

        def shift(day, sticky):
            y, m0 = divmod(day.year * 12 + day.month - 1 - back, 12)
            last = calendar.monthrange(y, m0 + 1)[1]
            if sticky and day.day == calendar.monthrange(day.year, day.month)[1]:
                return dt.date(y, m0 + 1, last)
            return dt.date(y, m0 + 1, min(day.day, last))

        prev_start, prev_end = shift(p_start, False), shift(p_end, True)
    else:
        prev_start, prev_end = p_start - dt.timedelta(days=length), p_start - ONE_DAY
    frequency = {}
    for a in act_ids:
        cur = sum(1 for e in in_p if a in e["activities"])
        prev = sum(1 for e in all_entries if prev_start <= d(e["date"]) <= prev_end and a in e["activities"])
        frequency[str(a)] = [cur, prev, cur - prev]

    # 12. streak (whole history)
    logged = {d(e["date"]) for e in all_entries}

    def run_ending(day):
        n = 0
        while day in logged:
            n += 1
            day -= ONE_DAY
        return n

    if today in logged:
        current = run_ending(today)
    elif today - ONE_DAY in logged:
        current = run_ending(today - ONE_DAY)
    else:
        current = 0
    longest = max((run_ending(day) for day in logged if day + ONE_DAY not in logged), default=0)

    # 13. goals (whole history)
    goals = {}
    for g in j["goals"]:
        if g["activity_id"] in archived_act:
            goals[str(g["id"])] = {"paused": True, "instances": [], "streak": 0, "success_rate": None}
            continue
        k = 1 if g["period"] == "day" else g["target"]
        days_with = {d(e["date"]) for e in all_entries if g["activity_id"] in e["activities"]}

        def instance(day):
            if g["period"] == "day":
                return day, day
            if g["period"] == "week":
                s = week_start_of(day, week_start)
                return s, s + dt.timedelta(days=6)
            s = day.replace(day=1)
            return s, month_end(s)

        instances = []
        s = d(g["start_date"])
        if s <= today:
            start, end = instance(s)
            last_start, _ = instance(today)
            while start <= last_start:
                c = sum(1 for x in days_with if start <= x <= end)
                instances.append([start.isoformat(), end.isoformat(), c, c >= k, end < today])
                start, end = instance(end + ONE_DAY)
        complete = [i for i in instances if i[4]]
        streak = 0
        for i in reversed(complete):
            if not i[3]:
                break
            streak += 1
        if instances and not instances[-1][4] and instances[-1][3]:
            streak += 1
        rate = f(Fraction(sum(1 for i in complete if i[3]), len(complete))) if complete else None
        goals[str(g["id"])] = {"paused": False, "instances": instances, "streak": streak, "success_rate": rate}

    return {
        "id": j["id"],
        "day_values": {k: f(x) for k, x in v.items()},
        "average": average,
        "counts": {"by_mood": by_mood, "by_level": by_level},
        "series": series,
        "weekday": weekday,
        "monthly": monthly,
        "yearly": yearly,
        "pixels": pixels,
        "comparisons": comparisons,
        "together": together,
        "top_pairs": top,
        "related": related,
        "frequency": frequency,
        "streak": [current, longest],
        "goals": goals,
        "journal_day": [journal_day(c) for c in j["journal_day_cases"]],
        "edit_utc": [edit_utc(c) for c in j["edit_cases"]],
    }


def main():
    with open(sys.argv[1], encoding="utf-8") as fh:
        journals = json.load(fh)
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump([run(j) for j in journals], fh)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fill the app's SQLite file with the fictional store-screenshot journal (invented, no real person, no health topics).

Usage: store-demo.py <path-to-app.db> <en|de>
The app must be stopped and must have started once (schema + user_version exist). Production builds have no seed route, so
the rows are written straight into the file of the screenshot simulator; moods, groups and activities use the same order,
ids and names as src/db/seed.ts (names from src/i18n/<lang>.ts), so the Maestro flows can name them (sport 10, walk 11 ...).
About six weeks of entries end today (local calendar date), two quiet days in between, every figure deterministic.
"""
import os
import random
import re
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta

db_path, lang = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
text = open(os.path.join(root, "src/i18n", lang + ".ts"), encoding="utf-8").read()
names = dict(re.findall(r"'(default\.[A-Za-z0-9.]+)':\s*'((?:[^'\\]|\\.)*)'", text))
names = {k: v.replace("\\'", "'") for k, v in names.items()}

MOODS = [(5, "😄", "#2E9E5B"), (4, "🙂", "#8BC34A"), (3, "😐", "#F2C14E"), (2, "🙁", "#F08A4B"), (1, "😫", "#D64545")]
GROUPS = [
    ("feelings", [("calm", "😌"), ("happy", "😊"), ("grateful", "🙏"), ("tired", "🥱"), ("anxious", "😟"), ("stressed", "😣"), ("sad", "😢"), ("angry", "😠")]),
    ("activities", [("work", "💼"), ("sport", "🏃"), ("walk", "🚶"), ("reading", "📖"), ("gaming", "🎮"), ("cooking", "🍳"), ("cleaning", "🧹"), ("shopping", "🛒")]),
    ("people", [("family", "👪"), ("friends", "🧑‍🤝‍🧑"), ("partner", "❤️"), ("alone", "🧘")]),
    ("sleep", [("goodSleep", "😴"), ("badSleep", "🥴"), ("sleptEarly", "🛏️")]),
    ("health", [("ateWell", "🥗"), ("sweets", "🍬"), ("alcohol", "🍷"), ("sick", "🤒")]),
]
ACT_ID = {}
n = 0
for _, acts in GROUPS:
    for key, _e in acts:
        n += 1
        ACT_ID[key] = n

# (title, note) per language and mood tier (high = Good/Great, mid = Okay, low = Bad/Awful); ~1 entry in 3 has a note
NOTES = {
    "en": {
        "high": [("", "Long walk by the river before work."), ("Good day", "Finished the shelf I started last weekend."),
                 ("", "Cooked for friends, too much pasta again."), ("Slow morning", "Coffee, a few pages of my book, no hurry."),
                 ("", "Lunch with my sister, we laughed a lot."), ("Small win", "Finally answered all the emails."),
                 ("", "Run in the park, legs heavy but it felt good.")],
        "mid": [("", "Busy at work, but the evening was calm."), ("Rainy Sunday", "Stayed in, tidied up and listened to old records."),
                ("", "An ordinary day, nothing special.")],
        "low": [("Late start", "Slept badly, a long day. Early night tonight."), ("", "Too many meetings, felt drained by the afternoon."),
                ("", "Grey weather and a long to-do list.")],
    },
    "de": {
        "high": [("", "Langer Spaziergang am Fluss vor der Arbeit."), ("Guter Tag", "Das Regal fertig gebaut, das ich letztes Wochenende angefangen habe."),
                 ("", "Für Freunde gekocht, wieder zu viel Pasta."), ("Ruhiger Morgen", "Kaffee, ein paar Seiten im Buch, keine Eile."),
                 ("", "Mittagessen mit meiner Schwester, wir haben viel gelacht."), ("Kleiner Erfolg", "Endlich alle Mails beantwortet."),
                 ("", "Laufrunde im Park, schwere Beine, tat aber gut.")],
        "mid": [("", "Viel los im Büro, aber der Abend war ruhig."), ("Regnerischer Sonntag", "Zu Hause geblieben, aufgeräumt und alte Platten gehört."),
                ("", "Ein ganz normaler Tag, nichts Besonderes.")],
        "low": [("Später Start", "Schlecht geschlafen, ein langer Tag. Heute früh ins Bett."), ("", "Zu viele Besprechungen, nachmittags erschöpft."),
                ("", "Graues Wetter und eine lange Liste.")],
    },
}[lang]
TODAY_NOTES = {"en": [("", "Long walk by the river before work."), ("Small win", "Finally answered all the emails.")],
               "de": [("", "Langer Spaziergang am Fluss vor der Arbeit."), ("Kleiner Erfolg", "Endlich alle Mails beantwortet.")]}[lang]
note_i = {"high": 0, "mid": 0, "low": 0}

rng = random.Random(20261106)
today = date.today()
tm = time.localtime()
now_ms = int(time.time() * 1000)
START_DAYS = 42
SKIP = {13, 12}  # two quiet days, so the streak is real and the calendar has a gap


def offset_min(d):
    return int(datetime(d.year, d.month, d.day, 12).astimezone().utcoffset().total_seconds() // 60)


con = sqlite3.connect(db_path)
cur = con.cursor()
for t in ["entry_activities", "photos", "entries", "goals", "activities", "activity_groups", "moods", "reminders", "import_runs"]:
    cur.execute(f"DELETE FROM {t}")
cur.execute("DELETE FROM sqlite_sequence")
for i, (level, emoji, color) in enumerate(MOODS):
    cur.execute("INSERT INTO moods (level, name, emoji, color, sort, created_ms) VALUES (?,?,?,?,?,?)",
                (level, names[f"default.mood.{level}"], emoji, color, i, now_ms))
for g, (gkey, acts) in enumerate(GROUPS):
    cur.execute("INSERT INTO activity_groups (name, sort, created_ms) VALUES (?,?,?)", (names[f"default.group.{gkey}"], g, now_ms))
    gid = cur.lastrowid
    for a, (akey, emoji) in enumerate(acts):
        cur.execute("INSERT INTO activities (group_id, name, emoji, sort, created_ms) VALUES (?,?,?,?,?)",
                    (gid, names[f"default.activity.{akey}"], emoji, a, now_ms))
mood_id = {level: i + 1 for i, (level, _, _) in enumerate(MOODS)}

rows = 0
for back in range(START_DAYS, -1, -1):
    if back in SKIP:
        continue
    d = today - timedelta(days=back)
    wd = d.weekday()
    count = 2 if back == 0 else rng.choice([1, 1, 2])
    for k in range(count):
        picks = set()
        # morning entry leans on sleep/work, later one on evening things
        picks.add("goodSleep" if rng.random() < 0.6 else "badSleep")
        if wd < 5:
            picks.add("work")
        if rng.random() < 0.42 or (back in (2, 4) and k == 0):
            picks.add("sport")
        if rng.random() < 0.5:
            picks.add("walk")
        if rng.random() < 0.45:
            picks.add("friends" if wd >= 4 else "family")
        if rng.random() < 0.3:
            picks.add("reading")
        if rng.random() < 0.25:
            picks.add("cooking")
        picks.add(rng.choice(["calm", "happy", "grateful", "tired", "stressed", "calm", "happy"]))
        if back == 0:
            picks = {"goodSleep", "walk", "calm"} if k == 0 else {"work", "happy", "reading"}
        score = 3.3
        score += 1.3 * ("sport" in picks) + 0.4 * ("walk" in picks) + 0.5 * ("friends" in picks)
        score += 0.4 * ("goodSleep" in picks) - 0.9 * ("badSleep" in picks) - 0.8 * ("stressed" in picks) - 0.5 * ("tired" in picks)
        score += 0.4 * ("happy" in picks or "grateful" in picks) + (0.3 if wd >= 5 else 0) + rng.uniform(-0.5, 0.5)
        level = max(1, min(5, round(score)))
        if back == 0:
            level = 4 if k == 0 else 5
        hour, minute = (7, 45) if back == 0 and k == 0 else (9, 20) if back == 0 else ((8 + rng.randint(0, 2), rng.choice([5, 15, 30, 40, 50])) if k == 0 else (19 + rng.randint(0, 2), rng.choice([0, 10, 25, 45])))
        title, note = "", ""
        if back == 0:
            title, note = TODAY_NOTES[k]
        elif rng.random() < 0.34:
            tier = "high" if level >= 4 else "mid" if level == 3 else "low"
            title, note = NOTES[tier][note_i[tier] % len(NOTES[tier])]
            note_i[tier] += 1
        off = offset_min(d)
        local = datetime(d.year, d.month, d.day, hour, minute)
        utc_ms = int((local - timedelta(minutes=off) - datetime(1970, 1, 1)).total_seconds() * 1000)
        cur.execute(
            "INSERT INTO entries (mood_id, local_date, local_time, utc_ms, tz_offset_min, note_title, note, created_ms, updated_ms, source) VALUES (?,?,?,?,?,?,?,?,?,'app')",
            (mood_id[level], d.isoformat(), f"{hour:02d}:{minute:02d}", utc_ms, off, title, note, utc_ms, utc_ms))
        eid = cur.lastrowid
        for key in sorted(picks):
            cur.execute("INSERT INTO entry_activities (entry_id, activity_id) VALUES (?,?)", (eid, ACT_ID[key]))
        rows += 1

# Goal "sport 3 times a week" shows on Home; the reminder card is marked done so Home stays quiet
cur.execute("INSERT INTO goals (activity_id, period, target, start_date, created_ms) VALUES (?,?,?,?,?)",
            (ACT_ID["sport"], "week", 3, (today - timedelta(days=START_DAYS)).isoformat(), now_ms))
cur.execute("INSERT INTO settings (key, value) VALUES ('reminder_card_done','1') ON CONFLICT(key) DO UPDATE SET value='1'")
con.commit()
print(f"{lang}: {rows} entries, {len(ACT_ID)} activities, ends {today.isoformat()}")

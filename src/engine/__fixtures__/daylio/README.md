# Daylio TUNING fixtures (hand-made, D24)

Written by the P3 builder from RESEARCH §3 to develop the importers. They are **tuning** fixtures: never quote
results on them as accuracy evidence. The evidence is the blind set written by a separate agent (V1_PLAN P4,
WORKFLOW L27 rules 5–7), measured once against the committed engine snapshot.

- `current-12h.csv` — 8-column header, BOM, 12 h times (12:00 am / 12:30 pm / 11:59 PM), trailing space in a mood
  name, quoted commas, quotes and a line break, unicode + emoji, custom mood "average".
- `legacy-24h.csv` — 7-column header, "23-Jan" and "January 23" dates, 24 h, an impossible date (29 Feb 2019).
- `localized-header.csv` — UNCONFIRMED path: German column names, read by position with a warning.
- `malformed.csv` — bad time, bad date, missing mood, missing columns; one good row.
- `html-note.csv` — HTML in a note (converted) and a plain note with "<" characters (kept as is).
- Backups are built at test time from `backup-v15.json` (+ photo bytes) by `build-backup.ts`, so the JSON stays readable.

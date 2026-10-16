# Daylio formats as used by this blind fixture set

Written from RESEARCH.md section 3, SPEC "Daylio import", the report contract in `import-report.ts`, and primary
web sources (listed at the end). **S** = stated by a source. **A** = my assumption (UNCONFIRMED).

## 1. CSV export ("Export Entries" -> "CSV (table)")

| Fact | Status |
|---|---|
| Header `full_date,date,weekday,time,mood,activities,note_title,note` (8 columns) | S: MichaelCurrin sample.csv and csv-format.md, writeaday_to_diarium, daylio-csv-to-org, daylio-backup |
| 9-column header `full_date,date,weekday,time,mood,activities,scales,note_title,note`, cells like `"Stress: Moderato 3/5"` | S: one 2026 Italian export (daylio-api-server `sample-data/daylio_export_2026_09_22.csv`). The fixtures expect the `scales` column to be ignored (A) |
| Old header `year,date,weekday,time,mood,activities,note` (7 columns, no title), date like `23-Jan` or `January 23` | S: Journey help, via RESEARCH (I could not open the page myself: TLS error) |
| Header stays English in a non-English app; only `date`/`weekday` are translated (`21 settembre`, `lunedì`) | S for Italian (2026 sample). A for German and French |
| Translated German header row | A: invented, no source. Only one fixture uses it; refusing it is an accepted alternative |
| `full_date` is ISO `YYYY-MM-DD` | S (all samples, including Italian) |
| `date` cell forms: `28 September`, `August 12`, `8. Jan`, `21 settembre`; German `28. September` and French `28 septembre` | S except DE/FR (A). The importer should rely on `full_date` |
| Time: 12 h `10:00 pm` (lower case), 24 h `13:52`, `21:10` | S. Zero-padded 12 h hours (`09:05 am`), unpadded (`9:05 pm`) and upper case `PM` are A |
| Newest entry first | S (sample.csv, Italian sample, daylio-backup) |
| Activities joined with ` | ` (space, pipe, space), zero or more, built-in and custom names mixed | S |
| `mood` = the user's mood name, may have a trailing space (`sad `), multi-word names unquoted (`alla grande`) | S |
| Quoting: activities, scales, note_title and note are always quoted, even when empty (`"",""`); the first five cells only when needed; `"` doubled | S (sample.csv, Italian sample, writeaday sample). The minimal-quoting style (`,,`) is from the daylio-csv-to-org README |
| Line breaks in notes are written as `<br>` | S (writeaday sample: `Great note<br><br>such ""good"" note`). Raw LF inside quotes is A (SPEC requires support) |
| HTML entities in CSV notes (`&amp;`) | A: assumed NOT used. A literal `&` stays `&` |
| UTF-8 BOM at the start | S (Italian sample begins with U+FEFF). Files without BOM also exist (other samples) |
| Line endings | A: LF by default. One CRLF fixture |
| No mood level, no time-zone offset, no photos in the CSV | S |
| Default English names rad / good / meh / bad / awful | S |
| Italian defaults alla grande / bene / così così / male / malissimo | S (daylio-api-server README) |
| French defaults super / bien / mouais / mauvais / horrible | S (DaylioBackupTools `daylio_predefined_mood_name`) |
| German defaults super / gut / ok / schlecht / lausig, lower case in the CSV | names S (German reviews: "Super ... Lausig"), case A |

## 2. Backup file (`.daylio`, Advanced Options -> Export)

| Fact | Status |
|---|---|
| ZIP archive; root member `backup.daylio` = base64 (standard alphabet, padded) of UTF-8 JSON | S: Joel Otter blog, dayligo `file.go` (`base64.StdEncoding`), Mathis Gauthey, mbafford, daylio-backup, theluckystrike |
| base64 may contain line breaks (Android `Base64.DEFAULT` wraps at 76) | A. theluckystrike strips whitespace before decoding, which suggests it happens |
| Photos as `assets/<checksum>.<ext>` | S: theluckystrike (via RESEARCH) |
| Photos as `assets/photos/<year>/<month, unpadded>/<checksum>` without extension | S: mbafford README. Whether the month folder is 1-based is A (1-based used). mbafford finds files by checksum suffix |
| `assets[]`: `id`, `checksum` (32 hex, not the md5 of the file), `type` (1 = photo), `createdAt`, `createdAtOffset`, `android_metadata` (JSON string, Android only) | S: mbafford |
| `version` 15 | S: mbafford sample, DaylioBackupTools default, theluckystrike. dayligo accepts only 18 (S) |
| `customMoods[]`: `id`, `custom_name`, `mood_group_id`, `mood_group_order`, `icon_id`, `predefined_name_id`, `state`, `createdAt` | S |
| `predefined_name_id` 1..5 = rad..awful, -1 = custom mood | S: mbafford, DaylioBackupTools |
| Predefined moods have id = predefined_name_id = mood_group_id (1..5) and empty `custom_name` | S: mbafford sample (`custom_name ""`), DaylioBackupTools default |
| `mood_group_id` 1 = best ... 5 = worst | S (daylio-backup README: "group 1 is the best mood and 5 the worst"); RESEARCH still marks it UNCONFIRMED |
| A custom mood can sit in another group with a "wrong-looking" name (`meh+` in group 2) | S: mbafford sample |
| `tags[]`: `id`, `name`, `icon`, `order`, `state`, `id_tag_group`, `createdAt`; `tag_groups[]`: `id`, `name`, `is_expanded`, `order` | S |
| `state` 0 = active; 1 = archived | 0 S (all samples), meaning of non-zero A |
| `dayEntries[]`: `id`, `datetime` (UTC ms), `timeZoneOffset` (ms, e.g. -18000000), `year`, `month`, `day`, `hour`, `minute`, `mood` (customMoods id), `note`, `note_title`, `tags[]`, `assets[]`; sometimes `isFavorite` | S |
| `month` is 0-based (January = 0) | S: mbafford sample (datetime 1700408759432, offset -5 h = 19 Nov 2023, `month` 10); Mathis Gauthey (`month-1`); daylio-backup README |
| Local time = `datetime + timeZoneOffset`; seconds are present in `datetime` and the minute is truncated (sample: 10:45:59 -> minute 45) | S |
| `note` is HTML (`<br>`, `<b>`) | S: mbafford (html2text), daylio-backup (strips `<br>`/`<b>`) |
| `dayEntries` stored newest first | S (Joel Otter: ids newest first) |
| Other top-level keys: `isReminderOn`, `achievements`, `daysInRowLongestChain`, `goals`, `goalEntries`, `goalSuccessWeeks`, `prefs`, `metadata`, `moodIconsPackId`, `reminders`, `writingTemplates`, ... | S: DaylioBackupTools, mbafford |
| iOS backups: `metadata.platform = "ios"`, no `android_metadata` | A (mbafford: "not tested with iOS exports") |
| Old backups without `customMoods`/`tag_groups` | A (dayligo models only 6 keys, which proves nothing) |
| Encrypted backups | A: no source shows one; SPEC wants a clear refusal |

## 3. What the importer is expected to do (from SPEC; per-fixture assumptions are in each `_meta`)

- `level`: our app's 1..5 with **5 = best** (A: inferred from SPEC "mood-level-4" being a good mood). Backup: `6 - mood_group_id`.
  CSV: `options.mapping[name.trim().toLowerCase()]`, else the Daylio default English names pre-filled, else `null`.
- Activities: names exactly as written; compared as a set (order-insensitive). CSV activities go into the group
  "Imported from Daylio"; backup activities keep their Daylio group (tags without a group -> "Imported from Daylio").
- Notes: `<br>`, `<br/>`, `<br />`, `</p>` -> `\n`; other tags removed; entities decoded; trailing newlines left by a
  final `</p>` removed (A). Titles are taken as written. Applies to CSV notes too (SPEC).
- Dates: CSV as written (no offset, DST-gap times like 02:30 stay 02:30); backup from `datetime + timeZoneOffset`,
  truncated to the minute; split fields only cross-checked (warning). Range 1900-01-01 .. today + 1 with
  `today = 2026-10-16` (option in each expected.json); rows outside are skipped.
- Photos: per entry, assets of type 1 whose file is in the ZIP, at most 3.
- Malformed CSV rows (wrong column count, impossible date or time) are skipped and listed; the rest imports.
- Whole-file refusal: not a Daylio file, unreadable encoding, damaged archive/payload, encrypted, ZIP64, unrecognised
  header, file cut inside a quoted cell. A refusal must import **nothing**.

## 4. expected.json shapes

Import:
```
{ "fixture", "kind": "daylio_csv" | "daylio_backup", "header"?: "current8" | "current9_scales" | "legacy7" | "de8_translated",
  "version"?: 15, "options": { "today": "2026-10-16", "mapping": { "<lower-case name>": level } },
  "entries": [ { "date", "time", "mood", "level", "activities", "title", "note", "photos",
                 backup only: "daylio_id", "utc_ms", "tz_offset_min" } ],          // sorted by date, time
  "skipped": [ CSV { "line", "row", "reason" } | backup { "daylio_id", "reason" } ],  // line = physical line, header = 1
  "warnings": [ informational classes, not the engine's codes ],
  "moods": [ ... ], "activities": [ { "name", "group", ... } ], "groups"?: [ ... ],
  "counts": { "entries", "skipped", "moods", "activities", "photos" },
  "_meta": { "confidence": "sourced" | "mixed" | "assumed", "assumptions": [ ... ], "also_acceptable"?: "..." } }
```
Refusal: `{ "refused": "<class>", "_meta": { ... } }`. Classes: `empty`, `not_daylio`, `unrecognized_header`,
`encoding`, `damaged_csv`, `damaged_archive`, `bad_payload`, `bad_shape`, `encrypted`, `zip64`, `date_format`.
They are descriptive; the engine's own error codes need not match. `also_acceptable` names an alternative
outcome that is not counted as a miss (for example `refused:unrecognized_header`, `ok_with_all_rows_skipped`).

Entry fields map 1:1 onto `ReportEntry` in import-report.ts; the `entries` list is the part to measure (A5).
`moods`, `activities`, `skipped` reasons and `warnings` describe what a full import should do but are not in the
report contract word-for-word.

## Sources
- MichaelCurrin/daylio-csv-parser: docs/csv-format.md, dayliopy/sample.csv
- giuse-boccia/writeaday_to_diarium README (Daylio CSV sample with `<br>` and `""`)
- mpereira/daylio-csv-to-org README (sample rows, `8. Jan`)
- tanadelgigante/daylio-api-server README and sample-data/daylio_export_2026_09_22.csv (9 columns, BOM, Italian)
- jaysri-eng/daylio-backup README (zip + base64 JSON, 0-based month, group 1 best)
- mbafford/daylio-markdown-export README and __main__.py (asset layout, sample values, html2text, offset handling)
- JoelOtter/dayligo structure.go, file.go; joelotter.com/posts/2022/01/daylio/
- Guekka/DaylioBackupTools backend/src/formats/daylio.rs
- theluckystrike/daylio-backup-import src/backup.ts (version 15 only, root member, fatal UTF-8, ZIP64/encryption rejected)
- mathisgauthey.github.io "How I reverse engineered Daylio backup ..." (month-1, ms timestamps, isFavorite)
- daylio.net FAQ "Backup File: Manual Import and Export" (contents, cross-platform)
- German reviews naming the moods Super ... Lausig (researchgate abstract, bastiansmotivationswerkstatt.de)

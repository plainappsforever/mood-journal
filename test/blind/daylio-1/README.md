# Blind Daylio import fixture set (58 files)

Written blind: I did not read the importer's source or its fixtures. I used RESEARCH section 3, SPEC "Daylio import",
the report contract in import-report.ts and web sources (see FORMAT.md). The generator lives outside this folder.
Each `<file>.expected.json` holds the full expected result, or `{"refused": "<class>"}`.
`_meta.confidence` says how far each one rests on sources: **sourced** = format facts from sources, **mixed** =
sourced format plus an assumed detail, **assumed** = UNCONFIRMED (no source shows Daylio writing this; it is a
robustness or SPEC-behaviour test). Every assumption is listed in `_meta.assumptions` and in FORMAT.md.

## Use
- `python3 -I check.py` re-reads every fixture with a small independent reader and checks that each expected.json
  matches its source file (expect `0 mismatches`).
- To measure the engine, write one `ImportReport` per fixture with `importReport(name, bytes, {today: options.today,
  mapping: options.mapping})` (both values are in the expected.json) to `<dir>/<fixture>.report.json`, then
  `python3 -I check.py --compare <dir>`. It prints per-fixture hits and misses with the fields that differ, then:
  A5 = expected entries reproduced exactly (date, time, mood trimmed, level, activities as a set, title, note,
  photos); the same without the two large fixtures (about 6,700 of the ~7,250 entries are theirs); fully exact
  fixtures; and correct refusals. A refusal that still imports entries is flagged as a HALF IMPORT.
- Order of entries never matters. Warning and skip reason names are mine, not the engine's codes, so they are only
  informational; the number of skipped rows is printed next to the expected number.

## Fixtures (file: what makes it hard. Provenance)
- `csv-en-basic.csv` (45 entries; sourced): 8-col EN, 12 h "10:00 pm", newest first, 1-3 entries/day, empty days, default names pre-filled, custom "sad " with trailing space and no mapping (level null). Provenance: header/12h/trailing space/" | " sourced (sample.csv); zero-padded 12 h hour assumed.
- `csv-en-notes-escaping.csv` (18 entries; sourced): notes/titles with commas, doubled quotes, <br>, emoji ZWJ sequences, semicolons, formula-like starts (= + - @), RTL/CJK, tab, 3 KB note, title-only entry. Provenance: "" escaping and <br> in notes sourced (writeaday_to_diarium sample); the rest assumed.
- `csv-en-raw-newlines.csv` (6 entries; assumed): raw newlines inside quoted notes, including a note line that looks like a CSV row and one that repeats the header. Provenance: quoted multi-line cells: spec/Journey forum; Daylio writing raw newlines UNCONFIRMED.
- `csv-en-crlf.csv` (20 entries; assumed): CRLF row endings with an embedded LF in a quoted note; 12 h times. Provenance: line ending of real exports UNCONFIRMED (CRLF is what Windows tools write).
- `csv-en-bom.csv` (23 entries; sourced): UTF-8 BOM before "full_date" (first header must still match); year boundary 2020/2021. Provenance: BOM seen in the 2026 Italian export sample (daylio-api-server).
- `csv-de-english-headers.csv` (50 entries; mixed): German install: English header, German weekday/month names, umlauts/ß in activities, German quotes „…“, mapping for German default names. Provenance: English header + localized date/weekday sourced from the IT sample; German strings assumed.
- `csv-de-translated-headers.csv` (10 entries; assumed; also OK: refused:unrecognized_header): translated (invented) German header row; leap day 2024-02-29; must be recognised by shape, or refused cleanly. Provenance: entirely UNCONFIRMED: no source shows translated headers.
- `csv-it-scales.csv` (18 entries; mixed): 9-column 2026 header with "scales" column, BOM, Italian dates/weekdays with accents (lunedì), multi-word mood names unquoted. Provenance: shape copied from the real-looking 2026 Italian export (daylio-api-server sample-data); expected handling of scales assumed.
- `csv-fr-no-final-newline.csv` (19 entries; mixed): French names (super/bien/mouais/mauvais/horrible, from DaylioBackupTools), « » quotes, file ends without newline. Provenance: French default mood names sourced (DaylioBackupTools daylio.rs); date cell assumed.
- `csv-en-minimal-quoting.csv` (5 entries; sourced): cells only quoted when needed, empty cells as nothing (",,"), "8. Jan" date cell, custom names great/okay. Provenance: rows modelled on the daylio-csv-to-org README sample.
- `csv-legacy7-dmon-12h.csv` (27 entries; mixed): old 7-column header (year,date,...,note; no title), "23-Jan" dates across a year boundary, unpadded 12 h times. Provenance: header and "23-Jan" from Journey help (via RESEARCH); time format assumed.
- `csv-legacy7-monthday-24h.csv` (11 entries; mixed): old 7-column header with "January 23" dates, 24 h, leap day 2016-02-29 if present. Provenance: header and "January 23" from Journey help (via RESEARCH).
- `csv-custom-moods.csv` (42 entries; mixed): 12 custom mood names incl. emoji, comma inside a mood name (quoted cell), "meh+" mapped to 4, non-ASCII capital (Ärgerlich -> key ärgerlich). Provenance: custom names replace defaults (daylio-backup README); "meh+" seen in mbafford sample; comma-in-name assumed.
- `csv-many-activities.csv` (29 entries; mixed): 59 distinct activities, one entry with 45, entries with 0; names with comma, &, <, >, +, /, emoji, apostrophe. Provenance: " | " separator sourced; odd names assumed.
- `csv-dst-days.csv` (8 entries; sourced): entries at non-existent (spring-forward) and repeated (fall-back) local times in Berlin and New York; must not shift or drop. Provenance: no offset in CSV: sourced (RESEARCH 3.1).
- `csv-midnight-noon-12h.csv` (7 entries; sourced): 12 h edge times 12:00 am / 12:05 am / 12:00 pm / 12:30 pm across a year boundary. Provenance: 12 h "10:00 pm" style sourced; edge values follow from it.
- `csv-en-12h-uppercase.csv` (7 entries; assumed): same journal as csv-midnight-noon-12h with "12:05 AM" upper-case, unpadded hour. Provenance: UNCONFIRMED variant of the 12 h format.
- `csv-multi-year-large.csv` (3338 entries; sourced): ~3,300 entries 2019-03 .. 2026-10 (8 calendar years, leap day 2024-02-29, 1-3/day, ~15% empty days); same journal as backup-large.daylio. Provenance: format sourced; data synthetic.
- `csv-malformed-rows.csv` (3 entries; sourced): 4 malformed rows between good ones: 6 columns, 30 February, 25:61, 9 columns; skipped and listed, 3 good rows import. Provenance: skip-and-list behaviour from SPEC; malformed rows invented.
- `csv-future-and-ancient.csv` (3 entries; sourced): dates today+1 (ok), today+2 and 2031 (skipped), 1900-01-01 (ok), 1899-12-31 (skipped). Provenance: range rule from SPEC edge cases.
- `csv-duplicate-rows.csv` (3 entries; assumed): two identical rows (same minute, mood, activities, note) plus a near-duplicate differing by "!"; dedupe hash must merge only the identical pair. Provenance: dedupe key from SPEC; outcome for in-file duplicates assumed.
- `csv-header-only.csv` (0 entries; assumed; also OK: refused:empty): header line only, zero entries. Provenance: assumed.
- `csv-truncated-in-quote.csv` (refused: damaged_csv; sourced): cut off mid-way through a quoted note (unterminated quote); a lenient parser would swallow or half-import. Provenance: damage invented.
- `csv-truncated-mid-row.csv` (11 entries; assumed; also OK: refused:damaged_csv): last (oldest) row cut after 3 cells, no trailing newline; spec says skip that row and list it. Provenance: damage invented; behaviour from SPEC.
- `csv-de-windows1252.csv` (refused: encoding; sourced): German CSV re-encoded as Windows-1252 (ä = 0xE4); must be refused, not imported as mojibake. Provenance: damage invented.
- `csv-utf16le.csv` (refused: encoding; sourced): UTF-16LE with BOM (Excel "Unicode text" style), otherwise valid content. Provenance: damage invented.
- `csv-excel-de-semicolon.csv` (refused: unrecognized_header; sourced): Excel (German) re-save: semicolon separator, dd.mm.yyyy dates, CRLF, BOM; header is one ";"-joined cell. Provenance: damage invented from how German Excel saves CSV.
- `csv-excel-us-dates.csv` (refused: date_format; sourced; also OK: ok_with_all_rows_skipped): Excel (US) re-save: same header, but full_date "9/28/2021", time "10:00:00 PM", minimal quoting; nothing may import. Provenance: damage invented from how US Excel saves CSV.
- `csv-other-app.csv` (refused: unrecognized_header; sourced): a CSV with a different header (another app); must be refused. Provenance: invented.
- `empty.csv` (refused: empty; sourced): 0-byte file. Provenance: invented.
- `image-renamed.csv` (refused: not_daylio; sourced): a JPEG renamed to .csv (binary, not UTF-8). Provenance: invented.
- `backup-v15-basic.daylio` (39 entries; sourced): v15 Android backup: 5 predefined moods (empty custom_name) + custom "meh+" in group 2, 4 tag groups, goals present, 1-3 entries/day, 4 photos as assets/<checksum>.jpg, one entry copied from the mbafford sample (UTC-5). Provenance: zip+base64+JSON v15 field names sourced (dayligo, DaylioBackupTools, mbafford, theluckystrike); 0-based month sourced (mbafford sample, Mathis Gauthey, daylio-backup).
- `backup-v15-photos-tree.daylio` (22 entries; mixed): photos in assets/photos/Y/M/<checksum> (no extension), base64 wrapped at 76 columns; 4-photo entry (cap 3), missing file, type-2 asset, unknown asset id, half-missing pair. Provenance: layout from mbafford README; wrap and cap semantics assumed/SPEC.
- `backup-v18.daylio` (17 entries; mixed): version 18 (dayligo's supported version) with the v15 shape: must import with a version warning, not refuse. Provenance: version 18 sourced (dayligo file.go); behaviour from SPEC.
- `backup-dst-travel.daylio` (17 entries; sourced): DST days Berlin/New York (missing and repeated hours, two entries with the same local time), travel to +14/+13:45/+5:30/-2:30/-11 zones crossing midnight, 59.999 s truncation. Provenance: datetime+timeZoneOffset in ms sourced (mbafford code, Mathis Gauthey); zones synthetic.
- `backup-split-mismatch.daylio` (4 entries; assumed): split year/month/day/hour disagree with datetime+offset on 3 entries (1-based month, hour -1, next day); datetime must win, with a warning. Provenance: which field wins is the SPEC decision, not a Daylio fact.
- `backup-archived-deleted.daylio` (23 entries; assumed): mood and two tags with state=1 used by entries; entries referencing deleted tag ids 4242/4243; entries must import, unknown tags dropped. Provenance: state field sourced; its meaning and deleted-tag handling assumed.
- `backup-missing-mood.daylio` (2 entries; assumed): one entry references mood id 99 that is not in customMoods; skip-and-list that entry, import the others. Provenance: assumed.
- `backup-custom-moods.daylio` (33 entries; mixed): 12 moods: renamed predefined moods (trailing space), 7 custom moods with predefined_name_id -1 and non-contiguous ids, several per group (mood_group_order), emoji and comma in names. Provenance: predefined_name_id -1 = custom sourced (mbafford, DaylioBackupTools); group->level orientation sourced only by daylio-backup README.
- `backup-html-notes.daylio` (9 entries; mixed): notes with <br>, <br/>, <p>, <b>, <i>, &amp; &lt; &quot; &#39;, emoji ZWJ; JSON fully \u-escaped incl. surrogate pairs and Gson-style \u003c. Provenance: notes as HTML sourced (mbafford uses html2text; daylio-backup strips <br>/<b>); escaping style assumed.
- `backup-ios-stored.daylio` (24 entries; assumed): iOS-style: platform "ios", no android_metadata/android_version, isFavorite field, Los Angeles offsets, ZIP members stored not deflated. Provenance: iOS shape UNCONFIRMED (mbafford untested on iOS); isFavorite seen in Mathis Gauthey script and daylio-backup.
- `backup-old-minimal.daylio` (15 entries; assumed; also OK: refused:bad_shape): minimal old shape (only version/dayEntries/goals/goalEntries/goalSuccessWeeks/tags; no customMoods, no tag_groups, tags without id_tag_group). Provenance: key set from dayligo structure.go; whether old files really lack customMoods UNCONFIRMED.
- `backup-large.daylio` (3338 entries; sourced): ~3,300 entries over 8 calendar years (Europe/Berlin DST each year), 30 activities in 5 groups; same journal as csv-multi-year-large.csv. Provenance: format sourced; data synthetic.
- `backup-no-version.daylio` (4 entries; assumed; also OK: refused:unknown_version): no "version" key at all; otherwise v15. Provenance: assumed.
- `backup-empty-journal.daylio` (0 entries; assumed; also OK: refused:empty): valid v15 backup with moods and tags but zero dayEntries. Provenance: assumed.
- `backup-truncated.daylio` (refused: damaged_archive; sourced): backup-v15-basic cut at 60 % (no central directory). Provenance: damage invented.
- `backup-crc-mismatch.daylio` (refused: damaged_archive; sourced): one base64 character changed in a stored member: CRC-32 wrong, but base64, UTF-8 and JSON all still valid (a note changes). Provenance: damage invented.
- `backup-bad-base64.daylio` (refused: bad_payload; sourced): backup.daylio member contains non-base64 bytes (% ! * NUL). Provenance: damage invented.
- `backup-json-truncated.daylio` (refused: bad_payload; sourced): valid base64 of JSON cut at 70 % (unterminated JSON). Provenance: damage invented.
- `backup-no-dayentries.daylio` (refused: bad_shape; sourced): valid JSON object without dayEntries. Provenance: shape rule from daylio-backup ("bad-shape").
- `backup-not-object.daylio` (refused: bad_shape; sourced): payload decodes to a JSON array, not an object. Provenance: damage invented.
- `backup-encrypted.daylio` (refused: encrypted; sourced): real ZipCrypto-encrypted backup.daylio (password "secret"); must say encrypted, not "damaged". Provenance: whether Daylio ever encrypts is UNCONFIRMED; refusal from SPEC.
- `backup-zip64.daylio` (refused: zip64; sourced): otherwise valid backup written with ZIP64 local/central extra fields and ZIP64 end records. Provenance: refusal from SPEC; damage invented.
- `backup-missing-member.daylio` (refused: not_daylio; sourced): a ZIP with photos and a readme but no backup.daylio member. Provenance: invented.
- `backup-nested-folder.daylio` (refused: not_daylio; assumed; also OK: ok): backup.daylio inside a folder in the ZIP (unzip + re-zip on a Mac). Provenance: assumed.
- `backup-latin1-payload.daylio` (refused: encoding; sourced): base64 decodes to Latin-1 JSON (ü = 0xFC). Provenance: damage invented.
- `backup-bare-payload.daylio` (refused: not_daylio; assumed; also OK: ok_as_backup): the inner backup.daylio base64 text alone, no ZIP around it. Provenance: assumed.
- `backup-plain-json-member.daylio` (refused: bad_payload; assumed; also OK: ok_as_backup): ZIP whose backup.daylio member is plain JSON, not base64. Provenance: assumed.

## Hard rules these fixtures encode (SPEC)
- A refused file imports nothing (no half import). Malformed CSV rows are skipped and listed; the rest imports.
- CSV date/time exactly as written (no offset); backup local time = datetime + timeZoneOffset, minute truncated.
- Levels: 5 = best (assumption from SPEC); backup level = 6 - mood_group_id; CSV levels from `options.mapping`,
  else Daylio default English names, else null.
- Photos: type-1 assets whose file is in the ZIP, at most 3 per entry.

## Known weak spots of this set
- No real export from a phone was available. Facts marked A in FORMAT.md may be wrong, mainly: translated headers,
  German/French date cells, 12 h padding/case, raw newlines in CSV notes, iOS backup shape, the meaning of `state`,
  and whether the asset month folder is 1-based.
- check.py and the generator share their author, so check.py proves the files and expectations agree with each other,
  not that the expectations match Daylio.

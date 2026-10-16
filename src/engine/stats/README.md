# Statistics engine — function ↔ SPEC formula map

For reviewers and the oracle: the normative text is `docs/SPEC.md` "Formulas" (D15). Everything here is pure
TypeScript (no React Native, no SQLite, no device zone, no `Date.now()`); the period, week start and today are
parameters. Input: `StatEntry { id, moodId, level (current level of its mood), date (journal day), activityIds }`.

| SPEC | Function | File |
|---|---|---|
| 1 Day value v(d) | `dayIndex` (value, entries, activity set per logged day), `dayValues` | `days.ts` |
| "only entries with d(e) ∈ P" | `entriesIn` | `days.ts` |
| 2 Average (day-weighted, 1 decimal half up, N days / M entries) | `averageMood`, `roundOneDecimal`, `formatAverage` | `summary.ts`, `types.ts`, `format.ts` |
| 3 Mood counts per mood / level | `moodCounts` | `summary.ts` |
| 4 Chart series (day ≤ 92, week ≤ 731 (D39), month) | `seriesMode`, `moodSeries` | `series.ts` |
| 5 By weekday (ISO 1–7, with n) | `byWeekday` | `summary.ts` |
| 6 Monthly / yearly (with n) | `byMonth`, `byYear` | `summary.ts` |
| 7 Pixel colour = level floor(v + 0.5) | `pixelLevels`, `yearPixels` (29 Feb only in leap years), `monthGrid` | `pixels.ts` |
| 8 Activity comparison (entries / same day / next day, Welch labels) | `compareEntries`, `compareSameDay`, `compareNextDay`, `welch`, `comparisonLabel`, `comparisonSentence` | `compare.ts`, `format.ts` |
| 9 Often together (per activity; global top 10 pairs ≥ 3) | `oftenTogether`, `topPairs` | `together.ts` |
| 10 Related activities per level (top 10) | `relatedForLevel` (`levelDetail`) | `together.ts`, `index.ts` |
| 11 Frequency vs previous period | `frequencies`, `formatFrequency` | `together.ts`, `format.ts` |
| 12 Streak | `computeStreak` | `../streaks.ts` |
| 13 Goals | `computeGoal` | `../goals.ts` |
| 14 Journal day / editing | `journalDayOf`, `utcForJournalTime`, `localToUtc` | `../dates.ts` |

Screen bundles: `overview` (Stats tab), `activityDetail`, `levelDetail` in `index.ts`.

Float handling: means are IEEE doubles. Ties and zeros use a 1e-9 tolerance (`EPS`): round half up (3.85 → 3.9,
3.5 → 4), zero variance and Δ = 0 in `welch`, and the |t| ≥ 3 / ≥ 1 thresholds (D52). Day values are small rationals, so a
true value is never within 1e-9 of a tie without being one. Ordering ties: count desc, then activity id asc.

Oracle: `test/oracle/stats_oracle.py` (exact fractions) + `gen_journals.py`, compared in `oracle.test.ts`
(ORACLE_COUNT, ORACLE_SEED env overrides).

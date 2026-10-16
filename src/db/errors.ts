/** A data rule the user can hit (shown as a message by the screen; nothing was changed). */
export type DataRuleCode =
  | 'last-of-level' // each level keeps at least one active mood (SPEC Data model)
  | 'duplicate-name' // activity names are unique per group, case-insensitive
  | 'not-found'
  | 'invalid' // a value outside its allowed range
  | 'future-date' // entries are limited to today + 1 (SPEC Edge cases)
  | 'too-early' // … and to 1900-01-01
  | 'too-many-photos' // ≤ 3 per entry (D30)
  | 'too-many-reminders' // ≤ 6 (D21)
  | 'group-not-empty'
  | 'same-mood';

export class DataRuleError extends Error {
  constructor(
    readonly code: DataRuleCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DataRuleError';
  }
}

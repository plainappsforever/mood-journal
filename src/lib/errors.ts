import { Alert } from 'react-native';

import { DataRuleError } from '@/db/errors';
import type { MessageKey, Translator } from '@/lib/i18n';

const KEYS: Record<string, MessageKey> = {
  'last-of-level': 'error.lastOfLevel',
  'duplicate-name': 'error.duplicateName',
  'not-found': 'error.notFound',
  invalid: 'error.invalid',
  'future-date': 'error.futureDate',
  'too-early': 'error.tooEarly',
  'too-many-photos': 'error.tooManyPhotos',
  'too-many-reminders': 'error.tooManyReminders',
  'group-not-empty': 'error.groupNotEmpty',
  'same-mood': 'error.sameMood',
};

export function errorMessage(t: Translator, e: unknown): string {
  if (e instanceof DataRuleError) return t(KEYS[e.code] ?? 'error.generic');
  return t('error.generic');
}

/** Shows the message for a failed action (nothing was changed). */
export function showError(t: Translator, e: unknown): void {
  if (!(e instanceof DataRuleError)) console.warn(e);
  Alert.alert(t('error.title'), errorMessage(t, e));
}

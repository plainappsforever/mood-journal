// Defaults at first start, in the device language (SPEC Data model): five moods (one per level) and five activity
// groups. Runs once: the marker `defaults_seeded` stays set even if the user later renames or archives everything.
import { translate, type Language, type MessageKey } from '@/lib/i18n';

import { withTransaction } from './tx';
import type { Db } from './types';

export const DEFAULT_MOODS: { level: number; emoji: string; color: string }[] = [
  { level: 5, emoji: '😄', color: '#2E9E5B' },
  { level: 4, emoji: '🙂', color: '#8BC34A' },
  { level: 3, emoji: '😐', color: '#F2C14E' },
  { level: 2, emoji: '🙁', color: '#F08A4B' },
  { level: 1, emoji: '😫', color: '#D64545' },
];

export const DEFAULT_GROUPS: { key: string; activities: [key: string, emoji: string][] }[] = [
  {
    key: 'feelings',
    activities: [
      ['calm', '😌'],
      ['happy', '😊'],
      ['grateful', '🙏'],
      ['tired', '🥱'],
      ['anxious', '😟'],
      ['stressed', '😣'],
      ['sad', '😢'],
      ['angry', '😠'],
    ],
  },
  {
    key: 'activities',
    activities: [
      ['work', '💼'],
      ['sport', '🏃'],
      ['walk', '🚶'],
      ['reading', '📖'],
      ['gaming', '🎮'],
      ['cooking', '🍳'],
      ['cleaning', '🧹'],
      ['shopping', '🛒'],
    ],
  },
  {
    key: 'people',
    activities: [
      ['family', '👪'],
      ['friends', '🧑‍🤝‍🧑'],
      ['partner', '❤️'],
      ['alone', '🧘'],
    ],
  },
  {
    key: 'sleep',
    activities: [
      ['goodSleep', '😴'],
      ['badSleep', '🥴'],
      ['sleptEarly', '🛏️'],
    ],
  },
  {
    key: 'health',
    activities: [
      ['ateWell', '🥗'],
      ['sweets', '🍬'],
      ['alcohol', '🍷'],
      ['sick', '🤒'],
    ],
  },
];

const SEEDED_KEY = 'defaults_seeded';

/** Seeds the defaults once. Returns true when it seeded now. */
export async function seedDefaults(db: Db, language: Language, now: number): Promise<boolean> {
  const t = (key: string) => translate(language, key as MessageKey);
  return withTransaction(db, async (tx) => {
    const marker = await tx.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', SEEDED_KEY);
    if (marker) return false;
    const existing = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM moods');
    if (!existing?.n) {
      for (const [i, mood] of DEFAULT_MOODS.entries()) {
        await tx.runAsync(
          'INSERT INTO moods (level, name, emoji, color, sort, created_ms) VALUES (?, ?, ?, ?, ?, ?)',
          mood.level,
          t(`default.mood.${mood.level}`),
          mood.emoji,
          mood.color,
          i,
          now
        );
      }
      for (const [g, group] of DEFAULT_GROUPS.entries()) {
        const { lastInsertRowId: groupId } = await tx.runAsync(
          'INSERT INTO activity_groups (name, sort, created_ms) VALUES (?, ?, ?)',
          t(`default.group.${group.key}`),
          g,
          now
        );
        for (const [a, [key, emoji]] of group.activities.entries()) {
          await tx.runAsync(
            'INSERT INTO activities (group_id, name, emoji, sort, created_ms) VALUES (?, ?, ?, ?, ?)',
            groupId,
            t(`default.activity.${key}`),
            emoji,
            a,
            now
          );
        }
      }
    }
    await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', SEEDED_KEY, '1');
    return true;
  });
}

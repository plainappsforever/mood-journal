// Shared loaders for screens. Every loader reloads after any journal write (journal-store).
import { useMemo } from 'react';

import { listActivities, listGroups, type Activity, type ActivityGroup } from '@/db/activities';
import { listMoods, type Mood } from '@/db/moods';
import { useSQLiteContext } from '@/db/provider';
import { getJournalSettings, SETTING_DEFAULTS, type JournalSettings } from '@/db/settings';
import type { Formatter } from '@/engine/stats';
import { useLoad } from '@/hooks/use-load';
import { useLanguage, useT } from '@/hooks/use-t';
import { localeTag } from '@/lib/locale';

/** Settings, or null until they were read (use this where a default would be wrong, e.g. the day-end hour). */
export function useLoadedSettings(): JournalSettings | null {
  const db = useSQLiteContext();
  return useLoad(() => getJournalSettings(db), []);
}

export function useSettings(): JournalSettings {
  return useLoadedSettings() ?? SETTING_DEFAULTS;
}

export type MoodBook = { all: Mood[]; active: Mood[]; byId: Map<number, Mood>; firstOfLevel: Map<number, Mood> };

export function useMoods(): MoodBook | null {
  const db = useSQLiteContext();
  const all = useLoad(() => listMoods(db, { includeArchived: true }), []);
  return useMemo(() => {
    if (!all) return null;
    const active = all.filter((m) => !m.archived);
    const firstOfLevel = new Map<number, Mood>();
    for (const m of active) if (!firstOfLevel.has(m.level)) firstOfLevel.set(m.level, m);
    return { all, active, byId: new Map(all.map((m) => [m.id, m])), firstOfLevel };
  }, [all]);
}

export type ActivityBook = { groups: ActivityGroup[]; all: Activity[]; byId: Map<number, Activity> };

export function useActivities(): ActivityBook | null {
  const db = useSQLiteContext();
  const data = useLoad(async () => ({ groups: await listGroups(db, { includeArchived: true }), all: await listActivities(db, { includeArchived: true }) }), []);
  return useMemo(() => (data ? { ...data, byId: new Map(data.all.map((a) => [a.id, a])) } : null), [data]);
}

/** t + language + Intl locale for the plain-word formatters in src/engine/stats/format.ts. */
export function useFormatter(): Formatter {
  const t = useT();
  const language = useLanguage();
  return useMemo(() => ({ t, language, locale: localeTag(language) }), [t, language]);
}

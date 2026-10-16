import { useEffect, useState } from 'react';

import { useJournalVersion } from '@/lib/journal-store';

/**
 * Loads data with `load()` and reloads it whenever the journal changes or a dependency changes. Returns null until
 * the first load finished; keeps the previous value while reloading (no flicker). Errors are logged and keep the old value.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): T | null {
  const version = useJournalVersion();
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let active = true;
    load().then(
      (v) => active && setValue(v),
      (e) => console.warn('load failed', e)
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return value;
}

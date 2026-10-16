// One change counter for the whole journal: every screen that shows data reloads when it changes (after any write
// from any screen, an import or a restore). Cheap and correct; the database is the only source of truth.
import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

export function journalVersion(): number {
  return version;
}

export function journalChanged(): void {
  version += 1;
  listeners.forEach((l) => l());
}

/** Non-React listeners (reminder re-plan). Returns the unsubscribe function. */
export function subscribeJournal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useJournalVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
}

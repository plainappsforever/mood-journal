import { journalChanged } from '@/lib/journal-store';

/** Runs a database write and tells every screen to reload afterwards (also after a failed write: nothing is stale). */
export async function write<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    journalChanged();
  }
}

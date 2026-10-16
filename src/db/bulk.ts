// Multi-row INSERTs for import and restore (review S9). One `runAsync` costs three native calls (prepare, execute,
// finalize — native-retry.ts), so 20,000 rows one by one took 15–70 s on the simulator/emulator. Here rows go in
// chunks of at most MAX_VARS bound values per statement (SQLite 3.50 in expo-sqlite allows 32,766). Call it with the
// handle of a running withTransaction unit: the caller's transaction keeps the whole write atomic.
import type { Db } from './types';

/** Bound values per statement: far below SQLite's 32,766, small enough for a short statement text. */
export const MAX_VARS = 8000;

export type SqlValue = string | number | null;

/** INSERT `rows` (each in `columns` order) into `table`; returns the number of rows written. */
export async function insertRows(db: Db, table: string, columns: readonly string[], rows: readonly (readonly SqlValue[])[], verb = 'INSERT'): Promise<number> {
  if (!rows.length) return 0;
  if (!columns.length) throw new Error(`insertRows ${table}: no columns`);
  const per = Math.max(1, Math.floor(MAX_VARS / columns.length));
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const head = `${verb} INTO ${table} (${columns.join(', ')}) VALUES `;
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: SqlValue[] = [];
    for (const row of chunk) {
      if (row.length !== columns.length) throw new Error(`insertRows ${table}: row has ${row.length} values for ${columns.length} columns`);
      for (const v of row) params.push(v);
    }
    await db.runAsync(head + chunk.map(() => tuple).join(', '), ...params);
  }
  return rows.length;
}

/** The next id an AUTOINCREMENT table hands out (never reuses an id of a deleted row). Call inside the transaction. */
export async function nextId(db: Db, table: string): Promise<number> {
  const max = await db.getFirstAsync<{ m: number | null }>(`SELECT MAX(id) AS m FROM ${table}`);
  const seq = await db.getFirstAsync<{ s: number | null }>('SELECT seq AS s FROM sqlite_sequence WHERE name = ?', table);
  return Math.max(max?.m ?? 0, seq?.s ?? 0) + 1;
}

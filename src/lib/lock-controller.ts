import { useEffect } from 'react';

// Who may keep the app unlocked right now (D22): the capture flow (scanner, photo/PDF pick, Review) and the
// system pickers / share sheets of backup and restore. While anything holds a suspension, coming back after a
// long time in the background does not lock; the lock is deferred (see app-lock.ts) and applies when the last
// holder lets go.

let holders = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Holds the lock off until the returned function is called (idempotent). */
export function suspendLock(): () => void {
  holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    // Capture → Review replaces one screen with the next: let the next one take over before re-checking.
    setTimeout(emit, 600);
  };
}

export function isLockSuspended(): boolean {
  return holders > 0;
}

/** Called when a suspension ended or the lock setting changed. */
export function onLockRecheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestLockRecheck(): void {
  emit();
}

/** Screens of the capture flow call this: the app never locks while they are open. */
export function useSuspendLock(): void {
  useEffect(() => suspendLock(), []);
}

export async function withLockSuspended<T>(fn: () => Promise<T>): Promise<T> {
  const release = suspendLock();
  try {
    return await fn();
  } finally {
    release();
  }
}

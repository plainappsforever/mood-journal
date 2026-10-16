// A promise that rejects when `work` does not settle within `ms`. expo-print on a loaded Android emulator can fail to
// settle (invoice-maker D72); the user must get "could not be created → try again", not an endless spinner. The
// native job is not cancelled; a late result is ignored.
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} took longer than ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

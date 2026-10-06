// A failed startup read must not permanently mark cloud data as loaded.
// Concurrent readers share one request; the next reader retries after failure.
export function createRetryableLoader(load: () => Promise<void>): () => Promise<void> {
  let loaded = false;
  let pending: Promise<void> | undefined;
  return () => {
    if (loaded) return Promise.resolve();
    if (!pending) pending = load().then(() => { loaded = true; }).finally(() => { pending = undefined; });
    return pending;
  };
}

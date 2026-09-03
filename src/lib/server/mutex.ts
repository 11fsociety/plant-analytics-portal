/**
 * Minimal named async mutex. Each name has one queue; work runs strictly serially.
 * Scope: single serverless-function instance. On cold starts / multi-region deploys
 * this doesn't guarantee cross-instance ordering — good enough for a solo-ops portal,
 * but note the limit if the ops team grows.
 */
const queues = new Map<string, Promise<unknown>>();

export async function withMutex<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  // store the "next" promise so subsequent callers queue behind it
  queues.set(name, next);
  try {
    return await next;
  } finally {
    // if we're still the tail, clear so map doesn't grow unbounded
    if (queues.get(name) === next) queues.delete(name);
  }
}

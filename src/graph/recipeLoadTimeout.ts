/**
 * Recipe loading can stall indefinitely rather than fail: a packed-image or document request that
 * the server never answers leaves its promise pending forever. The graph marks a node loading
 * before it awaits and refuses to act on a loading node, so a stall does not just lose one recipe
 * -- it wedges that node permanently, and the lookup spinner in front of the picker never ends.
 * A stalled load is turned into a failure so the existing error paths can run.
 */
export const RECIPE_LOAD_TIMEOUT_MS = 20_000;

export class RecipeLoadTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not respond within ${String(Math.round(timeoutMs / 1000))} seconds.`);
    this.name = 'RecipeLoadTimeoutError';
  }
}

/**
 * Rejects if the load has not settled in time. The underlying request is left alone: it has no
 * cancellation, and a late answer landing in a cache is still worth having.
 */
export function withRecipeLoadTimeout<T>(
  load: Promise<T>,
  label: string,
  timeoutMs: number = RECIPE_LOAD_TIMEOUT_MS,
  scheduler: {
    setTimeout: (handler: () => void, ms: number) => unknown;
    clearTimeout: (handle: never) => void;
  } = globalThis as never,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Recipe load timeout must be a positive duration, got ${String(timeoutMs)}.`);
  }
  let handle: unknown;
  return Promise.race([
    load,
    new Promise<never>((_resolve, reject) => {
      handle = scheduler.setTimeout(
        () => reject(new RecipeLoadTimeoutError(label, timeoutMs)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    scheduler.clearTimeout(handle as never);
  });
}

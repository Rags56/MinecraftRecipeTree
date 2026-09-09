/**
 * Icon URLs are content-addressed and therefore stable, so a single failed load used to mean a
 * permanently lettered icon: nothing ever asked for that URI again. That turns any transient
 * interruption -- a service worker terminated mid-fetch, a stalled request during the burst a
 * freshly opened screen produces, a brief network drop -- into an icon that stays broken while
 * whatever happened to already be cached keeps rendering. Retrying a bounded number of times
 * keeps the eventual fallback meaningful without giving up on the first stumble.
 */
export const MAX_ITEM_ICON_LOAD_ATTEMPTS = 4;
const ITEM_ICON_RETRY_BASE_DELAY_MS = 400;
/** Hundreds of icons can fail together, so spread their retries instead of retrying in lockstep. */
const ITEM_ICON_RETRY_JITTER_MS = 250;

export function shouldRetryItemIconLoad(attemptsMade: number): boolean {
  return attemptsMade < MAX_ITEM_ICON_LOAD_ATTEMPTS;
}

/** Exponential backoff with jitter, in the same shape the pack loader's own retries would use. */
export function itemIconRetryDelayMs(
  attemptsMade: number,
  random: () => number = Math.random,
): number {
  if (!Number.isSafeInteger(attemptsMade) || attemptsMade < 1) {
    throw new Error(`Item icon retry delay requires a positive attempt count, got ${attemptsMade}.`);
  }
  const jitter = Math.floor(random() * ITEM_ICON_RETRY_JITTER_MS);
  return ITEM_ICON_RETRY_BASE_DELAY_MS * 2 ** (attemptsMade - 1) + jitter;
}

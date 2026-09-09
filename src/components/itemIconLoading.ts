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

/**
 * A request that never answers is worse than one that fails: no error event ever fires, so the
 * retry above never runs and the icon waits forever with nothing to show for it. Treating a
 * silent load as a failure turns an unanswered image into the same bounded retry-then-fallback
 * every other failure gets. Observed in production against packed-image coordinates whose pack
 * hangs server-side rather than returning a status.
 */
export const ITEM_ICON_LOAD_TIMEOUT_MS = 10_000;

/**
 * Icons usually resolve fast enough that a spinner would only flash. Waiting before showing one
 * keeps the common case still and reserves the spinner for loads slow enough that the user would
 * otherwise be left guessing whether the icon is broken.
 */
export const ITEM_ICON_SPINNER_DELAY_MS = 400;

/** The platform's smallest indicator is about this wide, and icons are frequently smaller. */
const SMALL_ACTIVITY_INDICATOR_SIZE = 20;
const MIN_ITEM_ICON_SPINNER_SCALE = 0.5;

/** Fits the indicator inside the icon's own footprint so a 16px icon keeps its grid position. */
export function itemIconSpinnerScale(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Item icon spinner scale requires a positive size, got ${size}.`);
  }
  return Math.max(
    MIN_ITEM_ICON_SPINNER_SCALE,
    Math.min(1, size / SMALL_ACTIVITY_INDICATOR_SIZE),
  );
}

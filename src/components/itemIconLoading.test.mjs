import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  ITEM_ICON_LOAD_TIMEOUT_MS,
  ITEM_ICON_SPINNER_DELAY_MS,
  MAX_ITEM_ICON_LOAD_ATTEMPTS,
  itemIconRetryDelayMs,
  itemIconSpinnerScale,
  shouldRetryItemIconLoad,
} from './itemIconLoading.ts';

const itemIconSource = await readFile(new URL('./ItemIcon.tsx', import.meta.url), 'utf8');

test('retries a bounded number of times before giving up on a URI', () => {
  assert.equal(shouldRetryItemIconLoad(1), true);
  assert.equal(shouldRetryItemIconLoad(MAX_ITEM_ICON_LOAD_ATTEMPTS - 1), true);
  assert.equal(shouldRetryItemIconLoad(MAX_ITEM_ICON_LOAD_ATTEMPTS), false);
  assert.equal(shouldRetryItemIconLoad(MAX_ITEM_ICON_LOAD_ATTEMPTS + 1), false);
});

test('backs off exponentially so a stalled burst does not retry in lockstep', () => {
  assert.equal(itemIconRetryDelayMs(1, () => 0), 400);
  assert.equal(itemIconRetryDelayMs(2, () => 0), 800);
  assert.equal(itemIconRetryDelayMs(3, () => 0), 1600);
});

test('spreads concurrent retries with bounded jitter', () => {
  assert.equal(itemIconRetryDelayMs(1, () => 0), 400);
  assert.equal(itemIconRetryDelayMs(1, () => 0.999), 649);
  for (const random of [0, 0.25, 0.5, 0.999]) {
    const delay = itemIconRetryDelayMs(2, () => random);
    assert.ok(delay >= 800 && delay < 1050, `jittered delay ${delay} left its bounds`);
  }
});

test('rejects an attempt count that cannot describe a retry', () => {
  assert.throws(() => itemIconRetryDelayMs(0), /positive attempt count/u);
  assert.throws(() => itemIconRetryDelayMs(-1), /positive attempt count/u);
  assert.throws(() => itemIconRetryDelayMs(1.5), /positive attempt count/u);
});

test('reports an icon failure only once its retries are exhausted', () => {
  // A diagnostic emitted per transient error would misreport a recovered load as a broken asset.
  const handlerIndex = itemIconSource.indexOf('const failAttempt =');
  assert.ok(handlerIndex >= 0, 'ItemIcon no longer routes failures through one handler');
  const handlerBody = itemIconSource.slice(handlerIndex);
  const retryIndex = handlerBody.indexOf('shouldRetryItemIconLoad');
  const reportIndex = handlerBody.indexOf('reportFailure(');
  assert.ok(retryIndex >= 0, 'the icon error path no longer retries');
  assert.ok(reportIndex > retryIndex, 'the icon error path reports before exhausting its retries');
});

test('fails an attempt that never answers so retry and fallback can still run', () => {
  // A hung request fires neither onLoad nor onError, so without a timer the icon waits forever.
  assert.ok(ITEM_ICON_LOAD_TIMEOUT_MS > itemIconRetryDelayMs(MAX_ITEM_ICON_LOAD_ATTEMPTS - 1, () => 1));
  assert.match(itemIconSource, /ITEM_ICON_LOAD_TIMEOUT_MS/u);
  assert.match(itemIconSource, /timed out without a response/u);
});

test('shows a spinner only once a load is slow enough to look broken', () => {
  assert.ok(ITEM_ICON_SPINNER_DELAY_MS > 0);
  assert.ok(ITEM_ICON_SPINNER_DELAY_MS < ITEM_ICON_LOAD_TIMEOUT_MS);
  assert.match(itemIconSource, /ActivityIndicator/u);
  assert.match(itemIconSource, /\{slow && \(/u);
});

test('keeps the spinner inside the icon footprint at every icon size', () => {
  assert.equal(itemIconSpinnerScale(48), 1);
  assert.equal(itemIconSpinnerScale(20), 1);
  assert.equal(itemIconSpinnerScale(16), 0.8);
  // Never shrink to invisibility, however small the icon gets.
  assert.equal(itemIconSpinnerScale(4), 0.5);
  assert.throws(() => itemIconSpinnerScale(0), /positive size/u);
  assert.throws(() => itemIconSpinnerScale(Number.NaN), /positive size/u);
});

test('retries by remounting rather than by changing the content-addressed URI', () => {
  // The service worker matches packed-image coordinates on an exact search string, so a
  // cache-busting query would silently drop these requests out of the local pack cache.
  assert.match(itemIconSource, /key=\{attempt\}/u);
  assert.doesNotMatch(itemIconSource, /uri=\{`\$\{uri\}[?&]/u);
});

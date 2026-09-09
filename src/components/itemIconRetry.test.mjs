import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  MAX_ITEM_ICON_LOAD_ATTEMPTS,
  itemIconRetryDelayMs,
  shouldRetryItemIconLoad,
} from './itemIconRetry.ts';

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
  const handlerIndex = itemIconSource.indexOf('const onError =');
  assert.ok(handlerIndex >= 0, 'ItemIcon no longer defines a recognizable onError handler');
  const onErrorBody = itemIconSource.slice(handlerIndex);
  const retryIndex = onErrorBody.indexOf('shouldRetryItemIconLoad');
  const reportIndex = onErrorBody.indexOf('reportFailure(');
  assert.ok(retryIndex >= 0, 'the icon error path no longer retries');
  assert.ok(reportIndex > retryIndex, 'the icon error path reports before exhausting its retries');
});

test('retries by remounting rather than by changing the content-addressed URI', () => {
  // The service worker matches packed-image coordinates on an exact search string, so a
  // cache-busting query would silently drop these requests out of the local pack cache.
  assert.match(itemIconSource, /key=\{attempt\}/u);
  assert.doesNotMatch(itemIconSource, /uri=\{`\$\{uri\}[?&]/u);
});

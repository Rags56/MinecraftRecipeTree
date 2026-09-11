import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENSE_GRAPH_LOW_DETAIL_SCALE,
  DENSE_GRAPH_NODE_THRESHOLD,
  NODE_AMOUNT_LABEL_MIN_SCALE,
  shouldShowNodeAmounts,
  shouldUseLowDetailGraph,
} from './renderDetail.ts';

test('simplifies only dense graphs at unreadably low zoom', () => {
  assert.equal(
    shouldUseLowDetailGraph(DENSE_GRAPH_LOW_DETAIL_SCALE, DENSE_GRAPH_NODE_THRESHOLD),
    true,
  );
  assert.equal(shouldUseLowDetailGraph(0.8, 2_000), false);
  assert.equal(shouldUseLowDetailGraph(0.2, 40), false);
  assert.equal(shouldUseLowDetailGraph(Number.NaN, 2_000), false);
});

test('hides graph amounts at distant zoom while retaining them in exports', () => {
  assert.equal(shouldShowNodeAmounts(NODE_AMOUNT_LABEL_MIN_SCALE), true);
  assert.equal(shouldShowNodeAmounts(NODE_AMOUNT_LABEL_MIN_SCALE - 0.01), false);
  assert.equal(shouldShowNodeAmounts(0.12, true), true);
  assert.equal(shouldShowNodeAmounts(Number.NaN), false);
});

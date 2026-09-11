import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldRecomputeCulling,
  visibleGraphElements,
} from './viewportCulling.ts';

function node(id, x, y, w = 50, h = 50) {
  return {
    id,
    kind: 'item',
    x,
    y,
    w,
    h,
    item: {id, key: `item|test:${id}`, ancestors: []},
  };
}

test('renders only viewport-adjacent nodes and edges from a large graph', () => {
  const graph = {
    nodes: [node('root', 0, 0), node('near', 180, 0), node('far', 10_000, 10_000)],
    edges: [
      {x: 50, y: 24, w: 130, h: 2},
      {x: 9_900, y: 10_024, w: 100, h: 2},
    ],
    minX: 0,
    minY: 0,
    maxX: 10_050,
    maxY: 10_050,
  };
  const visible = visibleGraphElements(
    graph,
    {x: 20, y: 20, scale: 1},
    {w: 320, h: 240},
    0,
  );
  assert.deepEqual(visible.nodes.map(entry => entry.id), ['root', 'near']);
  assert.equal(visible.edges.length, 1);
  assert.equal(visible.culled, true);
});

test('accounts for pan, zoom, and rotated connector bounds', () => {
  const graph = {
    nodes: [node('root', 1_000, 1_000)],
    edges: [{x: 990, y: 1_025, w: 100, h: 2, angle: Math.PI / 2}],
    minX: 990,
    minY: 1_000,
    maxX: 1_090,
    maxY: 1_075,
  };
  const visible = visibleGraphElements(
    graph,
    {x: -1_900, y: -1_900, scale: 2},
    {w: 320, h: 240},
    0,
  );
  assert.equal(visible.nodes.length, 1);
  assert.equal(visible.edges.length, 1);
  assert.equal(visible.culled, false);
});

test('mounts only the root before the canvas has a measurable viewport', () => {
  const graph = {
    nodes: [node('root', 0, 0), node('child', 100, 100)],
    edges: [{x: 25, y: 25, w: 100, h: 2}],
    minX: 0,
    minY: 0,
    maxX: 150,
    maxY: 150,
  };
  const visible = visibleGraphElements(graph, {x: 0, y: 0, scale: 1}, {w: 0, h: 0});
  assert.deepEqual(visible.nodes.map(entry => entry.id), ['root']);
  assert.deepEqual(visible.edges, []);
});

test('keeps a 10,000-node off-screen tree to a bounded mounted window', () => {
  const nodes = Array.from({length: 10_000}, (_, index) =>
    node(index === 0 ? 'root' : `node-${index}`, 0, index * 100),
  );
  const edges = Array.from({length: 9_999}, (_, index) => ({
    x: 24,
    y: index * 100 + 50,
    w: 2,
    h: 50,
  }));
  const graph = {
    nodes,
    edges,
    minX: 0,
    minY: 0,
    maxX: 50,
    maxY: 999_950,
  };
  const visible = visibleGraphElements(
    graph,
    {x: 0, y: 0, scale: 1},
    {w: 390, h: 844},
  );
  assert.ok(visible.nodes.length < 20, `mounted ${visible.nodes.length} nodes`);
  assert.ok(visible.edges.length < 20, `mounted ${visible.edges.length} edges`);
  assert.equal(visible.culled, true);
});

test('skips connector geometry work when low-detail rendering hides every edge', () => {
  const graph = {
    nodes: [node('root', 0, 0), node('child', 100, 0)],
    edges: [{x: 50, y: 24, w: 50, h: 2}],
    minX: 0,
    minY: 0,
    maxX: 150,
    maxY: 50,
  };
  const visible = visibleGraphElements(
    graph,
    {x: 0, y: 0, scale: 0.2},
    {w: 320, h: 240},
    0,
    false,
  );
  assert.deepEqual(visible.nodes.map(entry => entry.id), ['root', 'child']);
  assert.deepEqual(visible.edges, []);
  assert.equal(visible.culled, true);
});

test('recomputes the visible set only once the canvas eats into its overscan', () => {
  const base = {x: 0, y: 0, scale: 1};
  // Small pans stay inside the margin that was already drawn, so nothing is rebuilt.
  assert.equal(shouldRecomputeCulling(base, {x: -40, y: 0, scale: 1}), false);
  assert.equal(shouldRecomputeCulling(base, {x: 0, y: 60, scale: 1}), false);
  // Past half the overscan it has to be rebuilt before the drawn margin runs out.
  assert.equal(shouldRecomputeCulling(base, {x: -200, y: 0, scale: 1}), true);
  assert.equal(shouldRecomputeCulling(base, {x: 0, y: 200, scale: 1}), true);
});

test('always recomputes when the zoom changes, which changes everything visible', () => {
  const base = {x: 0, y: 0, scale: 1};
  assert.equal(shouldRecomputeCulling(base, {x: 0, y: 0, scale: 1.01}), true);
  assert.equal(shouldRecomputeCulling(base, {x: 0, y: 0, scale: 0.5}), true);
});

test('scales its threshold with the zoom, since a screen pixel covers less graph when zoomed in', () => {
  const base = {x: 0, y: 0, scale: 4};
  // At 4x, half the overscan is 480 screen pixels of travel.
  assert.equal(shouldRecomputeCulling(base, {x: -300, y: 0, scale: 4}), false);
  assert.equal(shouldRecomputeCulling(base, {x: -600, y: 0, scale: 4}), true);
});

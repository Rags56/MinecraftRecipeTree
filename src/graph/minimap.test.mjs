import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINIMAP_DIRECT_NODE_LIMIT,
  graphPointFromMinimap,
  minimapNodeRects,
  minimapProjection,
  minimapViewportRect,
  shouldShowMinimap,
  transformCenteredOn,
} from './minimap.ts';

const bounds = {minX: 0, minY: 0, maxX: 1000, maxY: 500};

function node(x, y, w = 40, h = 20) {
  return {id: `${x}:${y}`, kind: 'item', x, y, w, h, item: {id: 'i', key: 'k', ancestors: []}};
}

test('projects the tree uniformly so the overview keeps its proportions', () => {
  const projection = minimapProjection(bounds, 200, 200);
  // Width is the binding constraint here, and height must use the same scale, not its own.
  assert.equal(projection.scale, 0.2);
  assert.equal(projection.width, 200);
  assert.equal(projection.height, 100);
});

test('anchors the projection on the tree, not on the origin', () => {
  const projection = minimapProjection({minX: -400, minY: 100, maxX: -200, maxY: 200}, 100, 100);
  assert.equal(projection.offsetX, -400);
  assert.equal(projection.offsetY, 100);
  const [rect] = minimapNodeRects([node(-400, 100, 200, 100)], projection);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
});

test('rejects a projection with no room to draw into', () => {
  assert.throws(() => minimapProjection(bounds, 0, 100), /positive bounds/u);
  assert.throws(() => minimapProjection(bounds, 100, -1), /positive bounds/u);
});

test('keeps every node visible even when it projects below a pixel', () => {
  const projection = minimapProjection(bounds, 100, 100);
  const rects = minimapNodeRects([node(0, 0, 1, 1)], projection);
  assert.equal(rects.length, 1);
  assert.ok(rects[0].w >= 1 && rects[0].h >= 1);
});

test('buckets dense trees instead of drawing one rect per node', () => {
  const projection = minimapProjection(bounds, 200, 100);
  const dense = Array.from({length: MINIMAP_DIRECT_NODE_LIMIT + 1}, (_, index) =>
    node((index % 50) * 20, Math.floor(index / 50) * 20),
  );
  const rects = minimapNodeRects(dense, projection);
  assert.ok(rects.length > 0);
  assert.ok(
    rects.length < dense.length,
    `expected fewer rects than nodes, got ${rects.length} for ${dense.length}`,
  );
});

test('draws every node directly while the tree is small enough to be worth it', () => {
  const projection = minimapProjection(bounds, 200, 100);
  const sparse = [node(0, 0), node(100, 100), node(900, 400)];
  assert.equal(minimapNodeRects(sparse, projection).length, 3);
  assert.deepEqual(minimapNodeRects([], projection), []);
});

test('maps the visible slice of the canvas into minimap space', () => {
  const projection = minimapProjection(bounds, 200, 100);
  // Canvas is showing graph x 0..500, y 0..250 at 2x zoom in a 1000x500 viewport.
  const rect = minimapViewportRect({x: 0, y: 0, scale: 2}, {w: 1000, h: 500}, projection);
  assert.deepEqual(rect, {x: 0, y: 0, w: 100, h: 50});
});

test('accounts for a panned canvas when mapping the visible slice', () => {
  const projection = minimapProjection(bounds, 200, 100);
  const rect = minimapViewportRect({x: -500, y: -250, scale: 1}, {w: 500, h: 250}, projection);
  assert.equal(rect.x, 100);
  assert.equal(rect.y, 50);
});

test('rejects a viewport mapping that cannot describe a zoom', () => {
  const projection = minimapProjection(bounds, 200, 100);
  assert.throws(
    () => minimapViewportRect({x: 0, y: 0, scale: 0}, {w: 10, h: 10}, projection),
    /positive scale/u,
  );
});

test('round-trips a tapped point back into graph coordinates', () => {
  const projection = minimapProjection(bounds, 200, 100);
  assert.deepEqual(graphPointFromMinimap({x: 0, y: 0}, projection), {x: 0, y: 0});
  assert.deepEqual(graphPointFromMinimap({x: 200, y: 100}, projection), {x: 1000, y: 500});
});

test('centres the canvas on a point without disturbing the zoom', () => {
  const next = transformCenteredOn({x: 500, y: 250}, {x: 0, y: 0, scale: 2}, {w: 400, h: 200});
  assert.equal(next.scale, 2);
  // The chosen graph point must land in the middle of the viewport.
  assert.equal(next.x + 500 * next.scale, 200);
  assert.equal(next.y + 250 * next.scale, 100);
});

test('shows the overview only once the tree outgrows the canvas', () => {
  const viewport = {w: 500, h: 500};
  const layout = {...bounds, nodes: [node(0, 0), node(900, 400)]};
  assert.equal(shouldShowMinimap(layout, viewport, {x: 0, y: 0, scale: 1}), true);
  // Zoomed far enough out that the whole tree is already on screen.
  assert.equal(shouldShowMinimap(layout, viewport, {x: 0, y: 0, scale: 0.1}), false);
});

test('stays hidden when there is nothing to navigate or nothing to measure', () => {
  const viewport = {w: 500, h: 500};
  assert.equal(
    shouldShowMinimap({...bounds, nodes: [node(0, 0)]}, viewport, {x: 0, y: 0, scale: 1}),
    false,
  );
  const layout = {...bounds, nodes: [node(0, 0), node(900, 400)]};
  assert.equal(shouldShowMinimap(layout, {w: 0, h: 0}, {x: 0, y: 0, scale: 1}), false);
  assert.equal(shouldShowMinimap(layout, viewport, {x: 0, y: 0, scale: 0}), false);
});

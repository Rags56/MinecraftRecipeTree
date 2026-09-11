import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  gatherableIdentitiesUnder,
  isOutlineBranch,
  outlineResourceRows,
  resourceOutlineRows,
} from './resourceOutline.ts';

function node(id, key, extra = {}) {
  return {id, key, ancestors: [], ...extra};
}
function recipe(id, inputs) {
  return {id: `${id}.s`, kind: 'recipe', inputs};
}

/**
 *  stargate
 *    ├ casing            (recipe set: holds plate + rod)
 *    │   ├ plate         (raw)
 *    │   └ rod           (raw)
 *    └ core              (raw)
 */
function tree() {
  const plate = node('casing.s.0', 'plate', {amount: 8});
  const rod = node('casing.s.1', 'rod', {amount: 4});
  const casing = node('root.s.0', 'casing', {amount: 2, source: recipe('casing', [plate, rod])});
  const core = node('root.s.1', 'core', {amount: 1});
  return {root: node('root', 'stargate', {source: recipe('root', [casing, core])}), casing, core, plate};
}

test('lists the tree as sections and the things to gather under them', () => {
  const rows = resourceOutlineRows(tree().root);
  assert.deepEqual(
    rows.map(r => [r.key, r.depth, r.expanded]),
    [
      ['casing', 0, true],
      ['plate', 1, false],
      ['rod', 1, false],
      ['core', 0, false],
    ],
  );
});

test('an item is a section once its recipe is set, folded or not', () => {
  const {casing, core} = tree();
  assert.equal(isOutlineBranch(casing), true);
  assert.equal(isOutlineBranch(core), false);
  // Folded still counts: the recipe is chosen, it is just put away.
  assert.equal(
    isOutlineBranch(node('x', 'x', {collapsedSource: recipe('x', [])})),
    true,
  );
});

test('a folded section keeps its place but hides what it holds', () => {
  const {root, casing} = tree();
  // Folding in the tree is the same act as folding here.
  casing.collapsedSource = casing.source;
  casing.source = undefined;
  const rows = resourceOutlineRows(root);
  assert.deepEqual(rows.map(r => r.key), ['casing', 'core']);
  const folded = rows[0];
  assert.equal(folded.collapsed, true);
  assert.equal(folded.expanded, false);
  // Reopening it in the tree brings its contents back to the list unprompted.
  casing.source = casing.collapsedSource;
  casing.collapsedSource = undefined;
  assert.deepEqual(resourceOutlineRows(root).map(r => r.key), ['casing', 'plate', 'rod', 'core']);
});

test('a focused branch lists only its own resources', () => {
  const {root, casing, plate} = tree();
  const focus = new Set([root.id, casing.id, plate.id]);
  assert.deepEqual(
    resourceOutlineRows(root, {visibleNodeIds: focus}).map(r => r.key),
    ['casing', 'plate'],
  );
});

test('prefers the calculated amount over the raw one on the node', () => {
  const {root} = tree();
  const rows = resourceOutlineRows(root, {
    requiredByNode: new Map([['casing.s.0', 64]]),
  });
  const plate = rows.find(r => r.key === 'plate');
  assert.equal(plate.amount, 64);
  // Without a calculated amount it falls back to the node, and to null when there is none.
  assert.equal(rows.find(r => r.key === 'rod').amount, 4);
  assert.equal(
    resourceOutlineRows(node('r', 'r', {source: recipe('r', [node('r.s.0', 'unknown')])}))[0]
      .amount,
    null,
  );
});

test('counts only what is left to gather, not the steps on the way', () => {
  const rows = resourceOutlineRows(tree().root);
  assert.deepEqual(
    outlineResourceRows(rows).map(r => r.key),
    ['plate', 'rod', 'core'],
  );
});

test('an empty or unexpanded tree lists nothing', () => {
  assert.deepEqual(resourceOutlineRows(null), []);
  assert.deepEqual(resourceOutlineRows(node('root', 'stargate')), []);
});

test('the outline and the tree share one collapse, in both directions', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // Folding a section calls the tree's own collapse rather than keeping a second copy of the
  // state, so neither view can disagree with the other about what is open.
  assert.match(screen, /snapshotRef\.current\?\.onToggleNode\(node\)/u);
  assert.match(graph, /onToggleNode: onItemTap/u);
  assert.doesNotMatch(screen, /useState.*collapsedSection/u);
  // And the other direction: the outline reads folded state off the node itself.
  assert.match(
    readFileSync(new URL('./resourceOutline.ts', import.meta.url), 'utf8'),
    /collapsed: child\.source === undefined && child\.collapsedSource !== undefined/u,
  );
});

test('a focused branch narrows the list the graph is already narrowed to', () => {
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // The same set the layouts filter on, so the list cannot show a branch the canvas is hiding.
  assert.match(graph, /visibleNodeIds: focusVisibleNodeIds/u);
});

test('a section covers every gatherable thing beneath it', () => {
  const {root, casing} = tree();
  // The ends of the branch, not the steps: casing itself is made, plate and rod are collected.
  assert.deepEqual(gatherableIdentitiesUnder(casing).sort(), ['plate', 'rod']);
  assert.deepEqual(gatherableIdentitiesUnder(root).sort(), ['core', 'plate', 'rod']);
});

test('ticking a folded section still covers what it holds', () => {
  const {casing} = tree();
  casing.collapsedSource = casing.source;
  casing.source = undefined;
  // Its contents are out of the list but not out of the build, so they still tick.
  assert.deepEqual(gatherableIdentitiesUnder(casing).sort(), ['plate', 'rod']);
});

test('a resource covers itself', () => {
  assert.deepEqual(gatherableIdentitiesUnder(node('c', 'core')), ['core']);
});

test('a tag requirement keeps its own identity through a cascade', () => {
  const anyIngot = node('a', 'iron_ingot', {tag: 'forge:ingots/iron', variantCount: 6});
  const exact = node('b', 'iron_ingot');
  const parent = node('p', 'p', {source: recipe('p', [anyIngot, exact])});
  // Both are beneath the same section, and ticking it must not merge two different requirements.
  assert.deepEqual(gatherableIdentitiesUnder(parent).sort(), ['#forge:ingots/iron', 'iron_ingot']);
});

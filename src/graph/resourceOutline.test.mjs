import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  filterOutlineRows,
  gatherableNodeIdsUnder,
  isOutlineBranch,
  outlineRowKind,
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
  assert.deepEqual(gatherableNodeIdsUnder(casing).sort(), ['casing.s.0', 'casing.s.1']);
  assert.deepEqual(
    gatherableNodeIdsUnder(root).sort(),
    ['casing.s.0', 'casing.s.1', 'root.s.1'],
  );
});

test('ticking a folded section still covers what it holds', () => {
  const {casing} = tree();
  casing.collapsedSource = casing.source;
  casing.source = undefined;
  // Its contents are out of the list but not out of the build, so they still tick.
  assert.deepEqual(gatherableNodeIdsUnder(casing).sort(), ['casing.s.0', 'casing.s.1']);
});

test('a resource covers itself', () => {
  assert.deepEqual(gatherableNodeIdsUnder(node('c', 'core')), ['c']);
});

test('two places wanting the same item are two separate errands', () => {
  // The reported bug: a ring block and a chevron block each need eighty hieroglyphs, which is a
  // hundred and sixty between them. Keyed by item, one tick struck off both.
  const forRing = node('ring.s.0', 'hieroglyph', {amount: 80});
  const forChevron = node('chevron.s.0', 'hieroglyph', {amount: 80});
  const ring = node('root.s.0', 'ring_block', {source: recipe('ring', [forRing])});
  const chevron = node('root.s.1', 'chevron_block', {source: recipe('chevron', [forChevron])});
  const root = node('root', 'stargate', {source: recipe('root', [ring, chevron])});

  assert.deepEqual(gatherableNodeIdsUnder(root).sort(), ['chevron.s.0', 'ring.s.0']);
  // Ticking the ring block covers its own eighty and nothing else.
  assert.deepEqual(gatherableNodeIdsUnder(ring), ['ring.s.0']);
  assert.deepEqual(gatherableNodeIdsUnder(chevron), ['chevron.s.0']);
});

test('a tag requirement and an exact one stay apart', () => {
  const anyIngot = node('p.s.0', 'iron_ingot', {tag: 'forge:ingots/iron', variantCount: 6});
  const exact = node('p.s.1', 'iron_ingot');
  const parent = node('p', 'p', {source: recipe('p', [anyIngot, exact])});
  // Both are beneath the same section, and ticking it must not merge two different requirements.
  assert.deepEqual(gatherableNodeIdsUnder(parent).sort(), ['p.s.0', 'p.s.1']);
});

test('turning byproducts on recalculates the list, not just the setting', () => {
  // requiredByNode is the gross requirement and does not move when byproducts are toggled, so a
  // list showing only that changed nothing at all when the preference was flipped. Coverage is
  // what moves, and it decides both what a row says and whether it is still something to gather.
  const {root, casing, plate} = tree();
  const covered = new Map([
    [plate.id, {nodeId: plate.id, key: 'plate', requiredAmount: 8, creditedAmount: 8, remainingAmount: 0, allocations: []}],
  ]);

  const off = resourceOutlineRows(root);
  assert.equal(off.find(r => r.key === 'plate').byproductCovered, false);
  assert.equal(off.find(r => r.key === 'plate').byproductCredited, 0);
  assert.deepEqual(
    gatherableNodeIdsUnder(root).sort(),
    ['casing.s.0', 'casing.s.1', 'root.s.1'],
  );

  const on = resourceOutlineRows(root, {byproductCoverageByNode: covered});
  assert.equal(on.find(r => r.key === 'plate').byproductCovered, true);
  assert.equal(on.find(r => r.key === 'plate').byproductCredited, 8);
  // Nothing to gather for a covered row, so the count and the percentage move with it.
  assert.deepEqual(gatherableNodeIdsUnder(root, covered).sort(), ['casing.s.1', 'root.s.1']);
  assert.deepEqual(gatherableNodeIdsUnder(casing, covered), ['casing.s.1']);
});

test('a partly covered row keeps its requirement and states the credit', () => {
  const {root, plate} = tree();
  const partial = new Map([
    [plate.id, {nodeId: plate.id, key: 'plate', requiredAmount: 8, creditedAmount: 3, remainingAmount: 5, allocations: []}],
  ]);
  const row = resourceOutlineRows(root, {byproductCoverageByNode: partial}).find(
    r => r.key === 'plate',
  );
  assert.equal(row.byproductCredited, 3);
  assert.equal(row.byproductCovered, false);
  // Still something to go and get, since a byproduct only covered part of it.
  assert.ok(gatherableNodeIdsUnder(root, partial).includes('casing.s.0'));
});

test('separates what is consumed from what is kept', () => {
  const hammer = node('c.s.0', 'hammer', {nonConsumed: true, retentionMode: 'durability', retentionUses: 128});
  const plate = node('c.s.1', 'plate', {amount: 8});
  const casing = node('root.s.0', 'casing', {source: recipe('c', [hammer, plate])});
  const root = node('root', 'stargate', {source: recipe('root', [casing])});

  const rows = resourceOutlineRows(root);
  assert.equal(rows.find(r => r.key === 'hammer').consumed, false);
  assert.equal(rows.find(r => r.key === 'hammer').retentionMode, 'durability');
  assert.equal(rows.find(r => r.key === 'hammer').retentionUses, 128);
  assert.equal(rows.find(r => r.key === 'plate').consumed, true);
  assert.equal(outlineRowKind(rows.find(r => r.key === 'hammer')), 'catalyst');

  // Each list keeps the sections that lead to what it holds, so a tool three recipes down still
  // arrives with the path that explains where it is needed.
  assert.deepEqual(filterOutlineRows(rows, 'catalyst').map(r => r.key), ['casing', 'hammer']);
  assert.deepEqual(filterOutlineRows(rows, 'consumed').map(r => r.key), ['casing', 'plate']);
});

test('a section with nothing for a list is left out of it', () => {
  const plate = node('c.s.0', 'plate');
  const casing = node('root.s.0', 'casing', {source: recipe('c', [plate])});
  const hammer = node('root.s.1', 'hammer', {nonConsumed: true});
  const root = node('root', 'stargate', {source: recipe('root', [casing, hammer])});
  const rows = resourceOutlineRows(root);
  // Casing holds nothing reusable, so the catalysts list does not carry it for nothing.
  assert.deepEqual(filterOutlineRows(rows, 'catalyst').map(r => r.key), ['hammer']);
});

test('a tick cascades only within the list it was tapped in', () => {
  const hammer = node('c.s.0', 'hammer', {nonConsumed: true});
  const plate = node('c.s.1', 'plate');
  const casing = node('root.s.0', 'casing', {source: recipe('c', [hammer, plate])});
  const root = node('root', 'stargate', {source: recipe('root', [casing])});
  assert.deepEqual(gatherableNodeIdsUnder(casing, undefined, 'consumed'), ['c.s.1']);
  assert.deepEqual(gatherableNodeIdsUnder(casing, undefined, 'catalyst'), ['c.s.0']);
  // Unscoped still covers the whole branch, which is what the progress total uses.
  assert.deepEqual(gatherableNodeIdsUnder(casing).sort(), ['c.s.0', 'c.s.1']);
  assert.deepEqual(gatherableNodeIdsUnder(root, undefined, 'catalyst'), ['c.s.0']);
});

test('the two lists are a filter over one tree, not a second classification', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // Both tabs, and the rows on screen are the outline put through the filter rather than a
  // separately built list -- nothing about the tree changes when the tab does.
  assert.match(screen, /\['consumed', 'Items'\]/u);
  assert.match(screen, /\['catalyst', 'Catalysts & tools'\]/u);
  assert.match(screen, /filterOutlineRows\(outline, listKind\)/u);
  // Setting a row's kind goes through the tree's own retention override, so the tree, the totals
  // and the other list all agree and the choice survives a restart.
  assert.match(screen, /onToggleReusable\(node\)/u);
  assert.match(screen, /Set as catalyst/u);
  assert.match(screen, /Set as resource/u);
  // And the cascade is scoped to the list, so ticking a section in one does not strike off the other.
  assert.match(screen, /gatherableNodeIdsUnder\(node, coverage, listKind\)/u);
});

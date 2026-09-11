import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {findTreeNodeById, isNodeVisible, treeFocus, visibleInputs} from './treeFocus.ts';

function item(id, key, children) {
  const node = {id, key, ancestors: []};
  if (children) {
    node.source = {id: `${id}.s`, kind: 'recipe', inputs: children};
  }
  return node;
}

/**
 *        root
 *      /      \
 *   left      right
 *   /  \        |
 * l1    l2    r1 -> r1a
 */
function sampleTree() {
  return item('root', 'root', [
    item('left', 'left', [item('l1', 'l1'), item('l2', 'l2')]),
    item('right', 'right', [item('r1', 'r1', [item('r1a', 'r1a')])]),
  ]);
}

test('keeps the path down to the focused node and everything under it', () => {
  const focus = treeFocus(sampleTree(), 'right');
  assert.ok(focus);
  assert.deepEqual([...focus.visibleNodeIds].sort(), ['r1', 'r1a', 'right', 'root']);
  assert.deepEqual(focus.pathKeys, ['root', 'right']);
});

test('drops sibling branches rather than dimming them', () => {
  const focus = treeFocus(sampleTree(), 'r1');
  assert.equal(focus.visibleNodeIds.has('left'), false);
  assert.equal(focus.visibleNodeIds.has('l1'), false);
  // The chain above the focused node stays so it keeps its context.
  assert.equal(focus.visibleNodeIds.has('root'), true);
  assert.equal(focus.visibleNodeIds.has('right'), true);
  assert.equal(focus.visibleNodeIds.has('r1a'), true);
});

test('reports the breadcrumb root-first', () => {
  assert.deepEqual(treeFocus(sampleTree(), 'r1a').pathKeys, ['root', 'right', 'r1', 'r1a']);
});

test('focusing a leaf keeps only its own chain', () => {
  const focus = treeFocus(sampleTree(), 'l2');
  assert.deepEqual([...focus.visibleNodeIds].sort(), ['l2', 'left', 'root']);
});

test('treats an absent or root focus as no focus at all', () => {
  const root = sampleTree();
  assert.equal(treeFocus(root, null), null);
  assert.equal(treeFocus(root, 'root'), null);
  assert.equal(treeFocus(null, 'left'), null);
  // A focus that outlived its node must not blank the canvas.
  assert.equal(treeFocus(root, 'removed-node'), null);
});

test('finds nodes anywhere in the tree', () => {
  const root = sampleTree();
  assert.equal(findTreeNodeById(root, 'r1a').key, 'r1a');
  assert.equal(findTreeNodeById(root, 'root').key, 'root');
  assert.equal(findTreeNodeById(root, 'missing'), null);
  assert.equal(findTreeNodeById(null, 'root'), null);
});

test('an unfocused layout draws every child', () => {
  const root = sampleTree();
  assert.equal(visibleInputs(root).length, 2);
  assert.equal(isNodeVisible(undefined, 'anything'), true);
});

test('a focused layout draws only children on the focused branch', () => {
  const root = sampleTree();
  const focus = treeFocus(root, 'r1');
  assert.deepEqual(
    visibleInputs(root, focus.visibleNodeIds).map(child => child.id),
    ['right'],
  );
  assert.equal(isNodeVisible(focus.visibleNodeIds, 'left'), false);
  assert.equal(isNodeVisible(focus.visibleNodeIds, 'right'), true);
  // A node with no children is unaffected either way.
  assert.deepEqual(visibleInputs(item('leaf', 'leaf'), focus.visibleNodeIds), []);
});

test('focusing a branch is offered on every platform, behind no preference', () => {
  const source = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // Focus is always available; what a desktop opts into is the flat far-zoom rendering instead.
  assert.doesNotMatch(source, /focusModeEnabled|FOCUS_MODE_KEY/u);
  assert.match(source, /Platform\.OS === 'web' && \(\s*<CtrlBtn\s*label="Fast zoom"/u);
  const loader = source.slice(source.indexOf('function loadLowDetailMode'));
  assert.match(loader.slice(0, 200), /if \(Platform\.OS !== 'web'\) return true;/u);
  assert.match(loader.slice(0, 400), /getItem\(LOW_DETAIL_KEY\) === '1'/u);
});

test('the far-zoom rendering a desktop opts into is the only thing that preference gates', () => {
  const source = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // With it off a desktop keeps drawing real nodes however far out the tree is zoomed.
  assert.match(source, /lowDetailEnabled &&\s*!exportingTree &&\s*shouldUseLowDetailGraph\(/u);
});

test('a phone reaches the graph options through an overlay, not a bar on the canvas', () => {
  const source = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // The inline row and its overflow are web-only; the canvas keeps only a gear on a phone.
  assert.match(source, /\{showGraphControls && Platform\.OS === 'web' && \(/u);
  assert.match(source, /showMoreControls && Platform\.OS === 'web' && \(/u);
  assert.match(source, /Platform\.OS !== 'web' && \(\s*<GraphSettingsSheet/u);
});

test('every GraphScreen hook runs before its empty-tree return', () => {
  // A hook placed after a conditional return runs only on the renders that get past it, which
  // React refuses to draw: "rendered more hooks than during the previous render". tsc cannot see
  // this, and it only appears once a tree is missing, which is exactly when the graph is opened.
  const source = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  const componentStart = source.indexOf('export function GraphScreen(');
  assert.ok(componentStart > 0, 'GraphScreen is no longer a recognizable function component');
  const guard = source.indexOf('if (!graphRootKey || !root) {', componentStart);
  assert.ok(guard > 0, 'GraphScreen no longer returns early for an empty tree');

  // Everything from the guard to the end of GraphScreen's own body, stopping at the next
  // top-level declaration so other components' hooks are not counted.
  const nextComponent = source.indexOf('\nfunction ', guard);
  const tail = source.slice(guard, nextComponent > 0 ? nextComponent : undefined);
  const offenders = [...tail.matchAll(/^ {2}(?:const|let)?\s*.*\buse(?:Memo|Callback|State|Effect|Ref)\(/gmu)];
  assert.deepEqual(
    offenders.map(match => match[0].trim()),
    [],
    'GraphScreen calls a hook after its empty-tree return',
  );
});

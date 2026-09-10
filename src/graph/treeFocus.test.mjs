import assert from 'node:assert/strict';
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

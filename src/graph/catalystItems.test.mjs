import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  catalystItemsKey,
  loadCatalystItems,
  persistCatalystItems,
  withCatalystItem,
} from './catalystItems.ts';

const descriptor = {slug: 'gt-new-horizons', publicationId: 'b0c08e74'};

function withStorage(run) {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  };
  try {
    return run(store);
  } finally {
    globalThis.localStorage = previous;
  }
}

test('starts with nothing called a tool', () => {
  withStorage(() => {
    // A pack calling an item reusable describes the craft, not how someone wants to shop for it, so
    // a tree starts with everything a material and fills only with what the user marks.
    assert.equal(loadCatalystItems(descriptor, 'item|stargate').size, 0);
  });
});

test('scopes the marks to the pack and the tree they were made in', () => {
  // Node ids mean a place in one tree, so they cannot be shared between trees. A republished pack is
  // a different list, as it is for everything else keyed by publication.
  const stargate = catalystItemsKey(descriptor, 'item|stargate');
  assert.equal(stargate, 'resourceCatalysts:2:gt-new-horizons:b0c08e74:item|stargate');
  assert.notEqual(stargate, catalystItemsKey(descriptor, 'item|sponge'));
  assert.notEqual(stargate, catalystItemsKey({...descriptor, publicationId: 'deadbeef'}, 'item|stargate'));
  assert.notEqual(stargate, catalystItemsKey({...descriptor, slug: 'other'}, 'item|stargate'));
});

test('drops marks made when one mark stood for every place an item appeared', () => {
  withStorage(store => {
    const legacy = `resourceCatalysts:${descriptor.slug}:${descriptor.publicationId}`;
    store.set(legacy, JSON.stringify(['item|hammer']));
    // An item identity says nothing about which of its places the user meant, and spreading it over
    // places that were never picked is the behaviour this replaces.
    assert.equal(loadCatalystItems(descriptor, 'item|stargate').size, 0);
    assert.equal(store.has(legacy), false);
  });
});

test('round-trips a list and clears an emptied one', () => {
  withStorage(store => {
    persistCatalystItems(descriptor, 'root', new Set(['root.s.0', 'c.s.1']));
    assert.deepEqual([...loadCatalystItems(descriptor, 'root')].sort(), ['c.s.1', 'root.s.0']);
    persistCatalystItems(descriptor, 'root', new Set());
    assert.equal(store.size, 0);
  });
});

test('survives storage holding something that is not a list', () => {
  withStorage(store => {
    store.set(catalystItemsKey(descriptor, 'root'), '{"not":"a list"}');
    assert.equal(loadCatalystItems(descriptor, 'root').size, 0);
    store.set(catalystItemsKey(descriptor, 'root'), '[3]');
    assert.equal(loadCatalystItems(descriptor, 'root').size, 0);
  });
});

test('marking a place leaves every other place alone', () => {
  // Two recipes wanting the same hammer are two decisions: one of them may well want it consumed.
  const catalysts = new Set(['ring.s.0']);
  const added = withCatalystItem(catalysts, 'chevron.s.0', true);
  assert.deepEqual([...added].sort(), ['chevron.s.0', 'ring.s.0']);
  assert.deepEqual([...withCatalystItem(added, 'ring.s.0', false)], ['chevron.s.0']);
  assert.deepEqual([...catalysts], ['ring.s.0']);
  // Setting what is already set is not a toggle: the caller decides which way it goes.
  assert.deepEqual([...withCatalystItem(added, 'chevron.s.0', true)].sort(), [
    'chevron.s.0',
    'ring.s.0',
  ]);
});

test('the row menu opens on the gestures the tree uses', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const row = screen.slice(screen.indexOf('const OutlineRow = React.memo'));
  // Right click reaches the DOM only through a Pressable: TouchableOpacity does not forward
  // onContextMenu, so the web menu never opened at all.
  assert.match(row, /onContextMenu/u);
  assert.match(row, /<Pressable[\s\S]*?\{\.\.\.contextMenuProps\}/u);
  assert.doesNotMatch(
    row.slice(0, row.indexOf('{...contextMenuProps}')),
    /<TouchableOpacity/u,
  );
  // And long press on a phone, the same delay as a node's menu on the canvas. Both gestures carry
  // where they happened, so the menu opens beside the row rather than in the middle of the screen.
  assert.match(row, /onLongPress=\{event => \{/u);
  assert.match(row, /delayLongPress=\{450\}/u);
  assert.match(row, /onMenu\(row, \{x: touch\.pageX, y: touch\.pageY\}\)/u);
  assert.match(row, /onMenu\(row, \{x: event\.clientX \?\? 0, y: event\.clientY \?\? 0\}\)/u);
});

test('the tree and the list share one idea of what a tool is', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // Both screens read the live list through the same store, so a tool marked in one is a tool in the
  // other at once -- two loaded copies would each keep their own and drift apart.
  assert.match(screen, /useCatalystItems\(data\.descriptor, snapshot\?\.rootKey \?\? null\)/u);
  assert.match(graph, /useCatalystItems\(\s*data\.descriptor,\s*graphRootKey \?\? null,\s*\)/u);
  // And the resources list acts through the graph rather than keeping its own version of the action.
  assert.match(screen, /onTreatAsTool\(menuNode, !isCatalyst\(menuNode\)\)/u);
  assert.doesNotMatch(screen, /persistCatalystItems|withCatalystItem/u);
});

test('the same menu opens in both places, with the canvas actions left out', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // One component: the alternatives, the recipe and the tool action are written once and look the
  // same wherever they are opened from.
  assert.match(screen, /<NodeActionMenu/u);
  assert.match(graph, /<NodeActionMenu/u);
  assert.match(screen, /onSelectAlternative=\{selectedKey =>/u);
  assert.match(screen, /onChangeRecipe\(menuNode\)/u);
  // The list has nothing to focus or lay out, so it passes no branch focus or root controls.
  assert.doesNotMatch(screen, /onFocusBranch|onToggleRootControls/u);
});

test('a tool stays on the materials list, marked rather than taken away', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const outline = readFileSync(new URL('./resourceOutline.ts', import.meta.url), 'utf8');
  // Taking the row away left a hole where something is plainly needed. It stays where it sits, with
  // the canvas's own dashed teal and subheading, and without a tick or an amount: seeing it is the
  // point, and gathering it is a job on the other list.
  assert.match(outline, /if \(kind === 'consumed'\) return \[\.\.\.rows\]/u);
  assert.match(screen, /tool=\{catalysts\.has\(row\.nodeId\)\}/u);
  assert.match(screen, /counts=\{!catalysts\.has\(row\.nodeId\)\}/u);
  assert.match(screen, /tool && styles\.toolRow/u);
  assert.match(screen, /borderColor: theme\.transfer,\s*borderStyle: 'dashed',\s*backgroundColor: '#15302f'/u);
  assert.match(screen, /'tool\/catalyst'/u);
  assert.match(screen, /\{counts && \(/u);
  assert.match(screen, /: !counts \? null : \(/u);
});

test('the canvas says tool rather than reusable, and marks one node', () => {
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  assert.match(graph, /'  tool\/catalyst'/u);
  assert.doesNotMatch(graph, /'  reusable'/u);
  // One place picked is one place marked. Sweeping every node asking for the same item turned one
  // decision into an opinion about the rest of the tree.
  assert.doesNotMatch(graph, /applyManualRetentionOverrideToTree/u);
  assert.match(graph, /setCatalyst\(node, isTool\);\s*node\.nonConsumed = isTool;/u);
  // And it comes back when the branch is built again, which is what makes it survive a collapse.
  assert.match(graph, /catalystsRef\.current\.has\(`\$\{sourceId\}\.\$\{String\(i\)\}`\)/u);
});

test('the tools list counts what is needed rather than what is ticked', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // A tool is not gathered, it is owned. With no ticks on the list a percentage could only ever read
  // zero, so the tools list says how many the build needs and leaves the bar to the materials.
  assert.match(screen, /needed by this build/u);
  assert.match(screen, /\{listKind === 'consumed' && \(/u);
  assert.match(screen, /kind === 'catalyst'\s*\?\s*String\(nodeIds\.length\)/u);
});

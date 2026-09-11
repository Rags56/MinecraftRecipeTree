import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  catalystItemIdentity,
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

test('starts with nothing on the tools list', () => {
  withStorage(() => {
    // A pack calling an item reusable describes the craft, not how someone wants to shop for it, so
    // the list starts empty and fills only with what the user puts there.
    assert.equal(loadCatalystItems(descriptor).size, 0);
  });
});

test('remembers the choice per pack rather than per tree', () => {
  // A tool is a tool in every build in a pack, so the choice is not scoped to one root item. A
  // republished pack is a different list, as it is for everything else keyed by publication.
  assert.equal(catalystItemsKey(descriptor), 'resourceCatalysts:gt-new-horizons:b0c08e74');
  assert.notEqual(
    catalystItemsKey(descriptor),
    catalystItemsKey({...descriptor, publicationId: 'deadbeef'}),
  );
  assert.notEqual(catalystItemsKey(descriptor), catalystItemsKey({...descriptor, slug: 'other'}));
});

test('round-trips a list and clears an emptied one', () => {
  withStorage(store => {
    persistCatalystItems(descriptor, new Set(['item|hammer', '#forge:tools/wrench']));
    assert.deepEqual(
      [...loadCatalystItems(descriptor)].sort(),
      ['#forge:tools/wrench', 'item|hammer'],
    );
    persistCatalystItems(descriptor, new Set());
    assert.equal(store.size, 0);
  });
});

test('survives storage holding something that is not a list', () => {
  withStorage(store => {
    store.set(catalystItemsKey(descriptor), '{"not":"a list"}');
    assert.equal(loadCatalystItems(descriptor).size, 0);
    store.set(catalystItemsKey(descriptor), '[3]');
    assert.equal(loadCatalystItems(descriptor).size, 0);
  });
});

test('a tag requirement and a concrete one are separate choices', () => {
  const anyWrench = catalystItemIdentity({
    key: 'item|wrench',
    tag: 'forge:tools/wrench',
    variantCount: 4,
  });
  const exact = catalystItemIdentity({key: 'item|wrench'});
  assert.notEqual(anyWrench, exact);
  // Every place in the tree asking for the same thing follows the one choice, which is the point of
  // keying by item: a tool moved once does not have to be moved again further down.
  assert.equal(catalystItemIdentity({key: 'item|wrench', variantCount: 1}), exact);
});

test('moving an item on and off the list leaves the given set alone', () => {
  const catalysts = new Set(['item|hammer']);
  const added = withCatalystItem(catalysts, 'item|wrench', true);
  assert.deepEqual([...added].sort(), ['item|hammer', 'item|wrench']);
  assert.deepEqual([...withCatalystItem(added, 'item|hammer', false)], ['item|wrench']);
  assert.deepEqual([...catalysts], ['item|hammer']);
  // Setting what is already set is not a toggle: the caller decides which way it goes.
  assert.deepEqual([...withCatalystItem(added, 'item|wrench', true)].sort(), [
    'item|hammer',
    'item|wrench',
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
  assert.match(screen, /useCatalystItems\(data\.descriptor\)/u);
  assert.match(graph, /useCatalystItems\(data\.descriptor\)/u);
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

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  loadCompletedResources,
  persistCompletedResources,
  prunedCompletedResources,
  resourceCompletionPercentage,
  resourceIdentity,
  resourceProgressKey,
  sortResourcesForChecklist,
  toggleCompletedResource,
} from './resourceProgress.ts';

const descriptor = {slug: 'gt-new-horizons', publicationId: 'b0c08e74'};
const resource = key => ({key, amount: 1, variants: 1});

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

test('scopes progress to the pack and the tree it belongs to', () => {
  const stargate = resourceProgressKey(descriptor, 'item|stargate');
  assert.notEqual(stargate, resourceProgressKey(descriptor, 'item|sponge'));
  assert.notEqual(
    stargate,
    resourceProgressKey({slug: 'meatballcraft', publicationId: '04c674ab'}, 'item|stargate'),
  );
  // A republished pack renumbers recipes, so its progress is a different list too.
  assert.notEqual(
    stargate,
    resourceProgressKey({...descriptor, publicationId: 'deadbeef'}, 'item|stargate'),
  );
});

test('round-trips a checklist', () => {
  withStorage(() => {
    persistCompletedResources(descriptor, 'root', new Set(['iron', 'gold']));
    assert.deepEqual(
      [...loadCompletedResources(descriptor, 'root')].sort(),
      ['gold', 'iron'],
    );
  });
});

test('stores an emptied checklist as nothing rather than an empty list', () => {
  withStorage(store => {
    persistCompletedResources(descriptor, 'root', new Set(['iron']));
    persistCompletedResources(descriptor, 'root', new Set());
    assert.equal(store.size, 0);
    assert.equal(loadCompletedResources(descriptor, 'root').size, 0);
  });
});

test('survives storage holding something that is not a checklist', () => {
  withStorage(store => {
    store.set(resourceProgressKey(descriptor, 'root'), '{"not":"a list"}');
    assert.equal(loadCompletedResources(descriptor, 'root').size, 0);
    store.set(resourceProgressKey(descriptor, 'root'), '[1,2,3]');
    assert.equal(loadCompletedResources(descriptor, 'root').size, 0);
  });
});

test('ticking a resource toggles it without mutating what it was given', () => {
  const completed = new Set(['iron']);
  const added = toggleCompletedResource(completed, 'gold');
  assert.deepEqual([...added].sort(), ['gold', 'iron']);
  assert.deepEqual([...completed], ['iron']);
  assert.deepEqual([...toggleCompletedResource(added, 'iron')], ['gold']);
});

test('counts progress per resource, not per item', () => {
  const resources = [resource('iron'), resource('gold'), resource('copper'), resource('tin')];
  assert.equal(resourceCompletionPercentage(resources, new Set()), 0);
  assert.equal(resourceCompletionPercentage(resources, new Set(['iron'])), 25);
  assert.equal(
    resourceCompletionPercentage(resources, new Set(['iron', 'gold', 'copper', 'tin'])),
    100,
  );
  // Nothing to gather is not the same as everything gathered.
  assert.equal(resourceCompletionPercentage([], new Set(['iron'])), 0);
});

test('ignores ticks for resources the tree no longer needs', () => {
  const resources = [resource('iron'), resource('gold')];
  const stale = new Set(['iron', 'obsidian']);
  assert.deepEqual([...prunedCompletedResources(resources, stale)], ['iron']);
  // A percentage can never exceed its own list because of a resource that left the tree.
  assert.equal(
    resourceCompletionPercentage(resources, prunedCompletedResources(resources, stale)),
    50,
  );
  // Unchanged checklists keep their identity, so this can be used in a render path.
  const live = new Set(['iron']);
  assert.equal(prunedCompletedResources(resources, live), live);
  assert.equal(prunedCompletedResources(resources, new Set()).size, 0);
});

test('the outline stays put when a row is acted on', () => {
  const source = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // Folding a section and choosing a recipe both go through the tree, and neither leaves the tab:
  // the tree updates behind and the published snapshot brings the change back here.
  const handlers = source.slice(source.indexOf('const toggleRow'), source.indexOf('const tickRow'));
  assert.match(handlers, /onToggleNode\(node\)/u);
  assert.doesNotMatch(handlers, /setTab\(/u);
});

test('the resources screen paints an opaque background', () => {
  // Inactive workspace panes are absolutely positioned and faded rather than unmounted, so a
  // transparent screen smears whatever is still painted behind it as it scrolls.
  const source = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /screen: \{[^}]*backgroundColor: theme\.bg/u);
  assert.match(source, /empty: \{[\s\S]*?backgroundColor: theme\.bg/u);
});

test('a recipe lookup started from the resources tab is not cancelled as a navigation away', () => {
  // openPicker sets its loading state, then awaits the recipes. Cancelling on any tab that is not
  // the graph bumped the request id, so a lookup started from the resources list discarded its
  // own result and the picker never opened.
  const source = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /TABS_DRIVING_THE_PICKER: ReadonlySet<Tab> = new Set<Tab>\(\['graph', 'resources'\]\)/u);
  assert.match(
    source,
    /if \(!TABS_DRIVING_THE_PICKER\.has\(tab\) && pickerLookup\) cancelPickerLookup\(\);/u,
  );
  assert.doesNotMatch(source, /if \(tab !== 'graph' && pickerLookup\)/u);
});

test('sorts the checklist by how much is needed, unknown amounts last', () => {
  const sorted = sortResourcesForChecklist([
    {key: 'copper', amount: 12, variants: 1},
    {key: 'unknown-a', amount: null, variants: 1},
    {key: 'iron', amount: 640, variants: 1},
    {key: 'gold', amount: 64, variants: 1},
    {key: 'unknown-b', amount: null, variants: 1},
  ]);
  assert.deepEqual(
    sorted.map(entry => entry.key),
    ['iron', 'gold', 'copper', 'unknown-a', 'unknown-b'],
  );
});

test('keeps equal amounts in a stable order and leaves its input alone', () => {
  const resources = [
    {key: 'zinc', amount: 8, variants: 1},
    {key: 'apatite', amount: 8, variants: 1},
  ];
  assert.deepEqual(
    sortResourcesForChecklist(resources).map(entry => entry.key),
    ['apatite', 'zinc'],
  );
  assert.deepEqual(resources.map(entry => entry.key), ['zinc', 'apatite']);
  assert.deepEqual(sortResourcesForChecklist([]), []);
});

test('a tree edit re-renders the rows it changed, not the whole checklist', () => {
  const source = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /const OutlineRow = React\.memo\(/u);
  // The handlers a memoized row receives must not change identity with every published snapshot,
  // so the snapshot is read through a ref rather than closed over.
  assert.match(source, /const snapshotRef = useRef\(snapshot\);/u);
  assert.match(source, /snapshotRef\.current = snapshot;/u);
  assert.match(source, /const nodeById = useCallback\([\s\S]{0,240}?\}, \[\]\);/u);
  // And the lookup that a tap starts has to be visible from here, not only on the canvas.
  assert.match(source, /pending \? \(\s*<ActivityIndicator/u);
});

test('clearing the last tree clears the checklist with it', () => {
  // A tree leaves its totals published when it unmounts so swapping between open trees does not
  // blank this screen in the gap, which meant a cleared workspace kept showing the tree's
  // resources. Nothing else republishes once the last tree is gone.
  const source = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /if \(openGraphTrees\.length === 0\) publishGraphTotals\(null\);/u,
  );
});

test('a tap that starts no lookup leaves no spinner behind', () => {
  const source = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // An item with no recipe to find starts no lookup, so a spinner keyed only on the tap would
  // have nothing to stop it: the one row guaranteed never to load would spin forever.
  assert.match(source, /const pendingLookupKey = lookupPending \? pendingKey : null;/u);
  assert.match(source, /pending=\{pendingLookupKey === row\.nodeId\}/u);
  assert.doesNotMatch(source, /pending=\{pendingKey === /u);
});

test('an item with nowhere to go says so instead of looking ignored', () => {
  const source = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  const tap = source.slice(source.indexOf('const choices = choicesFor(node.key, graphDirection'));
  assert.match(tap.slice(0, 600), /has no recipe in this pack; it has to be gathered\./u);
  assert.match(tap.slice(0, 600), /Nothing in this pack uses/u);
});

test('a tag requirement and a concrete one are separate entries, not one row twice', () => {
  // Totals group by logical identity: "any iron ingot" and that exact ingot share an item key but
  // are different requirements. Keying rows by the item key collided them into one list entry,
  // so ticking either ticked both and React saw two children with the same key.
  const concrete = {key: 'item|iron_ingot', amount: 8, variants: 1};
  const anyIngot = {key: 'item|iron_ingot', amount: 4, variants: 6, tag: 'forge:ingots/iron'};
  assert.notEqual(resourceIdentity(concrete), resourceIdentity(anyIngot));

  const resources = [concrete, anyIngot];
  const completed = new Set([resourceIdentity(concrete)]);
  assert.equal(resourceCompletionPercentage(resources, completed), 50);
  assert.deepEqual([...prunedCompletedResources(resources, completed)], [resourceIdentity(concrete)]);
});

test('the resources tab is mounted exactly once', () => {
  // It was mounted twice: the anchor the pane was inserted above is also the last line of the
  // pane itself, so inserting it a second time matched and appended a duplicate, and both copies
  // rendered on the same screen.
  const source = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
  const mounts = source.match(/<ResourcesScreen\b/gu) ?? [];
  assert.equal(mounts.length, 1, `ResourcesScreen is mounted ${mounts.length} times`);
});

test('exporting the list is an action on the list, not on the graph settings', () => {
  const resources = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  assert.match(resources, /onPress=\{snapshot\.onExportCsv\}/u);
  // Gone from both graph surfaces: the list it exports has a tab of its own now.
  assert.doesNotMatch(graph, /label="Export resources CSV"/u);
  assert.doesNotMatch(graph, /key: 'export-csv'/u);
  // HQ PNG renders the canvas, so that one stays with the graph.
  assert.match(graph, /key: 'export-png'/u);
});

test('the checklist states how many of the root it is for', () => {
  // Every amount in the list is relative to it, so a list that does not say it is ambiguous.
  const resources = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    resources,
    /formatIngredientQuantity\(snapshot\.rootKey, snapshot\.rootAmount\)/u,
  );
  const graph = readFileSync(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
  // The planned amount wins over the node's own, and it is edited in place, so version has to be
  // a dependency of the publish or the tab keeps showing the figure it was opened with.
  assert.match(
    graph,
    /rootAmount: root\?\.productionPlan\?\.amount \?\? root\?\.amount \?\? 1/u,
  );
  const publish = graph.slice(graph.indexOf('publishGraphTotals({'));
  assert.match(publish.slice(0, publish.indexOf(']);')), /^\s+version,$/mu);
});

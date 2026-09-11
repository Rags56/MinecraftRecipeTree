import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  loadCompletedResources,
  persistCompletedResources,
  countableCompleted,
  gatheredPercentage,
  resourceProgressKey,
  withResourcesCompleted,
} from './resourceProgress.ts';

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
    persistCompletedResources(descriptor, 'root', new Set(['root.s.0', 'root.s.1.s.2']));
    assert.deepEqual(
      [...loadCompletedResources(descriptor, 'root')].sort(),
      ['root.s.0', 'root.s.1.s.2'],
    );
  });
});

test('stores an emptied checklist as nothing rather than an empty list', () => {
  withStorage(store => {
    persistCompletedResources(descriptor, 'root', new Set(['root.s.0']));
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

test('drops a checklist written before ticks recorded places in the tree', () => {
  withStorage(store => {
    const legacy = `resourceProgress:${descriptor.slug}:${descriptor.publicationId}:root`;
    store.set(legacy, JSON.stringify(['item|hieroglyph']));
    // An item identity stood for however many places in the tree wanted that item, so there is no
    // telling which of them were gathered. It is cleared rather than mistranslated into ticks.
    assert.equal(loadCompletedResources(descriptor, 'root').size, 0);
    assert.equal(store.has(legacy), false);
  });
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

test('two places wanting the same item count as two, and tick apart', () => {
  // The reported bug: a ring block and a chevron block each needing eighty hieroglyphs are a
  // hundred and sixty between them. Keyed by item they were one entry, so ticking the ring block's
  // eighty struck off the chevron's as well and the list read finished at half gathered.
  const gatherable = ['ring.s.0', 'chevron.s.0'];
  const ringDone = new Set(['ring.s.0']);
  assert.equal(gatheredPercentage(gatherable, ringDone), 50);
  assert.deepEqual([...countableCompleted(gatherable, ringDone)], ['ring.s.0']);
  assert.equal(gatheredPercentage(gatherable, new Set(gatherable)), 100);
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

test('ticks a whole branch in one write rather than one key at a time', () => {
  const completed = new Set(['c.s.2']);
  const branch = ['c.s.0', 'c.s.1', 'c.s.2'];
  const all = withResourcesCompleted(completed, branch, true);
  assert.deepEqual([...all].sort(), ['c.s.0', 'c.s.1', 'c.s.2']);
  // Unticking the section clears the same set, and neither call mutates what it was given.
  assert.deepEqual([...withResourcesCompleted(all, branch, false)], []);
  assert.deepEqual([...completed], ['c.s.2']);
});

test('a section is ticked only when its whole branch is', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // Derived, not stored: unticking one child has to unsettle the section above it, and a stored
  // section tick would quietly disagree with the branch underneath.
  assert.match(screen, /done: nodeIds\.length > 0 && ticked === nodeIds\.length/u);
  assert.match(screen, /partial: ticked > 0 && ticked < nodeIds\.length/u);
  assert.doesNotMatch(screen, /tickSpacer/u);
});

test('counts progress per gatherable thing, and folding a branch does not change it', () => {
  // The bug this replaces: progress was measured against the flat totals, where a folded branch
  // appears as itself rather than as what it holds -- so a branch that was ticked and then folded
  // had every one of its ticks discounted and the whole list read zero.
  const gatherable = ['c.s.0', 'c.s.1', 'root.s.1'];
  assert.equal(gatheredPercentage(gatherable, new Set()), 0);
  assert.equal(gatheredPercentage(gatherable, new Set(['c.s.0', 'c.s.1'])), 67);
  assert.equal(gatheredPercentage(gatherable, new Set(gatherable)), 100);
  // Nothing to gather is not the same as everything gathered.
  assert.equal(gatheredPercentage([], new Set(['c.s.0'])), 0);
});

test('keeps a tick for something the tree no longer needs, but cannot count it', () => {
  const gatherable = ['c.s.0', 'c.s.1'];
  const stored = new Set(['c.s.0', 'gone.s.3']);
  assert.deepEqual([...countableCompleted(gatherable, stored)], ['c.s.0']);
  assert.equal(
    gatheredPercentage(gatherable, countableCompleted(gatherable, stored)),
    50,
  );
  // Unchanged sets keep their identity, so this can be used in a render path.
  const live = new Set(['c.s.0']);
  assert.equal(countableCompleted(gatherable, live), live);
  assert.equal(countableCompleted(gatherable, new Set()).size, 0);
});

test('the checklist measures the tree rather than the flat totals', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // Walked from the tree's root, and per list: each of Items and Catalysts counts its own work,
  // so one machine cannot read as far as four hundred ingots.
  assert.match(
    screen,
    /gatherableNodeIdsUnder\(snapshot\.root, \{\s*byproductCoverageByNode: snapshot\.totals\.byproductCoverageByNode,\s*kind,\s*catalysts,\s*\}\)/u,
  );
  assert.match(screen, /gatheredPercentage\(gatherable, countable\)/u);
  // totals.inputs still feeds the CSV, but nothing about progress depends on it any more.
  assert.doesNotMatch(screen, /totals\.inputs/u);
});

test('a tick is written once, outside the state updater', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const handler = screen.slice(screen.indexOf('const tickRow = useCallback('));
  const body = handler.slice(0, handler.indexOf('  );') + 4);
  // React may call an updater speculatively or twice, so a save cannot live inside one.
  assert.doesNotMatch(body, /setCompleted\(current =>/u);
  assert.match(body, /setCompleted\(next\);\s*\n\s*persistCompletedResources\(/u);
});

test('reloading progress follows the list being tracked, not the descriptor object', () => {
  const screen = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  // The context hands out a new descriptor object on unrelated updates; keying the reload on it
  // threw away in-memory ticks on each of those and read storage again behind them.
  assert.match(screen, /const progressKey = rootKey \? resourceProgressKey\(/u);
  assert.match(screen, /\}, \[progressKey\]\);/u);
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  loadCompletedResources,
  persistCompletedResources,
  prunedCompletedResources,
  resourceCompletionPercentage,
  resourceProgressKey,
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

test('the resources list stays put when a resource is opened in the tree', () => {
  const source = readFileSync(
    new URL('../components/ResourcesScreen.tsx', import.meta.url),
    'utf8',
  );
  const handler = source.slice(source.indexOf('const openInTree'));
  const body = handler.slice(0, handler.indexOf('  );') + 4);
  assert.match(body, /onResourceTap\(total\)/u);
  // Switching tabs here would take the user away from the list they are working through; the
  // tree updates behind and the published totals bring the change back to this screen.
  assert.doesNotMatch(body, /setTab\(/u);
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

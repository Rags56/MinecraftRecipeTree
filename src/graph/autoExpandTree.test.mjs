import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {autoExpandPreferredNodes} from './autoExpandTree.ts';

const graphScreenSource = await readFile(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');

function item(id, key, options = {}) {
  return {id, key, ancestors: [], ...options};
}

test('auto expand reports completed recipes and follows their newly revealed inputs', async () => {
  const existingLeaf = item('root.s.0', 'item|test:existing-leaf');
  const root = item('root', 'item|test:root', {
    source: {id: 'root.s', kind: 'recipe', inputs: [existingLeaf]},
  });
  const choices = new Map([
    ['item|test:existing-leaf', 'first'],
    ['item|test:new-leaf', 'second'],
  ]);

  const expanded = await autoExpandPreferredNodes(
    root,
    node => choices.get(node.key) ?? null,
    async (node, choice) => {
      node.source = {
        id: `${node.id}.s`,
        kind: 'recipe',
        catTitle: choice,
        inputs:
          choice === 'first'
            ? [item(`${node.id}.s.0`, 'item|test:new-leaf')]
            : [],
      };
    },
  );

  assert.deepEqual(
    expanded.map(node => [node.key, node.source?.catTitle]),
    [
      ['item|test:existing-leaf', 'first'],
      ['item|test:new-leaf', 'second'],
    ],
  );
});

test('auto expand skips cyclic, loading, deferred, and unpreferred nodes', async () => {
  const children = [
    item('root.s.0', 'item|test:cyclic', {cyclic: true}),
    item('root.s.1', 'item|test:loading', {loading: true}),
    item('root.s.2', 'item|test:deferred', {
      deferredRecipeExpansion: {ref: [1, 2]},
    }),
    item('root.s.3', 'item|test:no-preference'),
  ];
  const root = item('root', 'item|test:root', {
    source: {id: 'root.s', kind: 'recipe', inputs: children},
  });
  const attempted = [];

  const expanded = await autoExpandPreferredNodes(
    root,
    node => (node.key === 'item|test:no-preference' ? null : 'recipe'),
    async node => {
      attempted.push(node.key);
    },
  );

  assert.deepEqual(expanded, []);
  assert.deepEqual(attempted, []);
});

test('auto expand does not report recipes that failed to attach a source', async () => {
  const root = item('root', 'item|test:root');
  const expanded = await autoExpandPreferredNodes(
    root,
    () => 'unavailable-recipe',
    async () => {},
  );

  assert.deepEqual(expanded, []);
});

test('paces an unlimited traversal in batches without dropping newly revealed nodes', async () => {
  const root = item('root', 'item|test:0');
  const batches = [];

  const expanded = await autoExpandPreferredNodes(
    root,
    node => Number(node.key.split(':').at(-1)) < 5 ? 'recipe' : null,
    async node => {
      const index = Number(node.key.split(':').at(-1));
      node.source = {
        id: `${node.id}.s`,
        kind: 'recipe',
        inputs: [item(`${node.id}.s.0`, `item|test:${index + 1}`)],
      };
    },
    {
      batchSize: 2,
      onBatch: progress => batches.push({...progress}),
    },
  );

  assert.equal(expanded.length, 5);
  assert.deepEqual(batches, [
    {appliedSourceCount: 2, expandedRecipeCount: 2},
    {appliedSourceCount: 4, expandedRecipeCount: 4},
    {appliedSourceCount: 5, expandedRecipeCount: 5},
  ]);
});

test('stops between paced batches when the active run is cancelled', async () => {
  const root = item('root', 'item|test:0');
  let running = true;

  const expanded = await autoExpandPreferredNodes(
    root,
    node => Number(node.key.split(':').at(-1)) < 5 ? 'recipe' : null,
    async node => {
      const index = Number(node.key.split(':').at(-1));
      node.source = {
        id: `${node.id}.s`,
        kind: 'recipe',
        inputs: [item(`${node.id}.s.0`, `item|test:${index + 1}`)],
      };
    },
    {
      batchSize: 2,
      shouldContinue: () => running,
      onBatch: () => {
        running = false;
      },
    },
  );

  assert.equal(expanded.length, 2);
});

test('community auto expand stays enabled after a completed run until toggled off', () => {
  const toggleStart = graphScreenSource.indexOf('const toggleCommunityAutoExpand = useCallback');
  const toggleEnd = graphScreenSource.indexOf('const updateUseByproducts', toggleStart);
  const toggleSource = graphScreenSource.slice(toggleStart, toggleEnd);

  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart);
  assert.match(
    toggleSource,
    /if \(communityAutoExpandRef\.current\) \{[\s\S]*communityPreferredSourcesRef\.current = \{\};[\s\S]*setCommunityAutoExpand\(false\);[\s\S]*?return;\n    \}\n\n    const requestId/u,
  );
  assert.match(
    toggleSource,
    /finally \{[\s\S]*setCommunityAutoExpandLoading\(false\);/u,
  );
  assert.doesNotMatch(toggleSource, /finally \{[\s\S]*setCommunityAutoExpand\(false\);/u);
  assert.match(graphScreenSource, /communityAutoExpand\s*\? 'Auto expand on'/u);
});

test('asks about a node with no remembered recipe rather than walking past it', async () => {
  const root = {
    id: 'root', key: 'root', ancestors: [],
    source: {
      id: 'root.s', kind: 'recipe', inputs: [
        {id: 'a', key: 'favourited', ancestors: ['root']},
        {id: 'b', key: 'unfavourited', ancestors: ['root']},
      ],
    },
  };
  const asked = [];
  await autoExpandPreferredNodes(
    root,
    node => (node.key === 'favourited' ? {pick: node.key} : null),
    async node => {
      node.source = {id: `${node.id}.s`, kind: 'recipe', inputs: []};
    },
    {
      resolveMissingSource: async node => {
        asked.push(node.key);
        // Whatever answers the prompt attaches the source; the walk reads it back off the node.
        // Only the item actually asked about gains a child, or the fixture grows forever.
        node.source = {
          id: `${node.id}.s`,
          kind: 'recipe',
          inputs:
            node.key === 'unfavourited'
              ? [{id: 'b1', key: 'chosen-child', ancestors: ['root', node.key]}]
              : [],
        };
        return true;
      },
    },
  );
  // The favourited node is never asked about, and the walk continues into what the answer
  // revealed -- asking about that too, since it has no remembered recipe either.
  assert.deepEqual(asked, ['unfavourited', 'chosen-child']);
  assert.equal(root.source.inputs[1].source.inputs[0].key, 'chosen-child');
});

test('a dismissed prompt stops the run instead of asking for every node left', async () => {
  const root = {
    id: 'root', key: 'root', ancestors: [],
    source: {
      id: 'root.s', kind: 'recipe', inputs: [
        {id: 'a', key: 'one', ancestors: ['root']},
        {id: 'b', key: 'two', ancestors: ['root']},
        {id: 'c', key: 'three', ancestors: ['root']},
      ],
    },
  };
  const asked = [];
  await autoExpandPreferredNodes(root, () => null, async () => {}, {
    resolveMissingSource: async node => {
      asked.push(node.key);
      return false;
    },
  });
  assert.equal(asked.length, 1, `asked ${asked.length} times after a dismissal`);
});

test('without a prompt handler it still skips what nobody favourited', async () => {
  const root = {
    id: 'root', key: 'root', ancestors: [],
    source: {id: 'root.s', kind: 'recipe', inputs: [{id: 'a', key: 'x', ancestors: ['root']}]},
  };
  const expanded = await autoExpandPreferredNodes(root, () => null, async () => {});
  assert.deepEqual(expanded, []);
});

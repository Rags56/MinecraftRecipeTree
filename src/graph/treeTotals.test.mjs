import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_USE_BYPRODUCTS,
  useByproductsFromStoredValue,
} from './byproductPreference.ts';
import {createDeferredRecipeSourceResolver} from './expansionOwnership.ts';
import {calculateTreeTotals} from './treeTotals.ts';

test('byproduct credits default on while preserving an explicit opt-out', () => {
  assert.equal(DEFAULT_USE_BYPRODUCTS, true);
  assert.equal(useByproductsFromStoredValue(undefined), true);
  assert.equal(useByproductsFromStoredValue(null), true);
  assert.equal(useByproductsFromStoredValue('1'), true);
  assert.equal(useByproductsFromStoredValue('0'), false);
});

const item = (id, key, amount, options = {}) => ({
  id,
  key,
  amount,
  ancestors: [],
  ...options,
});

test('a root production target scales every downstream ingredient by recipe yield', () => {
  const root = item('root', 'item|test:plate', 2, {
    productionPlan: {amount: 25, windowSeconds: 60},
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['item|test:plate', 2]]]},
      inputs: [item('root.s.0', 'item|test:ingot', 3)],
    },
  });

  const totals = calculateTreeTotals(root);
  assert.equal(totals.requiredByNode.get('root'), 25);
  assert.equal(totals.requiredByNode.get('root.s.0'), 39);
  assert.equal(totals.inputs[0].amount, 39);
});

test('singleton ingredients sharing an OreDictionary tag remain exact totals', () => {
  const taggedFood = (id, key) =>
    item(id, key, 1, {
      tag: 'ore:listAllFood',
      alternatives: [key],
      variantCount: 1,
    });
  const root = item('root', 'item|avaritia:ultimate_stew', 16, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['item|avaritia:ultimate_stew', 16]]]},
      inputs: [
        taggedFood('root.s.0', 'item|test:intense_meatball_pasta'),
        taggedFood('root.s.1', 'item|test:burned_enchanted_feather'),
        taggedFood('root.s.2', 'item|test:intense_meatball_pasta'),
        taggedFood('root.s.3', 'item|test:nice_clean_salad'),
      ],
    },
  });

  const totals = calculateTreeTotals(root);
  const inputs = new Map(totals.inputs.map(total => [total.key, total.amount]));
  assert.deepEqual(inputs, new Map([
    ['item|test:intense_meatball_pasta', 2],
    ['item|test:burned_enchanted_feather', 1],
    ['item|test:nice_clean_salad', 1],
  ]));
});

test('fluid output requirements pay for complete recipe cycles', () => {
  const root = item('root', 'fluid|contenttweaker:protodermis', 10_000, {
    productionPlan: {amount: 1, windowSeconds: 1},
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['fluid|contenttweaker:protodermis', 10_000]]]},
      inputs: [item('root.s.0', 'custom|mana', 20_000)],
    },
  });

  const totals = calculateTreeTotals(root);
  assert.equal(totals.requiredByNode.get('root'), 1);
  assert.equal(totals.requiredByNode.get('root.s.0'), 20_000);
  assert.equal(totals.inputs[0].amount, 20_000);
});

test('retained items normalize to one in both the tree and prerequisite totals', () => {
  const catalystA = item('root.s.0', 'item|test:catalyst', 2, {
    nonConsumed: true,
    source: {
      id: 'root.s.0.s',
      kind: 'recipe',
      recipe: {out: [[['item|test:catalyst', 1]]]},
      inputs: [item('root.s.0.s.0', 'item|test:catalyst_core', 2)],
    },
  });
  const catalystB = item('root.s.1', 'item|test:catalyst', 5, {nonConsumed: true});
  const root = item('root', 'item|test:output', 10, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['item|test:output', 1]]]},
      inputs: [catalystA, catalystB],
    },
  });

  const totals = calculateTreeTotals(root);
  assert.deepEqual(totals.inputs, [
    {
      key: 'item|test:catalyst_core',
      amount: 2,
      variants: 1,
      tag: undefined,
    },
  ]);
  assert.equal(totals.prerequisites.length, 1);
  assert.equal(totals.prerequisites[0].amount, 1);
  assert.equal(totals.requiredByNode.get(catalystA.id), 1);
  assert.equal(totals.requiredByNode.get(catalystB.id), 1);
});

test('durability tools scale by usable crafts instead of by ingredient consumption', () => {
  const tool = item('root.s.0', 'item|test:hammer', 1, {
    nonConsumed: true,
    retentionMode: 'durability',
    retentionUses: 100,
  });
  const root = item('root', 'item|test:plate', 1, {
    productionPlan: {amount: 250, windowSeconds: 60},
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['item|test:plate', 1]]]},
      inputs: [tool],
    },
  });

  const totals = calculateTreeTotals(root);
  assert.equal(totals.requiredByNode.get(tool.id), 3);
  assert.deepEqual(totals.prerequisites, [
    {
      key: 'item|test:hammer',
      amount: 3,
      variants: 1,
      tag: undefined,
    },
  ]);
});

test('expand-once totals virtually traverse every deferred recipe occurrence', () => {
  const ownerOre = item('root.s.0.s.0', 'item|test:ore', 3);
  const owner = item('root.s.0', 'item|test:shared', 1, {
    source: {
      id: 'root.s.0.s',
      kind: 'recipe',
      ref: [4, 2],
      recipe: {out: [[['item|test:shared', 1]]]},
      inputs: [ownerOre],
    },
  });
  const deferred = item('root.s.1', 'item|test:shared', 2, {
    deferredRecipeExpansion: {ref: [4, 2]},
  });
  const root = item('root', 'item|test:result', 1, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      ref: [0, 0],
      recipe: {out: [[['item|test:result', 1]]]},
      inputs: [owner, deferred],
    },
  });

  const totals = calculateTreeTotals(root, false, {
    resolveDeferredRecipeSource: createDeferredRecipeSourceResolver(root, 'inputs'),
  });

  assert.deepEqual(totals.inputs, [
    {
      key: 'item|test:ore',
      amount: 9,
      variants: 1,
      tag: undefined,
    },
  ]);
  assert.equal(totals.requiredByNode.get(ownerOre.id), 3);
  assert.equal(totals.requiredByNode.get(deferred.id), 2);
  assert.equal(totals.requiredByNode.has(`${deferred.id}.v.0`), false);
});

test('byproduct credits reduce consumed inputs and leave residual outputs', () => {
  const root = item('root', 'item|test:machine', 1, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {
        out: [
          [['item|test:machine', 1]],
          [['item|test:dust', 3]],
        ],
      },
      inputs: [item('root.s.0', 'item|test:dust', 5)],
    },
  });

  const withoutCredits = calculateTreeTotals(root, false);
  assert.equal(withoutCredits.inputs[0].amount, 5);
  assert.equal(withoutCredits.byproducts[0].amount, 3);

  const withCredits = calculateTreeTotals(root, true);
  assert.equal(withCredits.inputs[0].amount, 2);
  assert.equal(withCredits.byproductCredits[0].amount, 3);
  assert.deepEqual(withCredits.byproducts, []);
  assert.deepEqual(withCredits.byproductCoverageByNode.get('root.s.0'), {
    nodeId: 'root.s.0',
    key: 'item|test:dust',
    requiredAmount: 5,
    creditedAmount: 3,
    remainingAmount: 2,
    allocations: [{producerSourceId: 'root.s', amount: 3}],
  });
});

test('byproduct coverage marks an ingredient complete and preserves excess output', () => {
  const root = item('root', 'item|test:machine', 1, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {
        out: [
          [['item|test:machine', 1]],
          [['item|test:dust', 3]],
        ],
      },
      inputs: [item('root.s.0', 'item|test:dust', 2)],
    },
  });

  const totals = calculateTreeTotals(root, true);
  assert.deepEqual(totals.inputs, []);
  assert.equal(totals.byproductCredits[0].amount, 2);
  assert.equal(totals.byproducts[0].amount, 1);
  assert.deepEqual(totals.byproductCoverageByNode.get('root.s.0'), {
    nodeId: 'root.s.0',
    key: 'item|test:dust',
    requiredAmount: 2,
    creditedAmount: 2,
    remainingAmount: 0,
    allocations: [{producerSourceId: 'root.s', amount: 2}],
  });
});

test('selected recipe output beyond the requested amount remains as a byproduct', () => {
  const root = item('root', 'item|test:plate', 3, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['item|test:plate', 4]]]},
      inputs: [item('root.s.0', 'item|test:ingot', 2)],
    },
  });

  const totals = calculateTreeTotals(root, true);
  assert.deepEqual(totals.byproducts, [
    {
      key: 'item|test:plate',
      amount: 1,
      variants: 1,
      tag: undefined,
    },
  ]);
});

test('selected recipe overproduction can supply another matching input', () => {
  const suppliedPlate = item('root.s.1', 'item|test:plate', 1);
  const root = item('root', 'item|test:machine', 1, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {out: [[['item|test:machine', 1]]]},
      inputs: [
        item('root.s.0', 'item|test:plate', 3, {
          source: {
            id: 'root.s.0.s',
            kind: 'recipe',
            recipe: {out: [[['item|test:plate', 4]]]},
            inputs: [item('root.s.0.s.0', 'item|test:ingot', 2)],
          },
        }),
        suppliedPlate,
      ],
    },
  });

  const totals = calculateTreeTotals(root, true);
  assert.deepEqual(totals.inputs, [
    {
      key: 'item|test:ingot',
      amount: 2,
      variants: 1,
      tag: undefined,
    },
  ]);
  assert.deepEqual(totals.byproducts, []);
  assert.deepEqual(totals.byproductCoverageByNode.get(suppliedPlate.id), {
    nodeId: suppliedPlate.id,
    key: suppliedPlate.key,
    requiredAmount: 1,
    creditedAmount: 1,
    remainingAmount: 0,
    allocations: [{producerSourceId: 'root.s.0.s', amount: 1}],
  });
});

test('a partially credited ingredient only crafts its remaining material balance', () => {
  const dust = item('root.s.0', 'item|test:dust', 5);
  const root = item('root', 'item|test:machine', 1, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {
        out: [
          [['item|test:machine', 1]],
          [['item|test:dust', 3]],
        ],
      },
      inputs: [dust],
    },
  });

  const initialTotals = calculateTreeTotals(root, true);
  const initialCoverage = initialTotals.byproductCoverageByNode.get(dust.id);
  dust.byproductFulfillment = {
    creditedAmount: initialCoverage.creditedAmount,
    allocations: initialCoverage.allocations,
  };
  dust.source = {
    id: 'root.s.0.s',
    kind: 'recipe',
    recipe: {out: [[['item|test:dust', 1]]]},
    inputs: [item('root.s.0.s.0', 'item|test:ore', 2)],
  };

  const expandedTotals = calculateTreeTotals(root, true);
  assert.deepEqual(expandedTotals.inputs, [
    {
      key: 'item|test:ore',
      amount: 4,
      variants: 1,
      tag: undefined,
    },
  ]);
  assert.equal(expandedTotals.byproductCredits[0].amount, 3);
  assert.deepEqual(expandedTotals.byproducts, []);
  assert.equal(expandedTotals.requiredByNode.get(dust.id), 2);
  assert.deepEqual(expandedTotals.byproductCoverageByNode.get(dust.id), {
    nodeId: dust.id,
    key: dust.key,
    requiredAmount: 5,
    creditedAmount: 3,
    remainingAmount: 2,
    allocations: [{producerSourceId: 'root.s', amount: 3}],
  });
});

test('byproduct credits require an exact logical ingredient identity', () => {
  const root = item('root', 'item|test:machine', 1, {
    source: {
      id: 'root.s',
      kind: 'recipe',
      recipe: {
        out: [
          [['item|test:machine', 1]],
          [['item|test:copper_a', 2, 'ore:ingotCopper']],
        ],
      },
      inputs: [
        item('root.s.0', 'item|test:copper_b', 4, {
          tag: 'ore:ingotCopper',
          alternatives: ['item|test:copper_a', 'item|test:copper_b'],
          variantCount: 2,
        }),
      ],
    },
  });

  const totals = calculateTreeTotals(root, true);
  assert.equal(totals.inputs[0].amount, 2);
  assert.equal(totals.inputs[0].tag, 'ore:ingotCopper');
  assert.equal(totals.byproductCredits[0].amount, 2);
});

test('stochastic selected outputs make quantitative tree totals unknown without using expected value', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts);
  try {
    const root = item('root', 'item|test:chance_output', 4, {
      source: {
        id: 'root.s',
        ref: [7, 11],
        kind: 'recipe',
        recipe: {out: [[['item|test:chance_output', 2, null, 0.5]]]},
        inputs: [item('root.s.0', 'item|test:input', 3)],
      },
    });

    const totals = calculateTreeTotals(root);
    assert.equal(totals.requiredByNode.get('root.s.0'), null);
    assert.equal(totals.inputs[0].amount, null);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /stochastic selected output/);
});

test('stochastic input consumption remains unknown while a duplicate catalyst preserves the minimum reservoir', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts);
  try {
    const root = item('root', 'item|test:result', 4, {
      source: {
        id: 'root.s',
        ref: [9, 13],
        kind: 'recipe',
        recipe: {out: [[['item|test:result', 1]]]},
        inputs: [
          item('root.s.0', 'item|test:labware', 1, {consumptionProbability: 0.5}),
          item('root.s.1', 'item|test:labware', 1, {nonConsumed: true}),
        ],
      },
    });

    const totals = calculateTreeTotals(root);
    assert.equal(totals.inputs[0].amount, null);
    assert.equal(totals.prerequisites[0].amount, 1);
    assert.equal(totals.requiredByNode.get('root.s.0'), null);
    assert.equal(totals.requiredByNode.get('root.s.1'), 1);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /stochastic input/);
});

test('stochastic byproducts remain unknown and cannot be consumed as material credits', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts);
  try {
    const root = item('root', 'item|test:machine', 1, {
      source: {
        id: 'root.s',
        ref: [8, 12],
        kind: 'recipe',
        recipe: {
          out: [
            [['item|test:machine', 1]],
            [['item|test:dust', 3, null, 0.25]],
          ],
        },
        inputs: [item('root.s.0', 'item|test:dust', 5)],
      },
    });

    const totals = calculateTreeTotals(root, true);
    assert.equal(totals.inputs[0].amount, 5);
    assert.deepEqual(totals.byproductCredits, []);
    assert.equal(totals.byproducts[0].amount, null);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 2);
  assert.match(String(warnings[0][0]), /Stochastic byproduct credits are disabled/);
  assert.match(String(warnings[1][0]), /material balance is unknown/);
});

test('calculates a 10,000-node dependency chain without recursive call-stack growth', () => {
  const nodeCount = 10_000;
  let root = item(`node-${nodeCount - 1}`, `item|test:node-${nodeCount - 1}`, 1);
  for (let index = nodeCount - 2; index >= 0; index -= 1) {
    const key = `item|test:node-${index}`;
    root = item(`node-${index}`, key, 1, {
      source: {
        id: `node-${index}.source`,
        kind: 'recipe',
        recipe: {out: [[[key, 1]]]},
        inputs: [root],
      },
    });
  }

  const totals = calculateTreeTotals(root);
  assert.equal(totals.requiredByNode.size, nodeCount);
  assert.deepEqual(totals.inputs, [
    {
      key: `item|test:node-${nodeCount - 1}`,
      amount: 1,
      variants: 1,
      tag: undefined,
    },
  ]);
});

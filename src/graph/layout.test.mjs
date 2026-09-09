import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPACT_LABEL_HEIGHT,
  COMPACT_ROOT_DIAMOND_SIZE,
  COMPACT_ROOT_SIZE,
  ROOT_SOURCE_ACTIONS_HEIGHT,
  ROOT_SOURCE_ACTIONS_WIDTH,
  ROOT_ATTACHED_ACTIONS_HEIGHT,
  ROOT_ATTACHED_ACTIONS_WIDTH,
  SOURCE_HEADER,
  SOURCE_EMC_PREVIEW_HEIGHT,
  SOURCE_EMC_PREVIEW_WIDTH,
  SOURCE_STRUCTURE_PREVIEW_HEIGHT,
  SOURCE_STRUCTURE_PREVIEW_WIDTH,
  attachedRootVisualX,
  byproductSupplyEdges,
  layoutTree,
  sourceNodeSize,
} from './layout.ts';

test('connects byproduct ingredients to their exact producing recipe once', () => {
  const producer = {
    id: 'producer.source',
    kind: 'source',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    item: {id: 'producer', key: 'item|test:producer'},
    source: {id: 'producer.source', kind: 'recipe', inputs: []},
  };
  const supplied = {
    id: 'supplied',
    kind: 'item',
    x: 220,
    y: 100,
    w: 52,
    h: 52,
    item: {id: 'supplied', key: 'item|test:supplied'},
  };
  const [edge] = byproductSupplyEdges(
    [producer, supplied],
    [{
      nodeId: 'supplied',
      key: 'item|test:supplied',
      requiredAmount: 3,
      creditedAmount: 3,
      remainingAmount: 0,
      allocations: [
        {producerSourceId: 'producer.source', amount: 2},
        {producerSourceId: 'producer.source', amount: 1},
      ],
    }],
  );

  assert.ok(edge);
  assert.equal(edge.targetNodeId, 'supplied');
  assert.equal(edge.producerSourceId, 'producer.source');
  assert.ok(edge.w > 0);
  assert.ok(edge.w < Math.hypot(246 - 50, 126 - 20));
  assert.ok(edge.angle > 0);
  assert.equal(
    byproductSupplyEdges([producer, supplied], [{
      nodeId: 'missing',
      key: 'item|test:missing',
      requiredAmount: 1,
      creditedAmount: 1,
      remainingAmount: 0,
      allocations: [{producerSourceId: 'producer.source', amount: 1}],
    }]).length,
    0,
  );
});

function deepChain(nodeCount) {
  let root = {
    id: `node-${nodeCount - 1}`,
    key: `item|test:node-${nodeCount - 1}`,
    amount: 1,
    ancestors: [],
  };
  for (let index = nodeCount - 2; index >= 0; index -= 1) {
    const key = `item|test:node-${index}`;
    root = {
      id: `node-${index}`,
      key,
      amount: 1,
      ancestors: [],
      source: {
        id: `node-${index}.source`,
        kind: 'recipe',
        recipe: {out: [[[key, 1]]]},
        inputs: [root],
      },
    };
  }
  return root;
}

test('lays out a 10,000-node dependency chain without recursive call-stack growth', () => {
  const graph = layoutTree(deepChain(10_000), true);
  assert.equal(graph.nodes.length, 10_000);
  assert.equal(graph.edges.length, 9_999);
  assert.equal(graph.maxX - graph.minX, COMPACT_ROOT_SIZE);
  assert.ok(graph.maxY > 900_000);
});

test('preserves left-to-right preorder placement and child-to-parent edge ordering', () => {
  const left = {id: 'left', key: 'item|test:left', ancestors: []};
  const right = {id: 'right', key: 'item|test:right', ancestors: []};
  const root = {
    id: 'root',
    key: 'item|test:root',
    ancestors: [],
    source: {
      id: 'root.source',
      kind: 'recipe',
      recipe: {out: [[['item|test:root', 1]]]},
      inputs: [left, right],
    },
  };

  const graph = layoutTree(root, true);
  assert.deepEqual(
    graph.nodes.map(node => node.item.id),
    ['root', 'left', 'right'],
  );
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.nodes[1].x < graph.nodes[2].x);
});

test('renders each tree relationship as one direct connector without elbow junctions', () => {
  const branch = id => ({
    id,
    key: `item|test:${id}`,
    ancestors: [],
    source: {
      id: `${id}.source`,
      kind: 'recipe',
      inputs: [{id: `${id}-emc`, key: 'emc|projecte:emc', ancestors: []}],
    },
  });
  const root = {
    id: 'root',
    key: 'item|test:root',
    ancestors: [],
    source: {
      id: 'root.source',
      kind: 'recipe',
      inputs: [branch('bowl'), branch('bento')],
    },
  };

  const graph = layoutTree(root);
  assert.equal(graph.edges.length, 4);
  assert.ok(graph.edges.every(edge => Number.isFinite(edge.angle)));
  assert.ok(graph.edges.every(edge => edge.w > edge.h));
});

test('reserves node space for starting-item controls instead of overlaying the tree', () => {
  const root = {
    id: 'root',
    key: 'item|test:root',
    ancestors: [],
    source: {
      id: 'root.source',
      kind: 'recipe',
      recipe: {w: 160, h: 60, out: [[['item|test:root', 1]]]},
      inputs: [{id: 'input', key: 'item|test:input', ancestors: []}],
    },
  };

  const closed = layoutTree(root, false, true, false);
  const open = layoutTree(root, false, true, true);
  assert.equal(open.nodes[0].w, closed.nodes[0].w + ROOT_SOURCE_ACTIONS_WIDTH);
  assert.equal(open.nodes[0].h, closed.nodes[0].h + ROOT_SOURCE_ACTIONS_HEIGHT);
  assert.ok(open.nodes[1].y >= closed.nodes[1].y + ROOT_SOURCE_ACTIONS_HEIGHT);
});

test('reserves a placed-block canvas for structure recipes instead of their legacy screenshot', () => {
  const size = sourceNodeSize({
    id: 'structure.source',
    kind: 'recipe',
    recipe: {
      w: 180,
      h: 220,
      img: 'blank-legacy-preview.png',
      structure: {
        size: [9, 11, 9],
        total: 2,
        controller: 'item|test:controller',
        blocks: [
          ['item|test:controller', 1],
          ['item|test:casing', 1],
        ],
        cells: [
          [0, 0, 0, 'item|test:controller'],
          [1, 0, 0, 'item|test:casing'],
        ],
      },
    },
    inputs: [],
  });

  assert.deepEqual(size, {
    w: SOURCE_STRUCTURE_PREVIEW_WIDTH + 12,
    h: SOURCE_STRUCTURE_PREVIEW_HEIGHT + SOURCE_HEADER + 12,
  });
});

test('reserves a structured recipe canvas for ProjectE EMC transmutation', () => {
  const size = sourceNodeSize({
    id: 'emc.source',
    kind: 'recipe',
    catTitle: 'EMC Transmutation',
    recipe: {
      id: 'projecte:emc/abc12345',
      in: [[['emc|projecte:emc', 1]]],
      out: [[['item|minecraft:cobblestone', 1]]],
    },
    inputs: [],
  });

  assert.deepEqual(size, {
    w: SOURCE_EMC_PREVIEW_WIDTH + 12,
    h: SOURCE_EMC_PREVIEW_HEIGHT + SOURCE_HEADER + 12,
  });
});

test('reserves standalone control space around an open compact starting item', () => {
  const root = {
    id: 'root',
    key: 'item|test:root',
    ancestors: [],
    source: {
      id: 'root.source',
      kind: 'recipe',
      inputs: [{id: 'input', key: 'item|test:input', ancestors: []}],
    },
  };

  const closed = layoutTree(root, true, true, false);
  const open = layoutTree(root, true, true, true);
  assert.equal(open.nodes[0].w, ROOT_ATTACHED_ACTIONS_WIDTH);
  assert.equal(
    open.nodes[0].h,
    COMPACT_ROOT_SIZE + ROOT_ATTACHED_ACTIONS_HEIGHT,
  );
  assert.ok(open.nodes[1].y > closed.nodes[1].y);
});

test('reserves a two-line source header for item and recipe type names', () => {
  assert.equal(SOURCE_HEADER, 34);
});

test('keeps radial starting item anchored when its attached controls open', () => {
  const radialX = -51;
  assert.equal(
    attachedRootVisualX(radialX, 102, true, true),
    radialX,
  );
  assert.equal(
    attachedRootVisualX(0, ROOT_ATTACHED_ACTIONS_WIDTH, false, true),
    (ROOT_ATTACHED_ACTIONS_WIDTH - COMPACT_ROOT_SIZE) / 2,
  );
});

test('reserves horizontal and export space for persistent compact item names', () => {
  const root = {
    id: 'root',
    key: 'item|test:root',
    ancestors: [],
    source: {
      id: 'root.source',
      kind: 'recipe',
      inputs: [
        {id: 'left', key: 'item|test:left', ancestors: []},
        {id: 'right', key: 'item|test:right', ancestors: []},
      ],
    },
  };
  const graph = layoutTree(root, true, true);
  const [left, right] = graph.nodes.slice(1);
  assert.ok(right.x + right.w / 2 - (left.x + left.w / 2) >= 96);
  assert.ok(graph.maxY >= right.y + right.h + COMPACT_LABEL_HEIGHT);
});

test('reserves a larger collision-safe footprint for the compact starting item', () => {
  const root = {
    id: 'root',
    key: 'fluid|test:root',
    ancestors: [],
  };

  const graph = layoutTree(root, true);
  assert.equal(COMPACT_ROOT_SIZE, Math.ceil(COMPACT_ROOT_DIAMOND_SIZE * Math.SQRT2));
  assert.equal(graph.nodes[0].w, COMPACT_ROOT_SIZE);
  assert.equal(graph.nodes[0].h, COMPACT_ROOT_SIZE);
  assert.equal(graph.maxX - graph.minX, COMPACT_ROOT_SIZE);
  assert.equal(graph.maxY - graph.minY, COMPACT_ROOT_SIZE);
});

test('keeps immediate compact inputs close when one sibling owns a wide descendant fan', () => {
  const leaf = id => ({id, key: `item|test:${id}`, ancestors: []});
  const wideBranch = {
    id: 'wide-branch',
    key: 'item|test:wide-branch',
    ancestors: [],
    source: {
      id: 'wide-branch.source',
      kind: 'recipe',
      recipe: {out: [[['item|test:wide-branch', 1]]]},
      inputs: Array.from({length: 10}, (_, index) => leaf(`wide-leaf-${index}`)),
    },
  };
  const root = {
    id: 'root',
    key: 'item|test:root',
    ancestors: [],
    source: {
      id: 'root.source',
      kind: 'recipe',
      recipe: {out: [[['item|test:root', 1]]]},
      inputs: [leaf('left'), wideBranch, leaf('right')],
    },
  };

  const graph = layoutTree(root, true);
  const immediateCenters = ['left', 'wide-branch', 'right'].map(id => {
    const node = graph.nodes.find(candidate => candidate.item.id === id);
    assert.ok(node, `Missing laid node ${id}`);
    return node.x + node.w / 2;
  });

  assert.deepEqual(
    immediateCenters.slice().sort((a, b) => a - b),
    immediateCenters,
  );
  assert.ok(immediateCenters[1] - immediateCenters[0] <= 70);
  assert.ok(immediateCenters[2] - immediateCenters[1] <= 70);

  const rows = new Map();
  for (const node of graph.nodes) {
    const row = rows.get(node.y) ?? [];
    row.push(node);
    rows.set(node.y, row);
  }
  for (const row of rows.values()) {
    const ordered = row.slice().sort((a, b) => a.x - b.x);
    for (let index = 1; index < ordered.length; index += 1) {
      assert.ok(
        ordered[index - 1].x + ordered[index - 1].w <= ordered[index].x,
        `${ordered[index - 1].id} overlaps ${ordered[index].id}`,
      );
    }
  }
});

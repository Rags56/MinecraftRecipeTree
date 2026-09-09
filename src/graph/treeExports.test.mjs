import assert from 'node:assert/strict';
import test from 'node:test';
import {buildTreeTotalsCsv, safeExportFilename} from './treeExports.ts';

test('totals CSV preserves all material-balance sections and unknown quantities', () => {
  const csv = buildTreeTotalsCsv(
    {
      inputs: [{key: 'item|test:iron', amount: 4, variants: 1}],
      prerequisites: [{key: 'item|test:mold', amount: 1, variants: 1}],
      byproductCredits: [
        {key: 'fluid|test:water', amount: 250, variants: 2, tag: 'forge:water'},
      ],
      byproducts: [
        {key: 'gasstack|test:steam', amount: null, variants: 1},
        {key: 'emc|projecte:emc', amount: 8192, variants: 1},
      ],
    },
    (key, tag) => (tag ? `#${tag}` : key === 'item|test:iron' ? 'Iron, Refined' : key),
  );

  assert.match(csv, /input,"Iron, Refined",item\|test:iron,4,items,1/);
  assert.match(csv, /required_not_consumed,item\|test:mold,item\|test:mold,1,items,1/);
  assert.match(csv, /byproduct_used,#forge:water,#forge:water,250,mB,2/);
  assert.match(csv, /byproduct_remaining,gasstack\|test:steam,gasstack\|test:steam,unknown,mB,1/);
  assert.match(csv, /byproduct_remaining,emc\|projecte:emc,emc\|projecte:emc,8192,EMC,1/);
});

test('export filenames are portable and never empty', () => {
  assert.equal(safeExportFilename('Oak Door / 1.12.2'), 'oak-door-1.12.2');
  assert.equal(safeExportFilename('***'), 'recipe-tree');
});

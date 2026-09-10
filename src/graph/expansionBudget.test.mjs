import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EXPANSION_NODE_BUDGET,
  ExpansionBudget,
  MAX_AUTO_EXPAND_DEPTH,
  autoExpandDepthLimit,
} from './expansionBudget.ts';

test('spends the budget in fewer levels the wider the tree branches', () => {
  // Same budget, expressed as depth: a ten-way split fills it almost immediately.
  assert.equal(autoExpandDepthLimit(2, 160), 7);
  assert.equal(autoExpandDepthLimit(4, 160), 3);
  assert.equal(autoExpandDepthLimit(10, 160), 2);
  assert.equal(autoExpandDepthLimit(40, 160), 2);
});

test('lets a near-linear chain run to the depth cap', () => {
  assert.equal(autoExpandDepthLimit(1, 160), MAX_AUTO_EXPAND_DEPTH);
  assert.equal(autoExpandDepthLimit(0, 160), MAX_AUTO_EXPAND_DEPTH);
  // Even a huge budget cannot push past the cap.
  assert.equal(autoExpandDepthLimit(2, 10_000_000), MAX_AUTO_EXPAND_DEPTH);
});

test('always allows enough depth to be worth expanding at all', () => {
  assert.ok(autoExpandDepthLimit(1000, 160) >= 2);
  assert.ok(autoExpandDepthLimit(10, 4) >= 2);
});

test('rejects a width or budget that cannot describe a tree', () => {
  assert.throws(() => autoExpandDepthLimit(-1), /non-negative/u);
  assert.throws(() => autoExpandDepthLimit(Number.NaN), /non-negative/u);
  assert.throws(() => autoExpandDepthLimit(2, 0), /at least 1/u);
  assert.throws(() => new ExpansionBudget(0), /at least 1/u);
});

test('derives width from the branches actually landing, not from a guess', () => {
  const budget = new ExpansionBudget(160);
  assert.equal(budget.branchingWidth, 0);
  budget.record(4);
  budget.record(4);
  assert.equal(budget.branchingWidth, 4);
  assert.equal(budget.depthLimit, 3);
  // A wide branch arriving later tightens the limit for what follows.
  budget.record(28);
  assert.equal(budget.branchingWidth, 12);
  assert.equal(budget.depthLimit, 2);
});

test('stops expanding once the node budget is spent, whatever the depth', () => {
  const budget = new ExpansionBudget(10);
  assert.equal(budget.allowsDepth(0), true);
  budget.record(10);
  assert.equal(budget.allowsDepth(0), false);
  assert.equal(budget.allowsDepth(1), false);
});

test('stops expanding past the depth its width allows', () => {
  const budget = new ExpansionBudget(160);
  budget.record(10);
  assert.equal(budget.depthLimit, 2);
  assert.equal(budget.allowsDepth(1), true);
  assert.equal(budget.allowsDepth(2), false);
  assert.equal(budget.allowsDepth(9), false);
});

test('rejects counts and depths that cannot describe an expansion', () => {
  const budget = new ExpansionBudget();
  assert.equal(DEFAULT_EXPANSION_NODE_BUDGET > 0, true);
  assert.throws(() => budget.record(-1), /non-negative integer/u);
  assert.throws(() => budget.record(1.5), /non-negative integer/u);
  assert.throws(() => budget.allowsDepth(-1), /non-negative integer/u);
});

test('measures depth from where the cascade started, not from the tree root', () => {
  // Expanding a node six levels down must still get its own levels below it, not be refused
  // because the depth it reports already exceeds a limit describing relative levels.
  const budget = new ExpansionBudget(160, 6);
  budget.record(4);
  assert.equal(budget.depthLimit, 3);
  assert.equal(budget.allowsDepth(7), true);
  assert.equal(budget.allowsDepth(8), true);
  assert.equal(budget.allowsDepth(9), false);
  // The same cascade at the root allows the same number of levels.
  const atRoot = new ExpansionBudget(160, 0);
  atRoot.record(4);
  assert.equal(atRoot.allowsDepth(2), true);
  assert.equal(atRoot.allowsDepth(3), false);
});

test('rejects a base depth that cannot describe a node', () => {
  assert.throws(() => new ExpansionBudget(160, -1), /non-negative integer/u);
  assert.throws(() => new ExpansionBudget(160, 1.5), /non-negative integer/u);
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const graphSource = await readFile(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
const menuSource = await readFile(new URL('./NodeActionMenu.tsx', import.meta.url), 'utf8');
const reportSource = await readFile(
  new URL('../data/recipeRetentionReports.ts', import.meta.url),
  'utf8',
);

test('context menus correct what a recipe keeps, in the user\'s own words', () => {
  // "Reusable" and "consumed" are the exporter's vocabulary. A person calls the thing a tool, and
  // says so in the same words wherever they meet it -- on the canvas or in the resources list.
  assert.match(menuSource, /Treat as tool\/catalyst/u);
  assert.match(menuSource, /Treat as resource/u);
  assert.doesNotMatch(menuSource, /Treat as reusable|Treat as consumed/u);
  assert.match(graphSource, /treatAsTool=\{\{/u);
  // The correction itself is unchanged: the override is applied across the tree and remembered.
  assert.match(graphSource, /applyManualRetentionOverrideToTree/u);
  assert.match(graphSource, /child\.retentionMode = reusable \? 'reusable' : undefined/u);
  // And it is one act with the list the item is shown on, so the two views cannot disagree.
  assert.match(graphSource, /setCatalyst\(node, isTool\)/u);
});

test('future expansions apply the saved correction before calculating consumption', () => {
  assert.match(graphSource, /manualRetentionOverrideFor\(manualRetentionOverridesRef\.current/u);
  assert.match(graphSource, /const nonConsumed = retentionOverride \?\? spec\.nonConsumed/u);
  assert.match(graphSource, /spec\.probabilityRole === 'consume' && !nonConsumed/u);
});

test('manual corrections are logged locally and sent to the report endpoint', () => {
  assert.match(graphSource, /A recipe ingredient retention override was changed\./u);
  assert.match(graphSource, /reportRecipeRetentionOverride\(/u);
  assert.match(reportSource, /\/api\/recipe-retention-reports/u);
  assert.match(graphSource, /The tool override was saved locally/u);
});

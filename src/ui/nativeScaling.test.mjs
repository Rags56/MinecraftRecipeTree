import assert from 'node:assert/strict';
import test from 'node:test';
import {itemGridDisplayMetrics} from '../components/itemIconSizing.ts';
import {nativeRecipePreviewSize} from '../components/recipePreviewSizing.ts';

test('native item artwork grows continuously with content scale, independent of UI scale', () => {
  for (const zoom of [0.75, 1, 1.7, 3]) {
    for (const ui of [0.75, 1, 1.25, 1.5]) {
      const size = itemGridDisplayMetrics(zoom, ui);
      assert.ok(Math.abs(size.iconSize * ui - 48 * zoom) < 0.001);
      assert.ok(Math.abs(size.cellWidth * ui - 104 * zoom) < 0.001);
    }
  }
});
test('native recipe zoom exceeds a narrow viewport instead of being silently capped', () => {
  const base = nativeRecipePreviewSize(160, 60, 3, 320, 1);
  const enlarged = nativeRecipePreviewSize(160, 60, 3, 320, 3);
  assert.equal(enlarged.width, base.width * 3);
  assert.equal(enlarged.height, base.height * 3);
  assert.ok(enlarged.width > 320);
});
test('recipe artwork retains its physical dimensions when UI scale changes', () => {
  const normal = nativeRecipePreviewSize(160, 60, 3, 320, 1.7, 1);
  const largerUi = nativeRecipePreviewSize(160, 60, 3, 320 / 1.5, 1.7, 1.5);
  assert.ok(Math.abs(normal.width - largerUi.width * 1.5) < 0.001);
  assert.ok(Math.abs(normal.height - largerUi.height * 1.5) < 0.001);
});
test('native display metrics reject invalid scales', () => {
  assert.throws(() => itemGridDisplayMetrics(NaN));
  assert.throws(() => nativeRecipePreviewSize(160, 60, 3, 320, 0));
});

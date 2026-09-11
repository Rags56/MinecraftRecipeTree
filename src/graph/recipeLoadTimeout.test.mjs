import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECIPE_LOAD_TIMEOUT_MS,
  RecipeLoadTimeoutError,
  withRecipeLoadTimeout,
} from './recipeLoadTimeout.ts';

/** Runs timers by hand so a test never waits out a real twenty-second timeout. */
function manualScheduler() {
  const pending = new Map();
  let nextHandle = 1;
  return {
    scheduler: {
      setTimeout(handler) {
        const handle = nextHandle++;
        pending.set(handle, handler);
        return handle;
      },
      clearTimeout(handle) {
        pending.delete(handle);
      },
    },
    fire() {
      for (const handler of [...pending.values()]) handler();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

test('passes a load that answers in time straight through', async () => {
  const {scheduler, pendingCount} = manualScheduler();
  assert.equal(pendingCount, 0);
  assert.equal(
    await withRecipeLoadTimeout(Promise.resolve('recipe'), 'Recipes', 1000, scheduler),
    'recipe',
  );
});

test('keeps a real failure as itself rather than reporting a timeout', async () => {
  const {scheduler} = manualScheduler();
  await assert.rejects(
    withRecipeLoadTimeout(Promise.reject(new Error('404')), 'Recipes', 1000, scheduler),
    /404/u,
  );
});

test('turns a load that never settles into a failure', async () => {
  const {scheduler, fire} = manualScheduler();
  const stalled = withRecipeLoadTimeout(new Promise(() => {}), 'Recipes', 1000, scheduler);
  fire();
  await assert.rejects(stalled, error => {
    assert.ok(error instanceof RecipeLoadTimeoutError);
    assert.match(error.message, /Recipes did not respond within 1 seconds\./u);
    return true;
  });
});

test('clears its timer once the load settles, either way', async () => {
  const harness = manualScheduler();
  await withRecipeLoadTimeout(Promise.resolve(1), 'Recipes', 1000, harness.scheduler);
  assert.equal(harness.pendingCount, 0);
  await assert.rejects(
    withRecipeLoadTimeout(Promise.reject(new Error('no')), 'Recipes', 1000, harness.scheduler),
  );
  // A timer left behind would fire into a promise nobody is waiting on any more.
  assert.equal(harness.pendingCount, 0);
});

test('rejects a timeout that cannot describe a wait', () => {
  assert.throws(() => withRecipeLoadTimeout(Promise.resolve(1), 'Recipes', 0), /positive duration/u);
  assert.throws(
    () => withRecipeLoadTimeout(Promise.resolve(1), 'Recipes', Number.NaN),
    /positive duration/u,
  );
  assert.ok(RECIPE_LOAD_TIMEOUT_MS > 0);
});

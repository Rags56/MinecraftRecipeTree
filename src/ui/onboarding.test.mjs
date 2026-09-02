import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./onboarding.ts', import.meta.url), 'utf8');

test('onboarding visit state is web-only, keyed, and fails closed to "unseen"', () => {
  assert.match(source, /ONBOARDING_STORAGE_KEY = 'minecraft-recipe-tree-onboarding-seen'/u);
  assert.match(source, /if \(Platform\.OS !== 'web' \|\| typeof window === 'undefined'\) return true;/u);
  assert.match(source, /window\.localStorage\.getItem\(ONBOARDING_STORAGE_KEY\) === '1'/u);
  assert.match(source, /window\.localStorage\.setItem\(ONBOARDING_STORAGE_KEY, '1'\)/u);
  // A read failure must default to "not seen" (show onboarding) rather than silently hiding it.
  assert.match(source, /catch \(cause\) \{[\s\S]*?return false;\n\s*\}/u);
});

test('marking onboarding seen is a no-op off web instead of throwing', () => {
  const setter = source.slice(source.indexOf('export function markOnboardingSeen'));
  assert.match(setter, /if \(Platform\.OS !== 'web' \|\| typeof window === 'undefined'\) return;/u);
});

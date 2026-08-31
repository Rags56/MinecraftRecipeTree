import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const applicationSource = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');

const deferredModules = [
  './src/account/AccountModal',
  './src/account/SignInModal',
  './src/components/DatasetPicker',
  './src/components/GraphGuideModal',
  './src/components/IssueReportModal',
  './src/components/ItemDetailModal',
  './src/components/MobileUploadGuide',
  './src/components/MobsScreen',
  './src/components/RecipeHistoryModal',
  './src/components/RecipeStageModal',
  './src/donations/DonationsModal',
  './src/account/FavoritesModal',
];

test('secondary surfaces load from on-demand chunks', () => {
  for (const modulePath of deferredModules) {
    const escapedModulePath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(
      applicationSource,
      new RegExp(`^import[^\\n]+from ['"]${escapedModulePath}['"]`, 'm'),
      `${modulePath} must not remain on the initial application dependency path`,
    );
    assert.match(
      applicationSource,
      new RegExp(`React\\.lazy\\([\\s\\S]*?import\\(['"]${escapedModulePath}['"]\\)`),
      `${modulePath} should be loaded through React.lazy`,
    );
  }
});

test('expensive secondary surfaces are not mounted before they are requested', () => {
  assert.match(applicationSource, /showMobileUploadGuide\s*&&\s*\(/);
  assert.match(applicationSource, /ui\.itemStack\.length\s*>\s*0\s*&&\s*\(/);
  assert.match(applicationSource, /data\.capabilities\.mobs\s*&&\s*hasVisitedMobs\s*&&\s*\(/);
  assert.match(applicationSource, /if \(tab === ['"]mobs['"]\) setHasVisitedMobs\(true\)/);
});

test('deferred surfaces provide visible loading feedback', () => {
  assert.match(applicationSource, /function DeferredModalFallback/);
  assert.match(applicationSource, /Loading \{label\}…/);
  assert.doesNotMatch(
    applicationSource,
    /<Suspense\s+fallback=\{null\}>/,
    'deferred surfaces must not appear unresponsive while their chunks load',
  );
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_INTERFACE_ZOOM,
  MAXIMUM_INTERFACE_ZOOM,
  MINIMUM_INTERFACE_ZOOM,
  normalizeInterfaceZoom,
  stepInterfaceZoom,
  uniformPickerRecipePreviewSize,
} from './interfaceZoom.ts';

const appSource = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
const itemDetailSource = await readFile(
  new URL('../components/ItemDetailModal.tsx', import.meta.url),
  'utf8',
);
const pickerSource = await readFile(
  new URL('../components/PickerModal.tsx', import.meta.url),
  'utf8',
);
const switcherSource = await readFile(
  new URL('../components/DatasetSwitcher.tsx', import.meta.url),
  'utf8',
);
const graphSource = await readFile(new URL('../graph/GraphScreen.tsx', import.meta.url), 'utf8');

test('secondary information actions share one anchored header menu without import or details', () => {
  assert.match(
    appSource,
    /accessibilityLabel=\{showInfoMenu \? 'Close information menu' : 'Open information menu'\}/u,
  );
  assert.match(appSource, /accessibilityRole="menu"/u);
  assert.match(appSource, /onPointerDown=\{showInfoMenu \? closeInfoMenu : undefined\}/u);
  assert.match(appSource, /onTouchStart=\{showInfoMenu \? closeInfoMenu : undefined\}/u);
  assert.match(
    appSource,
    /style=\{styles\.infoMenuAnchor\}[\s\S]*?onPointerDown=\{event => event\.stopPropagation\(\)\}/u,
  );
  const infoMenuSource = appSource.slice(
    appSource.indexOf('const infoMenu = ('),
    appSource.indexOf('const headerActions ='),
  );
  assert.doesNotMatch(infoMenuSource, />\s*Import crafting tree\s*</u);
  assert.doesNotMatch(infoMenuSource, />\s*Details\s*</u);
  assert.match(appSource, />\s*Info\s*</u);
  assert.match(appSource, />\s*Bug report\s*</u);
  assert.match(appSource, />\s*History\s*</u);
  assert.match(appSource, /headerSurface: \{position: 'relative', zIndex: 200\}/u);
});

test('desktop keeps the import dropdown on the title row while compact layouts use the app menu', () => {
  assert.match(
    switcherSource,
    /<View style=\{styles\.fullTitleRow\}>\s*\{brand\}\s*\{trailingAction\}\s*\{datasetButton\}\s*\{importMenu\}\s*<\/View>/u,
  );
  assert.match(
    switcherSource,
    /<View style=\{styles\.fullControlRow\}>\s*\{leadingAction\}\s*\{fullWidthControls\}\s*<\/View>/u,
  );
  assert.match(
    switcherSource,
    /<View style=\{styles\.compactTitleRow\}>\s*\{brand\}\s*\{datasetButton\}\s*<\/View>/u,
  );
  const compactBranch = switcherSource.slice(
    switcherSource.indexOf(') : compact ? ('),
    switcherSource.indexOf(') : (', switcherSource.indexOf(') : compact ? (')),
  );
  assert.doesNotMatch(compactBranch, /\{importMenu\}/u);
  const nativeBranch = switcherSource.slice(
    switcherSource.indexOf('{nativeHeader ? ('),
    switcherSource.indexOf(') : compact ? ('),
  );
  assert.doesNotMatch(nativeBranch, /\{importMenu\}/u);
  assert.match(appSource, />\s*Import pack\s*</u);
  assert.match(switcherSource, />\s*Import pack\s*</u);
  assert.match(switcherSource, />\s*Import crafting tree\s*</u);
  assert.doesNotMatch(switcherSource, /importDropdownIcon/u);
  assert.match(appSource, /\(compactHeader \|\| Platform\.OS !== 'web'\)/u);
});

test('mobile information and app menus are mutually exclusive', () => {
  assert.match(
    appSource,
    /setShowInfoMenu\(value => \{[\s\S]*?if \(next\) setShowAppMenu\(false\);/u,
  );
  assert.match(
    appSource,
    /setShowAppMenu\(next\);\s*if \(next\) setShowInfoMenu\(false\);/u,
  );
  assert.match(switcherSource, /const expanded = compactMenuExpanded \?\? internalExpanded/u);
});

test('graph retry discards only the broken active snapshot and rebuilds the same output', () => {
  assert.match(
    appSource,
    /onRetry=\{recovery => \{[\s\S]*?clearGraphSession\(data\.descriptor\);[\s\S]*?ui\.restoreGraph\(ui\.graphRootKey, ui\.graphDirection\);/u,
  );
  assert.match(
    appSource,
    /this\.props\.onRetry\(recovery\);\s*this\.setState\(\{recovery: null\}\);/u,
  );
  assert.match(appSource, /recovery\.reloadPage[\s\S]*?globalThis\.location\?\.reload\(\)/u);
});

test('current pack label shows its version as subtext in every header layout', () => {
  assert.match(switcherSource, /style=\{styles\.compactDatasetVersion\}/u);
  assert.match(switcherSource, /\{selected\.packVersion\}/u);
  assert.match(
    switcherSource,
    /Current pack is \$\{selected\.displayName\}, version \$\{selected\.packVersion\}/u,
  );
});

test('compact web keeps the Items and Graph picker outside the collapsible details area', () => {
  assert.match(
    appSource,
    /const compactHeaderNavigation = compactHeader && headerTabs \? \([\s\S]*?styles\.compactHeaderNavigation[\s\S]*?\{headerTabs\}/u,
  );
  assert.match(
    appSource,
    /styles\.compactHeaderUtilityRow[\s\S]*?\{compactHeaderNavigation\}[\s\S]*?\{Platform\.OS === 'web' && infoMenu\}/u,
  );
  const compactDetails = appSource.slice(
    appSource.indexOf('const headerDetails = compactHeader ?'),
    appSource.indexOf('const fullWidthHeaderControls ='),
  );
  assert.doesNotMatch(compactDetails, /headerTabs|compactHeaderNavigation/u);
});

test('graph controls remain in the graph surface at compact widths', () => {
  assert.doesNotMatch(appSource, /graphControlsHeaderAction|controlsToggleInHeader/u);
  assert.doesNotMatch(graphSource, /controlsToggleInHeader/u);
  assert.match(
    graphSource,
    /styles\.controlMenuBtn[\s\S]*?!showGraphControls && \([\s\S]*?>Graph controls<\/Text>[\s\S]*?<DisclosureChevron/u,
  );
});

test('interface zoom accepts every bounded twenty-five-percent step', () => {
  assert.equal(normalizeInterfaceZoom(DEFAULT_INTERFACE_ZOOM), 1);
  assert.equal(normalizeInterfaceZoom(MINIMUM_INTERFACE_ZOOM), 0.75);
  assert.equal(normalizeInterfaceZoom(1.25), 1.25);
  assert.equal(normalizeInterfaceZoom(MAXIMUM_INTERFACE_ZOOM), 1.5);
});

test('interface zoom rejects out-of-range and off-step values instead of silently approximating', () => {
  assert.throws(() => normalizeInterfaceZoom(0.7), /outside the supported control range/);
  assert.throws(() => normalizeInterfaceZoom(1.09), /outside the supported control range/);
  assert.throws(() => normalizeInterfaceZoom(1.55), /outside the supported control range/);
  assert.throws(() => normalizeInterfaceZoom(Number.NaN), /finite number/);
});

test('interface zoom stepper moves twenty-five percent and stops at its bounds', () => {
  assert.equal(stepInterfaceZoom(1, 1), 1.25);
  assert.equal(stepInterfaceZoom(1, -1), 0.75);
  assert.equal(stepInterfaceZoom(MINIMUM_INTERFACE_ZOOM, -1), MINIMUM_INTERFACE_ZOOM);
  assert.equal(stepInterfaceZoom(MAXIMUM_INTERFACE_ZOOM, 1), MAXIMUM_INTERFACE_ZOOM);
});

test('header uses a stepper for UI zoom while retaining the recipe and item slider', () => {
  assert.match(appSource, /accessibilityLabel="Decrease interface zoom"/u);
  assert.match(appSource, /accessibilityLabel="Increase interface zoom"/u);
  assert.doesNotMatch(appSource, /testID="interface-zoom-slider"/u);
  assert.match(appSource, /testID="content-zoom-slider"/u);
});

test('every recipe browsing surface exposes the shared recipe and item zoom control', () => {
  assert.match(appSource, /<ContentZoomControl[\s\S]*?appearance="toolbar"/u);
  assert.match(
    appSource,
    /<LazyItemDetailModal[\s\S]*?onContentZoomChange=\{previewContentZoom\}[\s\S]*?onContentZoomComplete=\{saveContentZoom\}/u,
  );
  assert.match(
    itemDetailSource,
    /<ContentZoomControl[\s\S]*?testID="item-detail-content-zoom-slider"/u,
  );
  assert.match(
    pickerSource,
    /<ContentZoomControl[\s\S]*?testID="picker-content-zoom-slider"/u,
  );
});

test('picker applies one uniform recipe scale before proportional fit constraints', () => {
  assert.deepEqual(uniformPickerRecipePreviewSize(160, 60, 1), {
    width: 160,
    height: 60,
  });
  assert.deepEqual(uniformPickerRecipePreviewSize(80, 40, 1.5), {
    width: 120,
    height: 60,
  });
  assert.deepEqual(uniformPickerRecipePreviewSize(80, 40, 1.05), {
    width: 84,
    height: 42,
  });
  assert.deepEqual(uniformPickerRecipePreviewSize(160, 60, 1.5), {
    width: 240,
    height: 90,
  });
  assert.deepEqual(uniformPickerRecipePreviewSize(300, 100, 1.5), {
    width: 450,
    height: 150,
  });
  assert.deepEqual(uniformPickerRecipePreviewSize(160, 60, 3), {
    width: 480,
    height: 180,
  });
  assert.throws(
    () => uniformPickerRecipePreviewSize(160, 60, 1.09),
    /outside the supported slider range/,
  );
  assert.throws(
    () => uniformPickerRecipePreviewSize(0, 60, 1.5),
    /positive finite numbers/,
  );
});

test('interface zoom does not apply browser CSS zoom to the graph workspace', () => {
  assert.doesNotMatch(appSource, /scaledWorkspaceStyle/u);
  assert.match(appSource, /const scaledMobsWorkspaceStyle[\s\S]*?zoom:\s*interfaceZoom/u);
  const graphPane = appSource.slice(
    appSource.indexOf('{data.indexStatus ==='),
    appSource.indexOf('{data.capabilities.mobs'),
  );
  assert.doesNotMatch(graphPane, /scaledMobsWorkspaceStyle|zoom:\s*interfaceZoom/u);
});

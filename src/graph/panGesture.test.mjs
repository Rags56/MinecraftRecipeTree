import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  capturePanGestureOrigin,
  graphDisplayTransform,
  graphPinchZoomFactor,
  graphViewportPointFromClient,
  graphWheelZoomFactor,
  transformForPanGesture,
} from './panGesture.ts';

const graphScreenSource = await readFile(new URL('./GraphScreen.tsx', import.meta.url), 'utf8');
const lowDetailCanvasSource = await readFile(
  new URL('./LowDetailGraphCanvas.tsx', import.meta.url),
  'utf8',
);

test('native graph scale avoids composited scaling and snaps to physical pixels', () => {
  assert.deepEqual(graphDisplayTransform({x: 10.24, y: 20.26, scale: 1}, 2), {
    x: 10,
    y: 20.5,
    scale: 1,
    nativeScale: true,
  });
  assert.deepEqual(graphDisplayTransform({x: 10.24, y: 20.26, scale: 0.8}, 2), {
    x: 10,
    y: 20.5,
    scale: 0.8,
    nativeScale: false,
  });
  assert.throws(
    () => graphDisplayTransform({x: 0, y: 0, scale: 1}, 0),
    /positive finite values/,
  );
});

test('web graph zoom keeps detailed content crisp and composites low-detail trees', () => {
  assert.match(graphScreenSource, /zoom:\s*displayTransform\.scale/u);
  const anchorMarkup = graphScreenSource.slice(
    graphScreenSource.indexOf('Keep translation outside the detailed web scale layer'),
    graphScreenSource.indexOf('{!lowDetailGraph && renderedGraph?.edges.map'),
  );
  assert.match(anchorMarkup, /Platform\.OS === 'web'[\s\S]*?left:\s*displayTransform\.x/u);
  assert.match(
    anchorMarkup,
    /lowDetailGraph[\s\S]*?translateX:\s*displayTransform\.x[\s\S]*?transformOrigin:\s*'0 0'/u,
  );
  assert.match(anchorMarkup, /Platform\.OS !== 'web'[\s\S]*?translateX:\s*displayTransform\.x/u);
});

test('far-zoom web graphs use one inert canvas without recipe hover expansion', () => {
  assert.match(graphScreenSource, /<LowDetailGraphCanvas/u);
  assert.match(graphScreenSource, /rasterLowDetailGraph \? 0 : GRAPH_VIEWPORT_OVERSCAN/u);
  assert.doesNotMatch(
    graphScreenSource,
    /lowDetailRecipeHover|hoveredLowDetailRecipe|previewMagnification|pointermove/u,
  );
  assert.match(lowDetailCanvasSource, /createElement\('canvas'\)/u);
  assert.match(lowDetailCanvasSource, /pointerEvents="none"/u);
  assert.match(lowDetailCanvasSource, /imageSmoothingEnabled = false/u);
});

test('interface zoom scales graph menu chrome without scaling the graph canvas', () => {
  assert.match(
    graphScreenSource,
    /const graphMenuScaleStyle[\s\S]*?zoom:\s*interfaceZoom/u,
  );
  assert.match(graphScreenSource, /style=\{\[styles\.controls, graphMenuScaleStyle\]\}/u);
  assert.match(
    graphScreenSource,
    /style=\{\[styles\.ctrlBtn, styles\.fitControl, graphMenuScaleStyle(?:,|\])/u,
  );
  // The totals panel used to stand in for zoomed chrome here; it moved out of the canvas when
  // its controls were split into standalone settings, so a notice that is still on it is used.
  assert.match(
    graphScreenSource,
    /style=\{\[styles\.exportNotice, bottomNoticeStyle, graphMenuScaleStyle\]\}/u,
  );
  assert.match(
    graphScreenSource,
    /style=\{\[styles\.recipeLookupCard, graphMenuScaleStyle\]\}/u,
  );
  const graphCanvasMarkup = graphScreenSource.slice(
    graphScreenSource.indexOf('<View\n        ref={setCanvasRef}'),
    graphScreenSource.indexOf('{graphLayout.fallback'),
  );
  assert.doesNotMatch(graphCanvasMarkup, /graphMenuScaleStyle|zoom:\s*interfaceZoom/u);
});

test('collapsed graph controls put their label on the chevron button', () => {
  assert.match(
    graphScreenSource,
    /!showGraphControls && \([\s\S]*?<Text style=\{\[styles\.ctrlBtnText, noSelect\]\}>\s*Graph controls\s*<\/Text>[\s\S]*?<DisclosureChevron/u,
  );
  assert.doesNotMatch(graphScreenSource, /controlOptionsTitle:|accessibilityRole="header"[\s\S]*?>\s*Graph controls/u);
  assert.doesNotMatch(graphScreenSource, /controlMenuBtnText/u);
});

test('compact byproduct nodes support alternate recipe gestures', () => {
  assert.match(
    graphScreenSource,
    /double tap to change recipe/u,
  );
  assert.match(
    graphScreenSource,
    /onContextMenu:[\s\S]*?preventDefault[\s\S]*?onActions\(nodeActionPointer\(event\)\)/u,
  );
  assert.match(graphScreenSource, /long press or right click for node options/u);
  assert.match(
    graphScreenSource,
    // Node-taking now, so the node views can be memoized; the 280ms wait that separates a single
    // tap from a double tap is what this is guarding.
    /pendingTapRef\.current = setTimeout\([\s\S]*?onTap\(node, radialTap\)[\s\S]*?280/u,
  );
  assert.match(
    graphScreenSource,
    /treeTotals\.byproductCoverageByNode\.has\(n\.item\.id\)[\s\S]*?openPickerWithErrorHandling/u,
  );
});

test('node actions use an anchored state-aware menu instead of a modal', () => {
  assert.doesNotMatch(graphScreenSource, /<Modal transparent visible/u);
  assert.match(graphScreenSource, /accessibilityRole="menu"/u);
  assert.match(graphScreenSource, /nodeContextMenuPlacement\(/u);
  assert.match(graphScreenSource, /hasSelectedRecipe \? 'Change recipe' : 'Set recipe'/u);
  assert.match(graphScreenSource, />Add used by<\/Text>/u);
  assert.match(graphScreenSource, /<ContextAmountStepper amount=\{amount\}/u);
  assert.match(graphScreenSource, /hasSelectedRecipe && \(/u);
});

test('compact nodes render wide item and fluid quantities when amounts are enabled', () => {
  assert.doesNotMatch(graphScreenSource, /onHoverIn=.*Quantity|quantityTooltipVisible/u);
  assert.match(
    graphScreenSource,
    /const showCountBadge = countBadgeText === '✓' \|\| showAmounts/u,
  );
  assert.doesNotMatch(graphScreenSource, /compactQuantityPlacement/u);
});

test('node alternative previews stay aligned to the item icon pixel grid', () => {
  assert.match(
    graphScreenSource,
    /const alternatives = Array\.from\([\s\S]*?item\.id[\s\S]*?item\.n[\s\S]*?\.values\(\)/u,
  );
  assert.match(
    graphScreenSource,
    /<ItemIcon itemKey=\{itemKey\} size=\{32\} \/>/u,
  );
  assert.doesNotMatch(
    graphScreenSource,
    /<ItemIcon itemKey=\{itemKey\} size=\{28\} \/>/u,
  );
});

test('wheel coordinates map displayed bounds into the logical graph viewport', () => {
  assert.deepEqual(
    graphViewportPointFromClient(
      450,
      300,
      {left: 150, top: 75, width: 900, height: 600},
      {width: 600, height: 400},
    ),
    {x: 200, y: 150},
  );
});

test('wheel zoom is continuous and normalizes browser delta modes', () => {
  assert.equal(graphWheelZoomFactor(0, 0), 1);
  assert.ok(graphWheelZoomFactor(-8, 0) > 1);
  assert.ok(graphWheelZoomFactor(8, 0) < 1);
  assert.equal(graphWheelZoomFactor(10, 1), graphWheelZoomFactor(160, 0));
  assert.throws(() => graphWheelZoomFactor(10, 3), /invalid/);
});

test('pinch zoom amplifies finger travel without frame-dependent accumulation', () => {
  assert.equal(graphPinchZoomFactor(100, 100), 1);
  assert.ok(graphPinchZoomFactor(110, 100) > 1.2);
  assert.ok(graphPinchZoomFactor(90, 100) < 0.8);
  assert.ok(
    Math.abs(
      graphPinchZoomFactor(110, 100) *
        graphPinchZoomFactor(100, 110) -
        1,
    ) < Number.EPSILON * 4,
  );
  assert.throws(() => graphPinchZoomFactor(0, 100), /positive finite numbers/);
});

test('delayed responder grant does not reapply the activation movement', () => {
  const transform = {x: 240, y: 130, scale: 0.75};
  const origin = capturePanGestureOrigin(transform, 7, 2);

  assert.deepEqual(transformForPanGesture(origin, 7, 2), transform);
  assert.deepEqual(transformForPanGesture(origin, 27, -8), {
    x: 260,
    y: 120,
    scale: 0.75,
  });
});

test('rebasing after a pinch preserves the current transform before panning resumes', () => {
  const postPinchTransform = {x: -340, y: 415, scale: 1.4};
  const origin = capturePanGestureOrigin(postPinchTransform, 126, -44);

  assert.deepEqual(transformForPanGesture(origin, 126, -44), postPinchTransform);
  assert.deepEqual(transformForPanGesture(origin, 116, -14), {
    x: -350,
    y: 445,
    scale: 1.4,
  });
});

test('panning does not re-render every visible node', () => {
  // A new transform every frame re-renders the graph. Unless the node views are memoized *and* their
  // props keep their identity, every visible node re-renders with it -- recipe previews, chips
  // and all -- which is a per-frame cost rather than a per-tree one.
  for (const view of ['CompactItemNodeView', 'ItemNodeView', 'SourceNodeView']) {
    assert.match(
      graphScreenSource,
      new RegExp(`const ${view} = React\\.memo\\(function ${view}\\(`, 'u'),
      `${view} is not memoized`,
    );
  }
  // An inline closure is a fresh prop on every frame, and a memo cannot see past it.
  const renderBlock = graphScreenSource.slice(
    graphScreenSource.indexOf('{!rasterLowDetailGraph && renderedGraph?.nodes.map(n =>'),
  );
  const nodeMarkup = renderBlock.slice(0, renderBlock.indexOf('</View>'));
  assert.doesNotMatch(nodeMarkup, /on(Tap|Collapse|Swap|Info|Actions)=\{\(?\w*\)? ?=>/u);
});

test('gesture updates are coalesced to one render per frame', () => {
  // Pointer and touch moves arrive far faster than the screen refreshes -- a high-polling mouse
  // reports hundreds of times a second -- so rendering per event threw most of that work away
  // before anything was drawn, and stuttered on trees small enough to rule out their size.
  assert.match(graphScreenSource, /const scheduleTransform = useCallback\(/u);
  assert.match(graphScreenSource, /transformFrameRef\.current = requestAnimationFrame\(/u);
  assert.match(
    graphScreenSource,
    /scheduleTransform\(transformForPanGesture\(panOrigin\.current, g\.dx, g\.dy\)\)/u,
  );
  // Zoom arrives as a stream too, from both the wheel and a pinch.
  assert.match(graphScreenSource, /scheduleTransform\(\{\s*x: px - \(px - current\.x\) \* k/u);
  // A discrete change still applies at once: fit and recentre are single actions being waited on.
  assert.match(graphScreenSource, /applyTransform\(transformCenteredOn\(/u);
  // The frame must be released, or an unmount mid-gesture leaves it pointing at a dead setState.
  assert.match(graphScreenSource, /cancelAnimationFrame\(transformFrameRef\.current\)/u);
});

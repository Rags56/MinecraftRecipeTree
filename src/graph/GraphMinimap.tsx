import React, {useMemo, useRef} from 'react';
import {PanResponder, StyleSheet, View, type GestureResponderEvent} from 'react-native';
import {theme} from '../theme';
import type {GraphLayout} from './layout';
import type {GraphTransform} from './panGesture';
import {
  graphPointFromMinimap,
  minimapNodeRects,
  minimapProjection,
  minimapViewportRect,
  type MinimapRect,
} from './minimap';

export const MINIMAP_MAX_WIDTH = 148;
export const MINIMAP_MAX_HEIGHT = 108;
const MINIMAP_PADDING = 4;

/**
 * Drawn from plain Views rather than react-native-svg: that package's Fabric components import
 * react-native/Libraries/Utilities/codegenNativeComponent, which the web build aliases to a
 * react-native-web path that does not exist, so importing it anywhere reachable from web fails
 * the bundle outright. The occupancy bucketing in ./minimap is what keeps this to a sane number
 * of views for a tree with thousands of nodes.
 */
const MinimapNodes = React.memo(function MinimapNodes({rects}: {rects: readonly MinimapRect[]}) {
  return (
    <>
      {rects.map((rect, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={[
            styles.node,
            {
              left: rect.x + MINIMAP_PADDING,
              top: rect.y + MINIMAP_PADDING,
              width: rect.w,
              height: rect.h,
            },
          ]}
        />
      ))}
    </>
  );
});

/**
 * An overview of the whole tree with the canvas's current slice drawn on it. Tapping or dragging
 * moves the canvas there, which is the only practical way to cross a tree that is thousands of
 * nodes wide without pinching out until nothing is readable.
 */
export const GraphMinimap = React.memo(function GraphMinimap({
  layout,
  transform,
  viewport,
  onRecenter,
  style,
}: {
  layout: GraphLayout;
  transform: GraphTransform;
  viewport: {w: number; h: number};
  onRecenter: (graphPoint: {x: number; y: number}) => void;
  style?: object;
}) {
  const projection = useMemo(
    () => minimapProjection(layout, MINIMAP_MAX_WIDTH, MINIMAP_MAX_HEIGHT),
    [layout],
  );
  // Memoized apart from the viewport rectangle, which moves on every pan while these do not.
  const nodeRects = useMemo(
    () => minimapNodeRects(layout.nodes, projection),
    [layout.nodes, projection],
  );
  const viewportRect = useMemo(() => {
    try {
      return minimapViewportRect(transform, viewport, projection);
    } catch (error) {
      console.error('The minimap could not place the current viewport.', error);
      return null;
    }
  }, [projection, transform, viewport]);

  // Kept in a ref so the responder created once below always reads the live projection.
  const recenterRef = useRef<(event: GestureResponderEvent) => void>(() => {});
  recenterRef.current = event => {
    const {locationX, locationY} = event.nativeEvent;
    if (!Number.isFinite(locationX) || !Number.isFinite(locationY)) return;
    onRecenter(
      graphPointFromMinimap(
        {x: locationX - MINIMAP_PADDING, y: locationY - MINIMAP_PADDING},
        projection,
      ),
    );
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed on touch-down so a drag scrubs the canvas instead of panning it underneath.
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: event => recenterRef.current(event),
        onPanResponderMove: event => recenterRef.current(event),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Tree overview. Tap to move the view."
      style={[
        styles.container,
        {
          width: projection.width + MINIMAP_PADDING * 2,
          height: projection.height + MINIMAP_PADDING * 2,
        },
        style,
      ]}
      {...responder.panHandlers}>
      <MinimapNodes rects={nodeRects} />
      {viewportRect && (
        <View
          pointerEvents="none"
          style={[
            styles.viewport,
            {
              left: viewportRect.x + MINIMAP_PADDING,
              top: viewportRect.y + MINIMAP_PADDING,
              width: Math.max(2, viewportRect.w),
              height: Math.max(2, viewportRect.h),
            },
          ]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'rgba(23,29,38,0.94)',
    overflow: 'hidden',
  },
  node: {
    position: 'absolute',
    borderRadius: 1,
    backgroundColor: theme.textDim,
    opacity: 0.55,
  },
  viewport: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 2,
    borderColor: theme.accent,
    backgroundColor: theme.accent,
    opacity: 0.18,
  },
});

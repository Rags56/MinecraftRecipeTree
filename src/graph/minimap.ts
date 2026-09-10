import type {GraphLayout, LaidNode} from './layout';
import type {GraphTransform} from './panGesture';

export interface MinimapProjection {
  /** Graph units per minimap pixel, uniform so the overview keeps the tree's proportions. */
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A tree large enough to need an overview is also large enough that one rect per node would cost
 * more than the map is worth, so past this many nodes the map is drawn from occupancy buckets
 * instead. The shape of a dense tree is what the user is navigating by; individual nodes at that
 * size are a pixel each anyway. Every rect is a real view, so the bucket grid is also the ceiling
 * on how many of them the overview can ever mount.
 */
export const MINIMAP_DIRECT_NODE_LIMIT = 180;
export const MINIMAP_BUCKET_COLUMNS = 32;

export function minimapProjection(
  layout: Pick<GraphLayout, 'minX' | 'minY' | 'maxX' | 'maxY'>,
  maxWidth: number,
  maxHeight: number,
): MinimapProjection {
  if (!(maxWidth > 0) || !(maxHeight > 0)) {
    throw new Error(
      `Minimap projection requires positive bounds, got ${maxWidth}x${maxHeight}.`,
    );
  }
  const graphWidth = Math.max(1, layout.maxX - layout.minX);
  const graphHeight = Math.max(1, layout.maxY - layout.minY);
  const scale = Math.min(maxWidth / graphWidth, maxHeight / graphHeight);
  return {
    scale,
    offsetX: layout.minX,
    offsetY: layout.minY,
    width: graphWidth * scale,
    height: graphHeight * scale,
  };
}

function projectRect(
  projection: MinimapProjection,
  x: number,
  y: number,
  w: number,
  h: number,
): MinimapRect {
  // Adding zero normalizes -0, which a panned-to-origin canvas produces and which then compares
  // unequal to 0 under Object.is for anything downstream that memoizes on these rects.
  return {
    x: (x - projection.offsetX) * projection.scale + 0,
    y: (y - projection.offsetY) * projection.scale + 0,
    w: w * projection.scale + 0,
    h: h * projection.scale + 0,
  };
}

/**
 * Node rects in minimap space, bucketed into an occupancy grid once drawing them individually
 * would mean hundreds of elements. Every returned rect is at least a pixel so a sparse tree does
 * not project into nothing.
 */
export function minimapNodeRects(
  nodes: readonly LaidNode[],
  projection: MinimapProjection,
  directNodeLimit = MINIMAP_DIRECT_NODE_LIMIT,
): MinimapRect[] {
  if (nodes.length === 0) return [];
  if (nodes.length <= directNodeLimit) {
    return nodes.map(node => {
      const rect = projectRect(projection, node.x, node.y, node.w, node.h);
      return {...rect, w: Math.max(1, rect.w), h: Math.max(1, rect.h)};
    });
  }

  const cellSize = Math.max(1, projection.width / MINIMAP_BUCKET_COLUMNS);
  const occupied = new Set<string>();
  for (const node of nodes) {
    const rect = projectRect(projection, node.x, node.y, node.w, node.h);
    const firstColumn = Math.floor(rect.x / cellSize);
    const lastColumn = Math.floor((rect.x + Math.max(0, rect.w)) / cellSize);
    const firstRow = Math.floor(rect.y / cellSize);
    const lastRow = Math.floor((rect.y + Math.max(0, rect.h)) / cellSize);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) {
        occupied.add(`${column},${row}`);
      }
    }
  }
  return [...occupied].map(key => {
    const [column, row] = key.split(',').map(Number);
    return {x: column * cellSize, y: row * cellSize, w: cellSize, h: cellSize};
  });
}

/** The slice of the graph the canvas is currently showing, in minimap space. */
export function minimapViewportRect(
  transform: GraphTransform,
  viewport: {w: number; h: number},
  projection: MinimapProjection,
): MinimapRect {
  if (!(transform.scale > 0)) {
    throw new Error(`Minimap viewport requires a positive scale, got ${transform.scale}.`);
  }
  return projectRect(
    projection,
    -transform.x / transform.scale,
    -transform.y / transform.scale,
    viewport.w / transform.scale,
    viewport.h / transform.scale,
  );
}

/** Graph coordinates for a point tapped on the minimap. */
export function graphPointFromMinimap(
  point: {x: number; y: number},
  projection: MinimapProjection,
): {x: number; y: number} {
  if (!(projection.scale > 0)) {
    throw new Error(`Minimap projection requires a positive scale, got ${projection.scale}.`);
  }
  return {
    x: point.x / projection.scale + projection.offsetX,
    y: point.y / projection.scale + projection.offsetY,
  };
}

/** Keeps the current zoom and re-centres the canvas on a graph point. */
export function transformCenteredOn(
  graphPoint: {x: number; y: number},
  transform: GraphTransform,
  viewport: {w: number; h: number},
): GraphTransform {
  return {
    ...transform,
    x: viewport.w / 2 - graphPoint.x * transform.scale,
    y: viewport.h / 2 - graphPoint.y * transform.scale,
  };
}

/**
 * The overview only earns its space once the tree outgrows the canvas; below that the map would
 * show a rectangle covering everything already on screen.
 */
export function shouldShowMinimap(
  layout: Pick<GraphLayout, 'minX' | 'minY' | 'maxX' | 'maxY' | 'nodes'>,
  viewport: {w: number; h: number},
  transform: GraphTransform,
): boolean {
  if (layout.nodes.length < 2 || !(transform.scale > 0)) return false;
  if (!(viewport.w > 0) || !(viewport.h > 0)) return false;
  const visibleWidth = viewport.w / transform.scale;
  const visibleHeight = viewport.h / transform.scale;
  return (
    layout.maxX - layout.minX > visibleWidth || layout.maxY - layout.minY > visibleHeight
  );
}

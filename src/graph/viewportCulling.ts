import type {GraphLayout, EdgeRect, LaidNode} from './layout.ts';
import type {GraphTransform} from './panGesture.ts';

export const GRAPH_VIEWPORT_OVERSCAN = 240;

export interface GraphViewport {
  w: number;
  h: number;
}

export interface VisibleGraphElements {
  nodes: LaidNode[];
  edges: EdgeRect[];
  culled: boolean;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersectsViewport(
  bounds: Bounds,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  return (
    right >= bounds.left &&
    left <= bounds.right &&
    bottom >= bounds.top &&
    top <= bounds.bottom
  );
}

function edgeBounds(edge: EdgeRect): Bounds {
  const angle = edge.angle ?? 0;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const halfWidth = (cosine * edge.w + sine * edge.h) / 2;
  const halfHeight = (sine * edge.w + cosine * edge.h) / 2;
  const centerX = edge.x + edge.w / 2;
  const centerY = edge.y + edge.h / 2;
  return {
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
  };
}

/**
 * Return only graph geometry that can intersect the current pan/zoom viewport.
 * Layout remains complete, so Fit and totals retain full-tree behavior while
 * React avoids mounting thousands of off-screen recipe and connector views.
 */
export function visibleGraphElements(
  graph: GraphLayout,
  transform: GraphTransform,
  viewport: GraphViewport,
  overscan = GRAPH_VIEWPORT_OVERSCAN,
  includeEdges = true,
): VisibleGraphElements {
  if (
    viewport.w <= 0 ||
    viewport.h <= 0 ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    const root = graph.nodes.find(node => node.item.id === 'root');
    return {
      nodes: root ? [root] : graph.nodes.slice(0, 1),
      edges: [],
      culled: graph.nodes.length > 1 || graph.edges.length > 0,
    };
  }

  const bounds = {
    left: (-transform.x - overscan) / transform.scale,
    top: (-transform.y - overscan) / transform.scale,
    right: (viewport.w - transform.x + overscan) / transform.scale,
    bottom: (viewport.h - transform.y + overscan) / transform.scale,
  };
  const nodes = graph.nodes.filter(node =>
    intersectsViewport(
      bounds,
      node.x,
      node.y,
      node.x + node.w,
      node.y + node.h,
    ),
  );
  const edges = includeEdges
    ? graph.edges.filter(edge => {
        const edgeRect = edgeBounds(edge);
        return intersectsViewport(
          bounds,
          edgeRect.left,
          edgeRect.top,
          edgeRect.right,
          edgeRect.bottom,
        );
      })
    : [];
  return {
    nodes,
    edges,
    culled: nodes.length < graph.nodes.length || edges.length < graph.edges.length,
  };
}

/**
 * Culling runs against the live transform, so panning rebuilt the visible node and edge arrays on
 * every frame -- and with them every React element in the graph. That allocation churn is what
 * shows up as garbage collection in a profile of a drag, on both platforms. The overscan already
 * renders a margin beyond the viewport, so the visible set only has to be recomputed once the
 * canvas has moved far enough to eat into it.
 */
export function shouldRecomputeCulling(
  previous: GraphTransform,
  next: GraphTransform,
  overscan = GRAPH_VIEWPORT_OVERSCAN,
): boolean {
  if (previous.scale !== next.scale) return true;
  // Half the margin, so a recompute always lands well before the edge of what was drawn.
  const threshold = Math.max(1, (overscan / 2) * next.scale);
  return (
    Math.abs(next.x - previous.x) >= threshold || Math.abs(next.y - previous.y) >= threshold
  );
}

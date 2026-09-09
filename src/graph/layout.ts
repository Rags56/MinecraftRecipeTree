import type {Recipe} from '../types.ts';
import {pixelArtDisplaySize} from '../data/pixelArtSizing.ts';
import {isEmcTransmutationSource} from './model.ts';
import type {ItemTreeNode, SourceTreeNode} from './model.ts';
import type {NodeByproductCoverage} from './treeTotals.ts';

export const ITEM_W = 172;
export const ITEM_H = 58;
export const COMPACT_ITEM_SIZE = 52;
export const COMPACT_ROOT_DIAMOND_SIZE = 48;
export const COMPACT_ROOT_SIZE = Math.ceil(COMPACT_ROOT_DIAMOND_SIZE * Math.SQRT2);
export const COMPACT_LABEL_WIDTH = 96;
export const COMPACT_LABEL_HEIGHT = 16;
export const COMPACT_ROOT_LABEL_GAP = 8;
export const COMPACT_ROOT_LABEL_HEIGHT = COMPACT_ROOT_LABEL_GAP + 12;
/** Two-line source header: item name and amount above its recipe type. */
export const SOURCE_HEADER = 34;
/** Fixed placed-block canvas used for structure recipes inside the graph. */
export const SOURCE_STRUCTURE_PREVIEW_WIDTH = 280;
export const SOURCE_STRUCTURE_PREVIEW_HEIGHT = 220;
/** Structured ProjectE recipe canvas containing the compact EMC → item flow. */
export const SOURCE_EMC_PREVIEW_WIDTH = 260;
export const SOURCE_EMC_PREVIEW_HEIGHT = 54;
/** Extra space inside an expanded root recipe while its inline controls are open. */
export const ROOT_SOURCE_ACTIONS_WIDTH = 44;
export const ROOT_SOURCE_ACTIONS_HEIGHT = 46;
/** Standalone controls shown around a collapsed/compact starting item. */
export const ROOT_ATTACHED_ACTIONS_WIDTH = 220;
export const ROOT_ATTACHED_ACTIONS_HEIGHT = 62;
/** Vertical gap between tree levels (rows). */
const LEVEL_GAP = 48;
/** Horizontal gap between siblings. */
const SIBLING_GAP = 18;
const EDGE_T = 2;

/**
 * Keep the starting item's visual center independent from the extra collision
 * space reserved for its controls. Radial layout already returns the visual
 * node bounds, so applying the tidy-tree correction there would move the item
 * away from the connector's center.
 */
export function attachedRootVisualX(
  layoutX: number,
  layoutWidth: number,
  radialLayout: boolean,
  showRootActions: boolean,
): number {
  if (radialLayout || !showRootActions) return layoutX;
  return layoutX + (layoutWidth - COMPACT_ROOT_SIZE) / 2;
}

export interface LaidNode {
  id: string;
  kind: 'item' | 'source';
  x: number;
  y: number;
  w: number;
  h: number;
  /** The tree item (owner for both kinds). */
  item: ItemTreeNode;
  source?: SourceTreeNode;
  /** Collapsed radial-layout ingredient rendered as an upright icon. */
  radial?: boolean;
  /** Tree depth used to keep expanded compact-mode branch context legible. */
  depth?: number;
  /** Expanded source node that receives a persistent compact branch label. */
  compactBranch?: boolean;
}

export interface EdgeRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional clockwise rotation in radians around the rectangle center. */
  angle?: number;
}

export interface GraphLayout {
  nodes: LaidNode[];
  edges: EdgeRect[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ByproductSupplyEdge extends EdgeRect {
  targetNodeId: string;
  producerSourceId: string;
}

function distanceToNodeEdge(node: LaidNode, ux: number, uy: number): number {
  const horizontal = Math.abs(ux) > Number.EPSILON
    ? node.w / 2 / Math.abs(ux)
    : Number.POSITIVE_INFINITY;
  const vertical = Math.abs(uy) > Number.EPSILON
    ? node.h / 2 / Math.abs(uy)
    : Number.POSITIVE_INFINITY;
  return Math.min(horizontal, vertical);
}

/**
 * Connect every ingredient receiving byproduct credit to the exact recipe
 * source whose extra output supplied it. The line stops at each node's edge so
 * its dotted treatment never obscures the item or recipe preview.
 */
export function byproductSupplyEdges(
  nodes: LaidNode[],
  coverages: Iterable<NodeByproductCoverage>,
): ByproductSupplyEdge[] {
  const producerNodes = new Map(
    nodes
      .filter(node => node.kind === 'source')
      .map(node => [node.id, node] as const),
  );
  const itemNodes = new Map(nodes.map(node => [node.item.id, node] as const));
  const seen = new Set<string>();
  const edges: ByproductSupplyEdge[] = [];

  for (const coverage of coverages) {
    const target = itemNodes.get(coverage.nodeId);
    if (!target || coverage.creditedAmount <= 0) continue;
    for (const allocation of coverage.allocations) {
      if (allocation.amount <= 0) continue;
      const producer = producerNodes.get(allocation.producerSourceId);
      const identity = `${coverage.nodeId}\u0000${allocation.producerSourceId}`;
      if (!producer || seen.has(identity)) continue;
      seen.add(identity);

      const producerCenterX = producer.x + producer.w / 2;
      const producerCenterY = producer.y + producer.h / 2;
      const targetCenterX = target.x + target.w / 2;
      const targetCenterY = target.y + target.h / 2;
      const dx = targetCenterX - producerCenterX;
      const dy = targetCenterY - producerCenterY;
      const centerDistance = Math.hypot(dx, dy);
      if (centerDistance <= Number.EPSILON) continue;
      const ux = dx / centerDistance;
      const uy = dy / centerDistance;
      const startInset = distanceToNodeEdge(producer, ux, uy) + 2;
      const endInset = distanceToNodeEdge(target, ux, uy) + 2;
      const length = centerDistance - startInset - endInset;
      if (length <= 0) continue;
      const startX = producerCenterX + ux * startInset;
      const startY = producerCenterY + uy * startInset;
      const endX = targetCenterX - ux * endInset;
      const endY = targetCenterY - uy * endInset;
      const midpointX = (startX + endX) / 2;
      const midpointY = (startY + endY) / 2;

      edges.push({
        targetNodeId: coverage.nodeId,
        producerSourceId: allocation.producerSourceId,
        x: midpointX - length / 2,
        y: midpointY - 1,
        w: length,
        h: 2,
        angle: Math.atan2(dy, dx),
      });
    }
  }
  return edges;
}

export function recipeImageDisplay(recipe: Recipe): {w: number; h: number} {
  const w = recipe.w ?? 160;
  const h = recipe.h ?? 60;
  return pixelArtDisplaySize(w, h, 280, 220);
}

export function sourceNodeSize(
  source: SourceTreeNode,
  showRootActions = false,
): {w: number; h: number} {
  const actionWidth = showRootActions ? ROOT_SOURCE_ACTIONS_WIDTH : 0;
  const actionHeight = showRootActions ? ROOT_SOURCE_ACTIONS_HEIGHT : 0;
  if (source.kind === 'recipe' && source.recipe) {
    if (isEmcTransmutationSource(source)) {
      return {
        w: SOURCE_EMC_PREVIEW_WIDTH + 12 + actionWidth,
        h: SOURCE_EMC_PREVIEW_HEIGHT + SOURCE_HEADER + 12 + actionHeight,
      };
    }
    if (source.recipe.structure) {
      return {
        w: SOURCE_STRUCTURE_PREVIEW_WIDTH + 12 + actionWidth,
        h: SOURCE_STRUCTURE_PREVIEW_HEIGHT + SOURCE_HEADER + 12 + actionHeight,
      };
    }
    const img = recipeImageDisplay(source.recipe);
    return {
      w: Math.max(180, img.w + 12) + actionWidth,
      h: img.h + SOURCE_HEADER + 12 + actionHeight,
    };
  }
  if (source.kind === 'mob') {
    return {w: 210 + actionWidth, h: SOURCE_HEADER + 66 + actionHeight};
  }
  return {w: 210 + actionWidth, h: SOURCE_HEADER + 44 + actionHeight};
}

function treeNodeSize(
  node: ItemTreeNode,
  compact: boolean,
  isRoot = false,
  showRootActions = false,
): {w: number; h: number} {
  if (compact) {
    if (isRoot) {
      return showRootActions
        ? {
            w: ROOT_ATTACHED_ACTIONS_WIDTH,
            h: COMPACT_ROOT_SIZE + ROOT_ATTACHED_ACTIONS_HEIGHT,
          }
        : {w: COMPACT_ROOT_SIZE, h: COMPACT_ROOT_SIZE};
    }
    return {w: COMPACT_ITEM_SIZE, h: COMPACT_ITEM_SIZE};
  }
  if (node.source) {
    return sourceNodeSize(node.source, isRoot && showRootActions);
  }
  return isRoot && showRootActions
    ? {w: ITEM_W + ROOT_SOURCE_ACTIONS_WIDTH, h: ITEM_H + ROOT_ATTACHED_ACTIONS_HEIGHT}
    : {w: ITEM_W, h: ITEM_H};
}

/**
 * Tidy top-down tree layout. Expanded items are drawn as a single source node in
 * their item's place; collapsed items are small item nodes. Descendant bands
 * remain disjoint, while immediate inputs anchor into a compact parent-centered
 * row whenever those bands allow it. Edges run child-top -> parent-bottom.
 */
export function layoutTree(
  root: ItemTreeNode,
  compact = false,
  showCompactLabels = false,
  showRootActions = false,
): GraphLayout {
  const nodes: LaidNode[] = [];
  const edges: EdgeRect[] = [];

  // Pass 1: row heights per depth.
  const rowH: number[] = [];
  const seeH = (d: number, h: number) => {
    rowH[d] = Math.max(rowH[d] ?? 0, h);
  };
  const rowStack: Array<{node: ItemTreeNode; depth: number}> = [{node: root, depth: 0}];
  while (rowStack.length > 0) {
    const {node, depth} = rowStack.pop()!;
    if (node.source) {
      seeH(depth, treeNodeSize(node, compact, depth === 0, showRootActions).h);
      for (let index = node.source.inputs.length - 1; index >= 0; index -= 1) {
        rowStack.push({node: node.source.inputs[index], depth: depth + 1});
      }
    } else {
      seeH(depth, treeNodeSize(node, compact, depth === 0).h);
    }
  }

  const rowTop: number[] = [0];
  for (let d = 1; d < rowH.length; d++) {
    rowTop[d] = rowTop[d - 1] + rowH[d - 1] + LEVEL_GAP;
  }

  // Pass 2: Buchheim's linear-time tidy-tree algorithm. Contour apportionment
  // separates only rows that actually overlap, so a wide descendant fan does
  // not create unnecessary space between its parent and leaf siblings.
  interface LayoutRecord {
    node: ItemTreeNode;
    size: {w: number; h: number};
    parent?: LayoutRecord;
    children: LayoutRecord[];
    index: number;
    depth: number;
    prelim: number;
    mod: number;
    shift: number;
    change: number;
    thread?: LayoutRecord;
    ancestor: LayoutRecord;
    defaultAncestor?: LayoutRecord;
    center: number;
  }

  const createRecord = (
    node: ItemTreeNode,
    parent: LayoutRecord | undefined,
    index: number,
  ): LayoutRecord => {
    const record = {
      node,
      size: treeNodeSize(node, compact, parent === undefined, showRootActions),
      parent,
      children: [],
      index,
      depth: parent ? parent.depth + 1 : 0,
      prelim: 0,
      mod: 0,
      shift: 0,
      change: 0,
      ancestor: undefined as unknown as LayoutRecord,
      center: 0,
    };
    record.ancestor = record;
    return record;
  };

  const rootRecord = createRecord(root, undefined, 0);
  const traversal: LayoutRecord[] = [];
  const flattenStack = [rootRecord];
  while (flattenStack.length > 0) {
    const record = flattenStack.pop()!;
    traversal.push(record);
    const inputs = record.node.source?.inputs ?? [];
    record.children = inputs.map((input, index) => createRecord(input, record, index));
    for (let index = record.children.length - 1; index >= 0; index -= 1) {
      flattenStack.push(record.children[index]);
    }
  }
  const postorder: LayoutRecord[] = [];
  const postorderStack: Array<{record: LayoutRecord; visited: boolean}> = [
    {record: rootRecord, visited: false},
  ];
  while (postorderStack.length > 0) {
    const frame = postorderStack.pop()!;
    if (frame.visited) {
      postorder.push(frame.record);
      continue;
    }
    postorderStack.push({record: frame.record, visited: true});
    for (let index = frame.record.children.length - 1; index >= 0; index -= 1) {
      postorderStack.push({record: frame.record.children[index], visited: false});
    }
  }

  const leftSibling = (record: LayoutRecord): LayoutRecord | undefined =>
    record.index > 0 ? record.parent?.children[record.index - 1] : undefined;
  const leftmostSibling = (record: LayoutRecord): LayoutRecord | undefined =>
    record.index > 0 ? record.parent?.children[0] : undefined;
  const nextLeft = (record: LayoutRecord): LayoutRecord | undefined =>
    record.children[0] ?? record.thread;
  const nextRight = (record: LayoutRecord): LayoutRecord | undefined =>
    record.children[record.children.length - 1] ?? record.thread;
  const separation = (left: LayoutRecord, right: LayoutRecord): number =>
    left.size.w / 2 +
    (compact && showCompactLabels
      ? Math.max(SIBLING_GAP, COMPACT_LABEL_WIDTH - COMPACT_ITEM_SIZE)
      : SIBLING_GAP) +
    right.size.w / 2;

  const moveSubtree = (left: LayoutRecord, right: LayoutRecord, shift: number) => {
    const subtreeCount = right.index - left.index;
    if (subtreeCount <= 0) {
      throw new Error('Graph contour apportionment received an invalid sibling order.');
    }
    right.change -= shift / subtreeCount;
    right.shift += shift;
    left.change += shift / subtreeCount;
    right.prelim += shift;
    right.mod += shift;
  };

  const executeShifts = (record: LayoutRecord) => {
    let shift = 0;
    let change = 0;
    for (let index = record.children.length - 1; index >= 0; index -= 1) {
      const child = record.children[index];
      child.prelim += shift;
      child.mod += shift;
      change += child.change;
      shift += child.shift + change;
    }
  };

  const apportion = (
    record: LayoutRecord,
    defaultAncestor: LayoutRecord,
  ): LayoutRecord => {
    const left = leftSibling(record);
    if (!left) return defaultAncestor;

    let innerRight = record;
    let outerRight = record;
    let innerLeft = left;
    let outerLeft = leftmostSibling(record);
    if (!outerLeft) {
      throw new Error('Graph contour apportionment could not find the leftmost sibling.');
    }
    let innerRightMod = innerRight.mod;
    let outerRightMod = outerRight.mod;
    let innerLeftMod = innerLeft.mod;
    let outerLeftMod = outerLeft.mod;

    while (nextRight(innerLeft) && nextLeft(innerRight)) {
      innerLeft = nextRight(innerLeft)!;
      innerRight = nextLeft(innerRight)!;
      const followingOuterLeft = nextLeft(outerLeft);
      const followingOuterRight = nextRight(outerRight);
      if (!followingOuterLeft || !followingOuterRight) {
        throw new Error('Graph contour traversal ended before its inner contour.');
      }
      outerLeft = followingOuterLeft;
      outerRight = followingOuterRight;
      outerRight.ancestor = record;

      const contourShift =
        innerLeft.prelim +
        innerLeftMod -
        (innerRight.prelim + innerRightMod) +
        separation(innerLeft, innerRight);
      if (contourShift > 0) {
        const ancestor =
          innerLeft.ancestor.parent === record.parent
            ? innerLeft.ancestor
            : defaultAncestor;
        moveSubtree(ancestor, record, contourShift);
        innerRightMod += contourShift;
        outerRightMod += contourShift;
      }

      innerLeftMod += innerLeft.mod;
      innerRightMod += innerRight.mod;
      outerLeftMod += outerLeft.mod;
      outerRightMod += outerRight.mod;
    }

    if (nextRight(innerLeft) && !nextRight(outerRight)) {
      outerRight.thread = nextRight(innerLeft);
      outerRight.mod += innerLeftMod - outerRightMod;
    } else if (nextLeft(innerRight) && !nextLeft(outerLeft)) {
      outerLeft.thread = nextLeft(innerRight);
      outerLeft.mod += innerRightMod - outerLeftMod;
      return record;
    }
    return defaultAncestor;
  };

  for (const record of postorder) {
    if (record.children.length === 0) {
      const left = leftSibling(record);
      if (left) record.prelim = left.prelim + separation(left, record);
    } else {
      executeShifts(record);
      const first = record.children[0];
      const last = record.children[record.children.length - 1];
      const midpoint = (first.prelim + last.prelim) / 2;
      const left = leftSibling(record);
      if (left) {
        record.prelim = left.prelim + separation(left, record);
        record.mod = record.prelim - midpoint;
      } else {
        record.prelim = midpoint;
      }
    }

    if (record.parent) {
      record.parent.defaultAncestor = apportion(
        record,
        record.parent.defaultAncestor ?? record.parent.children[0],
      );
    }
  }

  const modifierByRecord = new Map<LayoutRecord, number>([
    [rootRecord, -rootRecord.prelim],
  ]);
  for (const record of traversal) {
    const modifier = modifierByRecord.get(record);
    if (modifier === undefined) {
      throw new Error(`Graph layout modifier is missing for node ${record.node.id}.`);
    }
    record.center = record.prelim + modifier;
    for (const child of record.children) {
      modifierByRecord.set(child, modifier + record.mod);
    }
  }

  // Pass 3: emit nodes and one direct edge per relationship. Shared elbow rows
  // made unrelated branches look connected when their horizontal segments
  // overlapped; direct segments can only meet at their real parent endpoint.
  const connect = (x1: number, y1: number, x2: number, y2: number) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!(length > 0) || !Number.isFinite(length)) {
      throw new Error('Tree graph edge endpoints must have distinct finite positions.');
    }
    edges.push({
      x: (x1 + x2) / 2 - length / 2,
      y: (y1 + y2) / 2 - EDGE_T / 2,
      w: length,
      h: EDGE_T,
      angle: Math.atan2(y2 - y1, x2 - x1),
    });
  };

  for (const record of traversal) {
    const {node, depth, center, size} = record;
    const x = center - size.w / 2;
    const y = rowTop[depth];
    if (!node.source) {
      nodes.push({
        id: node.id,
        kind: 'item',
        x,
        y,
        w: size.w,
        h: size.h,
        item: node,
      });
      continue;
    }
    nodes.push({
      id: node.source.id,
      kind: 'source',
      x,
      y,
      w: size.w,
      h: size.h,
      item: node,
      source: node.source,
    });

    for (const child of record.children) {
      connect(
        child.center,
        rowTop[depth + 1],
        center,
        y + size.h,
      );
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
    if (compact && showCompactLabels) {
      const labelOverflow = Math.max(0, (COMPACT_LABEL_WIDTH - n.w) / 2);
      minX = Math.min(minX, n.x - labelOverflow);
      maxX = Math.max(maxX, n.x + n.w + labelOverflow);
      maxY = Math.max(
        maxY,
        n.y +
          n.h +
          (n.item.id === root.id ? COMPACT_ROOT_LABEL_HEIGHT : COMPACT_LABEL_HEIGHT),
      );
    }
  }
  return {nodes, edges, minX, minY, maxX, maxY};
}

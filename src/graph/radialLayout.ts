import type {EdgeRect, GraphLayout, LaidNode} from './layout.ts';
import {
  COMPACT_LABEL_HEIGHT,
  COMPACT_LABEL_WIDTH,
  COMPACT_ITEM_SIZE,
  COMPACT_ROOT_LABEL_HEIGHT,
  ROOT_ATTACHED_ACTIONS_HEIGHT,
  ROOT_ATTACHED_ACTIONS_WIDTH,
  sourceNodeSize,
} from './layout.ts';
import {visibleInputs} from './treeFocus.ts';
import type {ItemTreeNode} from './model.ts';

const FULL_TURN = Math.PI * 2;
const EDGE_THICKNESS = 2;
const EDGE_ROUTING_GAP = 10;
const EDGE_ROUTING_MIN_OBSTACLE_HEIGHT = 128;
const EDGE_ROUTING_MIN_OBSTACLE_WIDTH = 260;
const RADIAL_DEPTH_GAP = 64;
export const RADIAL_NODE_GAP = 20;
const RADIAL_TERMINAL_GAP = RADIAL_NODE_GAP;
const RADIAL_COLLISION_ROTATION_STEP = Math.PI / 36;
const RADIAL_COLLISION_ROTATION_STEPS = 8;
const MAX_COLLISION_PLACEMENT_ATTEMPTS = 100_000;
const MIN_STAGGERED_ROW_SEARCH = 8;
const MIN_LOCAL_FAN_SPAN = Math.PI / 7.5;
const MAX_LOCAL_FAN_SPAN = Math.PI * 5 / 6;

export const RADIAL_ITEM_SIZE = 52;
export const RADIAL_ROOT_DIAMOND_SIZE = 72;
export const RADIAL_ROOT_SIZE = Math.ceil(RADIAL_ROOT_DIAMOND_SIZE * Math.SQRT2);
const RADIAL_EXPANDED_ROOT_HORIZONTAL_GROWTH = 24;
const RADIAL_EXPANDED_ROOT_VERTICAL_GROWTH = 18;

export interface StaggeredRadialRows {
  rowCount: number;
  rowGap: number;
  baseRadius: number;
  outerRadius: number;
  rowByIndex: number[];
  radiusByIndex: number[];
}

function positiveAngularDelta(from: number, to: number): number {
  const delta = to - from;
  return delta > 0 ? delta : delta + FULL_TURN;
}

/**
 * Assign one ordered polar level to collision-safe concentric rows.
 *
 * Adjacent angular nodes are interleaved between rows. The planner evaluates a
 * square-root-sized search for the smallest outer radius, so its row count can
 * continue growing with a very large level without an expensive quadratic
 * scan or an arbitrary fixed ceiling.
 */
export function planStaggeredRadialRows(
  angles: number[],
  diameters: number[],
  minimumRadius: number,
): StaggeredRadialRows {
  if (angles.length === 0 || angles.length !== diameters.length) {
    throw new Error('Radial row planning requires matching non-empty angle and diameter arrays.');
  }
  if (!Number.isFinite(minimumRadius) || minimumRadius <= 0) {
    throw new Error('Radial row planning requires a positive finite minimum radius.');
  }
  angles.forEach((angle, index) => {
    if (!Number.isFinite(angle)) {
      throw new Error(`Radial row angle ${index} must be finite.`);
    }
    if (index > 0 && angle <= angles[index - 1]) {
      throw new Error('Radial row angles must be strictly increasing.');
    }
  });
  diameters.forEach((diameter, index) => {
    if (!Number.isFinite(diameter) || diameter <= 0) {
      throw new Error(`Radial node diameter ${index} must be positive and finite.`);
    }
  });

  let maximumDiameter = 0;
  for (const diameter of diameters) maximumDiameter = Math.max(maximumDiameter, diameter);
  const rowGap = maximumDiameter + RADIAL_NODE_GAP;
  let best: StaggeredRadialRows | null = null;
  const maximumRows = Math.min(
    angles.length,
    Math.max(MIN_STAGGERED_ROW_SEARCH, Math.ceil(Math.sqrt(angles.length))),
  );

  for (let rowCount = 1; rowCount <= maximumRows; rowCount += 1) {
    const rowByIndex = angles.map((_, index) => index % rowCount);
    let baseRadius = minimumRadius;

    for (let row = 0; row < rowCount; row += 1) {
      const indices: number[] = [];
      for (let index = row; index < angles.length; index += rowCount) indices.push(index);
      if (indices.length <= 1) continue;

      indices.forEach((index, offset) => {
        const nextIndex = indices[(offset + 1) % indices.length];
        const angularDelta = positiveAngularDelta(angles[index], angles[nextIndex]);
        const sine = Math.sin(angularDelta / 2);
        if (!(sine > 0)) {
          throw new Error('Radial row planning encountered coincident angular nodes.');
        }
        const requiredSeparation =
          diameters[index] / 2 + diameters[nextIndex] / 2 + RADIAL_NODE_GAP;
        const requiredRowRadius = requiredSeparation / (2 * sine);
        baseRadius = Math.max(baseRadius, requiredRowRadius - row * rowGap);
      });
    }

    const radiusByIndex = rowByIndex.map(row => baseRadius + row * rowGap);
    let outerRadius = 0;
    radiusByIndex.forEach((radius, index) => {
      outerRadius = Math.max(outerRadius, radius + diameters[index] / 2);
    });
    const candidate = {
      rowCount,
      rowGap,
      baseRadius,
      outerRadius,
      rowByIndex,
      radiusByIndex,
    };
    if (
      !best ||
      candidate.outerRadius < best.outerRadius - 0.001 ||
      (Math.abs(candidate.outerRadius - best.outerRadius) <= 0.001 &&
        candidate.rowCount < best.rowCount)
    ) {
      best = candidate;
    }
  }

  if (!best) {
    throw new Error('Radial row planning did not produce a finite layout.');
  }
  return best;
}

function rotateSubtreeAngles(
  units: RadialUnit[],
  rootIndex: number,
  angularDelta: number,
): void {
  if (Math.abs(angularDelta) <= 1e-9) return;
  const stack = [rootIndex];
  while (stack.length > 0) {
    const index = stack.pop()!;
    const unit = units[index];
    unit.angle += angularDelta;
    unit.leafStart += angularDelta;
    unit.leafEnd += angularDelta;
    for (const childIndex of unit.children) stack.push(childIndex);
  }
}

/**
 * Compress a non-root recipe's children into an outward-facing local fan.
 *
 * Global leaf sectors are useful for separating the root branches, but reusing
 * their full width at every descendant creates large hollow wedges. Local fans
 * retain the branch direction while using only the angle needed by this
 * recipe's immediate inputs; the stagger planner handles denser groups.
 */
function packLocalChildAngles(
  units: RadialUnit[],
  parentIndex: number,
  minimumParentDistance: number,
): void {
  const parent = units[parentIndex];
  const childIndices = parent.children;
  if (parent.depth === 0 || childIndices.length === 0) return;
  if (childIndices.length === 1) {
    rotateSubtreeAngles(
      units,
      childIndices[0],
      parent.angle - units[childIndices[0]].angle,
    );
    return;
  }

  let maximumDiameter = 0;
  for (const childIndex of childIndices) {
    maximumDiameter = Math.max(
      maximumDiameter,
      units[childIndex].collisionDiameter,
    );
  }
  const separationRatio = Math.min(
    0.95,
    (maximumDiameter + RADIAL_NODE_GAP) / (2 * minimumParentDistance),
  );
  const minimumAngularSeparation = 2 * Math.asin(separationRatio);
  const requiredSpan = Math.min(
    MAX_LOCAL_FAN_SPAN,
    minimumAngularSeparation * (childIndices.length - 1),
  );
  const originalSpan =
    units[childIndices[childIndices.length - 1]].angle -
    units[childIndices[0]].angle;
  if (!(originalSpan >= 0) || !Number.isFinite(originalSpan)) {
    throw new Error(`Radial graph branch ${parentIndex} has invalid child angles.`);
  }
  const preferredMaximumSpan = Math.max(
    MIN_LOCAL_FAN_SPAN,
    requiredSpan * 1.15,
  );
  const targetSpan = Math.max(
    requiredSpan,
    Math.min(originalSpan, preferredMaximumSpan, MAX_LOCAL_FAN_SPAN),
  );
  const firstAngle = parent.angle - targetSpan / 2;
  const angularStep = targetSpan / (childIndices.length - 1);
  childIndices.forEach((childIndex, offset) => {
    const targetAngle = firstAngle + angularStep * offset;
    rotateSubtreeAngles(
      units,
      childIndex,
      targetAngle - units[childIndex].angle,
    );
  });
}

interface RadialUnit {
  item: ItemTreeNode;
  children: number[];
  parentIndex: number | null;
  rootBranchIndex: number;
  depth: number;
  visualW: number;
  visualH: number;
  collisionW: number;
  collisionH: number;
  collisionOffsetY: number;
  collisionDiameter: number;
  terminal: boolean;
  leafCount: number;
  leafStart: number;
  leafEnd: number;
  angle: number;
  centerX: number;
  centerY: number;
}

function makeRadialUnit(
  item: ItemTreeNode,
  depth: number,
  parentIndex: number | null,
  rootBranchIndex: number,
  terminal: boolean,
): RadialUnit {
  const visualSize = item.source
    ? sourceNodeSize(item.source)
    : {w: RADIAL_ITEM_SIZE, h: RADIAL_ITEM_SIZE};
  const collisionSize = item.source
    ? visualSize
    : {w: RADIAL_ITEM_SIZE, h: RADIAL_ITEM_SIZE};
  return {
    item,
    children: [],
    parentIndex,
    rootBranchIndex,
    depth,
    visualW: visualSize.w,
    visualH: visualSize.h,
    collisionW: collisionSize.w,
    collisionH: collisionSize.h,
    collisionOffsetY: 0,
    collisionDiameter: Math.max(collisionSize.w, collisionSize.h),
    terminal,
    leafCount: 0,
    leafStart: 0,
    leafEnd: 0,
    angle: 0,
    centerX: 0,
    centerY: 0,
  };
}

function flattenRadialTree(
  root: ItemTreeNode,
  compact: boolean,
  isTerminal: (item: ItemTreeNode) => boolean,
  showLabels: boolean,
  showRootActions: boolean,
  visibleNodeIds?: ReadonlySet<string>,
): RadialUnit[] {
  const rootUnit = makeRadialUnit(root, 0, null, -1, false);
  if (compact) {
    rootUnit.visualW = RADIAL_ROOT_SIZE;
    rootUnit.visualH = RADIAL_ROOT_SIZE;
    rootUnit.collisionW = showLabels
      ? Math.max(COMPACT_LABEL_WIDTH, RADIAL_ROOT_SIZE)
      : RADIAL_ROOT_SIZE;
    rootUnit.collisionH = showLabels
      ? RADIAL_ROOT_SIZE + COMPACT_ROOT_LABEL_HEIGHT
      : RADIAL_ROOT_SIZE;
    if (showRootActions) {
      rootUnit.collisionW = Math.max(
        rootUnit.collisionW,
        ROOT_ATTACHED_ACTIONS_WIDTH,
      );
      rootUnit.collisionH = Math.max(
        rootUnit.collisionH,
        RADIAL_ROOT_SIZE + ROOT_ATTACHED_ACTIONS_HEIGHT,
      );
    }
    rootUnit.collisionDiameter = Math.max(rootUnit.collisionW, rootUnit.collisionH);
  } else if (!root.source) {
    rootUnit.visualW = RADIAL_ROOT_SIZE;
    rootUnit.visualH = RADIAL_ROOT_SIZE;
    rootUnit.collisionW = showLabels
      ? Math.max(COMPACT_LABEL_WIDTH, RADIAL_ROOT_SIZE)
      : RADIAL_ROOT_SIZE;
    rootUnit.collisionH = showLabels
      ? RADIAL_ROOT_SIZE + COMPACT_ROOT_LABEL_HEIGHT
      : RADIAL_ROOT_SIZE;
    rootUnit.collisionDiameter = Math.max(rootUnit.collisionW, rootUnit.collisionH);
  } else {
    const rootSourceSize = sourceNodeSize(root.source, showRootActions);
    rootUnit.visualW = rootSourceSize.w;
    rootUnit.visualH = rootSourceSize.h;
    rootUnit.visualW += RADIAL_EXPANDED_ROOT_HORIZONTAL_GROWTH;
    rootUnit.visualH += RADIAL_EXPANDED_ROOT_VERTICAL_GROWTH;
    rootUnit.collisionW = rootUnit.visualW;
    rootUnit.collisionH = rootUnit.visualH;
    rootUnit.collisionDiameter = Math.max(rootUnit.collisionW, rootUnit.collisionH);
  }
  rootUnit.collisionOffsetY = Math.max(0, rootUnit.collisionH - rootUnit.visualH) / 2;
  const units = [rootUnit];
  const expansionStack = [0];

  while (expansionStack.length > 0) {
    const parentIndex = expansionStack.pop()!;
    const parent = units[parentIndex];
    const inputs = visibleInputs(parent.item, visibleNodeIds);
    for (const input of inputs) {
      const child = makeRadialUnit(
        input,
        parent.depth + 1,
        parentIndex,
        parent.depth === 0 ? units.length : parent.rootBranchIndex,
        input.source === undefined && isTerminal(input),
      );
      if (compact) {
        child.visualW = COMPACT_ITEM_SIZE;
        child.visualH = COMPACT_ITEM_SIZE;
        child.collisionW = showLabels ? COMPACT_LABEL_WIDTH : COMPACT_ITEM_SIZE;
        child.collisionH = showLabels
          ? COMPACT_ITEM_SIZE + COMPACT_LABEL_HEIGHT
          : COMPACT_ITEM_SIZE;
        child.collisionDiameter = Math.max(child.collisionW, child.collisionH);
      } else if (!input.source && showLabels) {
        child.collisionW = COMPACT_LABEL_WIDTH;
        child.collisionH = RADIAL_ITEM_SIZE + COMPACT_LABEL_HEIGHT;
        child.collisionDiameter = Math.max(child.collisionW, child.collisionH);
      }
      child.collisionOffsetY = Math.max(0, child.collisionH - child.visualH) / 2;
      const childIndex = units.length;
      units.push(child);
      parent.children.push(childIndex);
    }
    for (let offset = parent.children.length - 1; offset >= 0; offset -= 1) {
      expansionStack.push(parent.children[offset]);
    }
  }
  return units;
}

function calculateAngularSectors(units: RadialUnit[]): void {
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    unit.leafCount =
      unit.children.length === 0
        ? 1
        : unit.children.reduce((sum, childIndex) => sum + units[childIndex].leafCount, 0);
  }
  const totalLeaves = units[0]?.leafCount;
  if (!Number.isSafeInteger(totalLeaves) || totalLeaves <= 0) {
    throw new Error('Radial graph layout could not derive a positive leaf count.');
  }

  units[0].leafStart = 0;
  units[0].leafEnd = FULL_TURN;
  const spanStack = [0];
  while (spanStack.length > 0) {
    const index = spanStack.pop()!;
    const unit = units[index];
    const angularSpan = unit.leafEnd - unit.leafStart;
    let totalAngularWeight = 0;
    for (const childIndex of unit.children) {
      totalAngularWeight += Math.sqrt(units[childIndex].leafCount);
    }
    if (unit.children.length > 0 && !(totalAngularWeight > 0)) {
      throw new Error(`Radial graph branch ${index} has invalid angular weight.`);
    }

    let cursor = unit.leafStart;
    for (const childIndex of unit.children) {
      const child = units[childIndex];
      const childAngularSpan =
        angularSpan * (Math.sqrt(child.leafCount) / totalAngularWeight);
      child.leafStart = cursor;
      child.leafEnd = cursor + childAngularSpan;
      child.angle = (child.leafStart + child.leafEnd) / 2;
      cursor = child.leafEnd;
    }
    for (let offset = unit.children.length - 1; offset >= 0; offset -= 1) {
      spanStack.push(unit.children[offset]);
    }
  }
}

interface SpatialEntry {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

class RadialSpatialIndex {
  private readonly units: RadialUnit[];
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<number>>();
  private readonly entries = new Map<number, SpatialEntry>();

  constructor(units: RadialUnit[]) {
    this.units = units;
    let maximumCollisionDiameter = 0;
    for (const unit of units) {
      maximumCollisionDiameter = Math.max(maximumCollisionDiameter, unit.collisionDiameter);
    }
    this.cellSize = Math.max(96, maximumCollisionDiameter + RADIAL_NODE_GAP);
  }

  private cellKeysFor(x: number, y: number, radius: number): string[] {
    const keys: string[] = [];
    const minColumn = Math.floor((x - radius) / this.cellSize);
    const maxColumn = Math.floor((x + radius) / this.cellSize);
    const minRow = Math.floor((y - radius) / this.cellSize);
    const maxRow = Math.floor((y + radius) / this.cellSize);
    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        keys.push(`${column}:${row}`);
      }
    }
    return keys;
  }

  insert(index: number, x: number, y: number): void {
    if (this.entries.has(index)) {
      throw new Error(`Radial spatial index cannot insert duplicate node ${index}.`);
    }
    const halfW = this.units[index].collisionW / 2;
    const halfH = this.units[index].collisionH / 2;
    const collisionY = y + this.units[index].collisionOffsetY;
    const cells = this.cellKeysFor(x, collisionY, Math.max(halfW, halfH) + RADIAL_NODE_GAP);
    const entry = {
      x,
      y: collisionY,
      halfW,
      halfH,
    };
    this.entries.set(index, entry);
    for (const key of cells) {
      const bucket = this.cells.get(key) ?? new Set<number>();
      bucket.add(index);
      this.cells.set(key, bucket);
    }
  }

  nearestClearDistanceAlongRay(
    index: number,
    originX: number,
    originY: number,
    ux: number,
    uy: number,
    minimumDistance: number,
  ): number {
    if (
      ![originX, originY, ux, uy, minimumDistance].every(Number.isFinite) ||
      minimumDistance <= 0 ||
      Math.abs(Math.hypot(ux, uy) - 1) > 1e-6
    ) {
      throw new Error(`Radial graph node ${index} has an invalid placement ray.`);
    }
    let distance = minimumDistance;
    const halfW = this.units[index].collisionW / 2;
    const halfH = this.units[index].collisionH / 2;
    const collisionOriginY = originY + this.units[index].collisionOffsetY;
    for (let attempts = 0; attempts <= MAX_COLLISION_PLACEMENT_ATTEMPTS; attempts += 1) {
      const x = originX + ux * distance;
      const y = collisionOriginY + uy * distance;
      const candidates = new Set<number>();
      for (const key of this.cellKeysFor(
        x,
        y,
        Math.max(halfW, halfH) + RADIAL_NODE_GAP,
      )) {
        for (const candidate of this.cells.get(key) ?? []) candidates.add(candidate);
      }

      let nextDistance = distance;
      for (const candidate of candidates) {
        const entry = this.entries.get(candidate);
        if (!entry) {
          throw new Error(`Radial spatial index lost node ${candidate}.`);
        }
        const horizontalClearance = halfW + entry.halfW + RADIAL_NODE_GAP - 0.001;
        const verticalClearance = halfH + entry.halfH + RADIAL_NODE_GAP - 0.001;
        if (
          Math.abs(x - entry.x) >= horizontalClearance ||
          Math.abs(y - entry.y) >= verticalClearance
        ) {
          continue;
        }

        const horizontalExit = Math.abs(ux) <= 1e-9
          ? Infinity
          : Math.max(
              (entry.x - horizontalClearance - originX) / ux,
              (entry.x + horizontalClearance - originX) / ux,
            );
        const verticalExit = Math.abs(uy) <= 1e-9
          ? Infinity
          : Math.max(
              (entry.y - verticalClearance - collisionOriginY) / uy,
              (entry.y + verticalClearance - collisionOriginY) / uy,
            );
        const collisionExit = Math.min(horizontalExit, verticalExit);
        if (!Number.isFinite(collisionExit) || collisionExit < distance) {
          throw new Error(`Radial collision exit for node ${index} is invalid.`);
        }
        nextDistance = Math.max(nextDistance, collisionExit + 0.001);
      }
      if (nextDistance <= distance + 1e-9) return distance;
      distance = nextDistance;
    }
    throw new Error(`Radial graph node ${index} could not find collision-free placement.`);
  }
}

function collisionRotationOffsets(parent: RadialUnit): number[] {
  if (parent.depth === 0) return [0];
  const offsets = [0];
  for (let step = 1; step <= RADIAL_COLLISION_ROTATION_STEPS; step += 1) {
    const offset = step * RADIAL_COLLISION_ROTATION_STEP;
    offsets.push(offset, -offset);
  }
  return offsets;
}

/** Minimum parent-relative ray distance that ends strictly farther from the root. */
function minimumOutwardDistance(parent: RadialUnit, ux: number, uy: number): number {
  if (parent.depth === 0) return 0;
  const outwardProjection = parent.centerX * ux + parent.centerY * uy;
  return outwardProjection < 0 ? -2 * outwardProjection + 0.001 : 0;
}

/**
 * Place each sibling at its nearest collision-free radius on one shared local
 * lane. Moving a whole fan outward for one blocked child creates the very long
 * spokes seen in large trees; keeping one fan rotation preserves sibling order,
 * while immediate insertion prevents overlaps without penalizing every child.
 */
function placeBranchLocalRings(units: RadialUnit[], levels: number[][]): void {
  const spatialIndex = new RadialSpatialIndex(units);
  spatialIndex.insert(0, units[0].centerX, units[0].centerY);

  for (let depth = 1; depth < levels.length; depth += 1) {
    const indices = levels[depth];
    if (!indices || indices.length === 0) {
      throw new Error(`Radial graph layout is missing tree depth ${depth}.`);
    }
    const parentIndices = [...new Set(indices.map(index => units[index].parentIndex))]
      .sort((left, right) => {
        if (left === null || right === null) return Number(left === null) - Number(right === null);
        return units[left].angle - units[right].angle || left - right;
      });
    for (const parentIndex of parentIndices) {
      if (parentIndex === null) {
        throw new Error(`Radial graph depth ${depth} contains a parentless node.`);
      }
      const parent = units[parentIndex];
      const childIndices = parent.children;
      const diameters = childIndices.map(index => units[index].collisionDiameter);
      let maximumDiameter = 0;
      for (const diameter of diameters) maximumDiameter = Math.max(maximumDiameter, diameter);
      const allTerminal = childIndices.every(index => units[index].terminal);
      const minimumParentDistance =
        parent.collisionDiameter / 2 +
        maximumDiameter / 2 +
        (allTerminal ? RADIAL_TERMINAL_GAP : RADIAL_DEPTH_GAP);
      packLocalChildAngles(units, parentIndex, minimumParentDistance);
      const packedAngles = childIndices.map(index => units[index].angle);
      const rowPlan = planStaggeredRadialRows(
        packedAngles,
        diameters,
        minimumParentDistance,
      );

      const rotationOffsets = collisionRotationOffsets(parent);
      let fanRotation: number | undefined;
      let bestMaximumExtraDistance = Infinity;
      let bestTotalExtraDistance = Infinity;
      const previewDistanceByChild = new Map<number, number>();
      for (const rotationOffset of rotationOffsets) {
        let maximumExtraDistance = 0;
        let totalExtraDistance = 0;
        const candidateDistances = new Map<number, number>();
        for (let childOffset = 0; childOffset < childIndices.length; childOffset += 1) {
          const childIndex = childIndices[childOffset];
          const child = units[childIndex];
          const preferredDistance = rowPlan.radiusByIndex[childOffset];
          const displayAngle = child.angle + rotationOffset - Math.PI / 2;
          const ux = Math.cos(displayAngle);
          const uy = Math.sin(displayAngle);
          const distance = spatialIndex.nearestClearDistanceAlongRay(
            childIndex,
            parent.centerX,
            parent.centerY,
            ux,
            uy,
            Math.max(preferredDistance, minimumOutwardDistance(parent, ux, uy)),
          );
          const extraDistance = distance - preferredDistance;
          maximumExtraDistance = Math.max(maximumExtraDistance, extraDistance);
          totalExtraDistance += extraDistance;
          candidateDistances.set(childIndex, distance);
        }
        if (
          maximumExtraDistance < bestMaximumExtraDistance - 0.001 ||
          (Math.abs(maximumExtraDistance - bestMaximumExtraDistance) <= 0.001 &&
            totalExtraDistance < bestTotalExtraDistance - 0.001)
        ) {
          fanRotation = rotationOffset;
          bestMaximumExtraDistance = maximumExtraDistance;
          bestTotalExtraDistance = totalExtraDistance;
          previewDistanceByChild.clear();
          for (const [childIndex, distance] of candidateDistances) {
            previewDistanceByChild.set(childIndex, distance);
          }
        }
        if (maximumExtraDistance <= 0.001) break;
      }
      if (fanRotation === undefined) {
        throw new Error(`Radial graph branch ${parentIndex} has no placement lane.`);
      }

      for (let childOffset = 0; childOffset < childIndices.length; childOffset += 1) {
        const childIndex = childIndices[childOffset];
        const child = units[childIndex];
        const preferredDistance = rowPlan.radiusByIndex[childOffset];
        const displayAngle = child.angle + fanRotation - Math.PI / 2;
        const ux = Math.cos(displayAngle);
        const uy = Math.sin(displayAngle);
        const distance = spatialIndex.nearestClearDistanceAlongRay(
          childIndex,
          parent.centerX,
          parent.centerY,
          ux,
          uy,
          Math.max(preferredDistance, previewDistanceByChild.get(childIndex) ?? preferredDistance),
        );
        rotateSubtreeAngles(units, childIndex, fanRotation);
        child.centerX = parent.centerX + ux * distance;
        child.centerY = parent.centerY + uy * distance;
        spatialIndex.insert(childIndex, child.centerX, child.centerY);
      }
    }
  }
}

function clipDistanceToRect(width: number, height: number, ux: number, uy: number): number {
  const horizontal = Math.abs(ux) > 1e-9 ? width / 2 / Math.abs(ux) : Infinity;
  const vertical = Math.abs(uy) > 1e-9 ? height / 2 / Math.abs(uy) : Infinity;
  return Math.min(horizontal, vertical);
}

interface RoutingPoint {
  x: number;
  y: number;
}

interface RoutingObstacle {
  index: number;
  rootBranchIndex: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function segmentIntersectsRect(
  start: RoutingPoint,
  end: RoutingPoint,
  obstacle: Omit<RoutingObstacle, 'index' | 'rootBranchIndex'>,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimumT = 0;
  let maximumT = 1;
  for (const [direction, distance] of [
    [-dx, start.x - obstacle.minX],
    [dx, obstacle.maxX - start.x],
    [-dy, start.y - obstacle.minY],
    [dy, obstacle.maxY - start.y],
  ] as const) {
    if (Math.abs(direction) <= 1e-9) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) minimumT = Math.max(minimumT, ratio);
    else maximumT = Math.min(maximumT, ratio);
    if (minimumT > maximumT) return false;
  }
  return true;
}

class RadialEdgeObstacleIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<number>>();
  private readonly obstacles = new Map<number, RoutingObstacle>();

  get empty(): boolean {
    return this.obstacles.size === 0;
  }

  constructor(units: RadialUnit[]) {
    const isLargeSource = (unit: RadialUnit) =>
      !!unit.item.source &&
      (unit.visualH >= EDGE_ROUTING_MIN_OBSTACLE_HEIGHT ||
        unit.visualW >= EDGE_ROUTING_MIN_OBSTACLE_WIDTH);
    let maximumDiameter = 0;
    for (const unit of units) {
      if (!isLargeSource(unit)) continue;
      maximumDiameter = Math.max(maximumDiameter, unit.collisionDiameter);
    }
    this.cellSize = Math.max(128, maximumDiameter + EDGE_ROUTING_GAP * 2);
    units.forEach((unit, index) => {
      if (!isLargeSource(unit)) return;
      const obstacle = {
        index,
        rootBranchIndex: unit.rootBranchIndex,
        minX: unit.centerX - unit.visualW / 2 - EDGE_ROUTING_GAP,
        minY: unit.centerY - unit.visualH / 2 - EDGE_ROUTING_GAP,
        maxX: unit.centerX + unit.visualW / 2 + EDGE_ROUTING_GAP,
        maxY: unit.centerY + unit.visualH / 2 + EDGE_ROUTING_GAP,
      };
      this.obstacles.set(index, obstacle);
      for (const key of this.cellKeys(obstacle.minX, obstacle.minY, obstacle.maxX, obstacle.maxY)) {
        const entries = this.cells.get(key) ?? new Set<number>();
        entries.add(index);
        this.cells.set(key, entries);
      }
    });
  }

  private cellKeys(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const keys: string[] = [];
    const minColumn = Math.floor(minX / this.cellSize);
    const maxColumn = Math.floor(maxX / this.cellSize);
    const minRow = Math.floor(minY / this.cellSize);
    const maxRow = Math.floor(maxY / this.cellSize);
    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) keys.push(`${column}:${row}`);
    }
    return keys;
  }

  intersecting(
    start: RoutingPoint,
    end: RoutingPoint,
    excluded: ReadonlySet<number>,
    edgeRootBranchIndex: number,
  ): RoutingObstacle[] {
    if (this.obstacles.size === 0) return [];
    const candidates = new Set<number>();
    for (const key of this.cellKeys(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.max(start.x, end.x),
      Math.max(start.y, end.y),
    )) {
      for (const index of this.cells.get(key) ?? []) candidates.add(index);
    }
    return [...candidates]
      .filter(index => !excluded.has(index))
      .map(index => this.obstacles.get(index))
      .filter((obstacle): obstacle is RoutingObstacle => !!obstacle)
      .filter(obstacle => obstacle.rootBranchIndex !== edgeRootBranchIndex)
      .filter(obstacle => segmentIntersectsRect(start, end, obstacle))
      .sort((left, right) => left.index - right.index);
  }
}

function pathLength(points: RoutingPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return length;
}

function routeAroundExpandedSources(
  start: RoutingPoint,
  end: RoutingPoint,
  parentIndex: number,
  childIndex: number,
  edgeRootBranchIndex: number,
  obstacleIndex: RadialEdgeObstacleIndex,
): RoutingPoint[] {
  let points = [start, end];
  const excluded = new Set([parentIndex, childIndex]);
  const routed = new Set<number>();

  while (true) {
    let blockedSegment = -1;
    let blocker: RoutingObstacle | undefined;
    for (let index = 1; index < points.length; index += 1) {
      blocker = obstacleIndex.intersecting(
        points[index - 1],
        points[index],
        new Set([...excluded, ...routed]),
        edgeRootBranchIndex,
      )[0];
      if (blocker) {
        blockedSegment = index;
        break;
      }
    }
    if (!blocker || blockedSegment < 0) return points;

    const before = points[blockedSegment - 1];
    const after = points[blockedSegment];
    const corners = [
      {x: blocker.minX, y: blocker.minY},
      {x: blocker.maxX, y: blocker.minY},
      {x: blocker.maxX, y: blocker.maxY},
      {x: blocker.minX, y: blocker.maxY},
    ];
    const innerObstacle = {
      minX: blocker.minX + EDGE_ROUTING_GAP / 2,
      minY: blocker.minY + EDGE_ROUTING_GAP / 2,
      maxX: blocker.maxX - EDGE_ROUTING_GAP / 2,
      maxY: blocker.maxY - EDGE_ROUTING_GAP / 2,
    };
    const candidates: RoutingPoint[][] = [];
    for (let side = 0; side < corners.length; side += 1) {
      const first = corners[side];
      const second = corners[(side + 1) % corners.length];
      for (const detour of [[first, second], [second, first]]) {
        const candidate = [before, ...detour, after];
        if (
          candidate.slice(1).some((point, index) =>
            segmentIntersectsRect(candidate[index], point, innerObstacle),
          )
        ) {
          continue;
        }
        candidates.push(detour);
      }
    }
    if (candidates.length === 0) {
      throw new Error(`Radial connector could not route around source node ${blocker.index}.`);
    }

    const alreadyExcluded = new Set([...excluded, ...routed, blocker.index]);
    candidates.sort((left, right) => {
      const score = (detour: RoutingPoint[]) => {
        const candidate = [before, ...detour, after];
        let intersections = 0;
        for (let index = 1; index < candidate.length; index += 1) {
          intersections += obstacleIndex.intersecting(
            candidate[index - 1],
            candidate[index],
            alreadyExcluded,
            edgeRootBranchIndex,
          ).length;
        }
        return [intersections, pathLength(candidate)] as const;
      };
      const leftScore = score(left);
      const rightScore = score(right);
      return leftScore[0] - rightScore[0] || leftScore[1] - rightScore[1];
    });
    points.splice(blockedSegment, 0, ...candidates[0]);
    routed.add(blocker.index);
  }
}

function addRadialSegment(edges: EdgeRect[], start: RoutingPoint, end: RoutingPoint): void {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new Error('Radial graph edge segment does not have positive finite clearance.');
  }
  edges.push({
    x: (start.x + end.x) / 2 - length / 2,
    y: (start.y + end.y) / 2 - EDGE_THICKNESS / 2,
    w: length,
    h: EDGE_THICKNESS,
    angle: Math.atan2(end.y - start.y, end.x - start.x),
  });
}

function addDirectRadialEdge(
  edges: EdgeRect[],
  parent: RadialUnit,
  child: RadialUnit,
): void {
  const dx = child.centerX - parent.centerX;
  const dy = child.centerY - parent.centerY;
  const centerDistance = Math.hypot(dx, dy);
  if (!(centerDistance > 0) || !Number.isFinite(centerDistance)) {
    throw new Error('Radial graph edge endpoints must have distinct finite centers.');
  }
  const ux = dx / centerDistance;
  const uy = dy / centerDistance;
  const parentClip = clipDistanceToRect(parent.visualW, parent.visualH, ux, uy);
  const childClip = clipDistanceToRect(child.visualW, child.visualH, ux, uy);
  addRadialSegment(
    edges,
    {
      x: parent.centerX + ux * parentClip,
      y: parent.centerY + uy * parentClip,
    },
    {
      x: child.centerX - ux * childClip,
      y: child.centerY - uy * childClip,
    },
  );
}

function addRoutedRadialEdge(
  edges: EdgeRect[],
  parent: RadialUnit,
  child: RadialUnit,
  parentIndex: number,
  childIndex: number,
  obstacleIndex: RadialEdgeObstacleIndex,
): void {
  const dx = child.centerX - parent.centerX;
  const dy = child.centerY - parent.centerY;
  const centerDistance = Math.hypot(dx, dy);
  if (!(centerDistance > 0) || !Number.isFinite(centerDistance)) {
    throw new Error('Radial graph edge endpoints must have distinct finite centers.');
  }
  const ux = dx / centerDistance;
  const uy = dy / centerDistance;
  const parentClip = clipDistanceToRect(parent.visualW, parent.visualH, ux, uy);
  const childClip = clipDistanceToRect(child.visualW, child.visualH, ux, uy);
  const startX = parent.centerX + ux * parentClip;
  const startY = parent.centerY + uy * parentClip;
  const endX = child.centerX - ux * childClip;
  const endY = child.centerY - uy * childClip;
  const points = routeAroundExpandedSources(
    {x: startX, y: startY},
    {x: endX, y: endY},
    parentIndex,
    childIndex,
    child.rootBranchIndex,
    obstacleIndex,
  );
  for (let index = 1; index < points.length; index += 1) {
    addRadialSegment(edges, points[index - 1], points[index]);
  }
}

/**
 * Deterministic radial tree layout.
 *
 * The selected output is centered, dependency subtrees receive contiguous
 * angular sectors with sublinear leaf weighting so sparse deep branches retain
 * usable interior clearance. Siblings begin on parent-centered staggered
 * annuli, then each blocked node advances directly to the nearest free point
 * on its fan's shared outward lane. Node views themselves are never rotated,
 * so item icons and recipe previews remain upright.
 */
export function layoutRadialTree(
  root: ItemTreeNode,
  compact = false,
  isTerminal: (item: ItemTreeNode) => boolean = () => false,
  showLabels = false,
  showRootActions = false,
  /** Restricts the tree to one focused branch; undefined draws every child. */
  visibleNodeIds?: ReadonlySet<string>,
): GraphLayout {
  const units = flattenRadialTree(
    root,
    compact,
    isTerminal,
    showLabels,
    showRootActions,
    visibleNodeIds,
  );
  calculateAngularSectors(units);

  const levels: number[][] = [];
  units.forEach((unit, index) => {
    (levels[unit.depth] ??= []).push(index);
  });

  placeBranchLocalRings(units, levels);

  const nodes: LaidNode[] = units.map(unit => ({
    id: unit.item.source?.id ?? unit.item.id,
    kind: unit.item.source ? 'source' : 'item',
    x: unit.centerX - unit.visualW / 2,
    y: unit.centerY - unit.visualH / 2,
    w: unit.visualW,
    h: unit.visualH,
    item: unit.item,
    source: unit.item.source,
    radial: unit.item.source === undefined,
    depth: unit.depth,
    compactBranch: compact && unit.item.source !== undefined,
  }));

  const edges: EdgeRect[] = [];
  const obstacleIndex = new RadialEdgeObstacleIndex(units);
  if (obstacleIndex.empty) {
    units.forEach(unit => {
      unit.children.forEach(childIndex =>
        addDirectRadialEdge(edges, unit, units[childIndex]),
      );
    });
  } else {
    units.forEach((unit, parentIndex) => {
      unit.children.forEach(childIndex =>
        addRoutedRadialEdge(
          edges,
          unit,
          units[childIndex],
          parentIndex,
          childIndex,
          obstacleIndex,
        ),
      );
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach(node => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
    if (showLabels && (node.radial || node.compactBranch)) {
      const labelOverflow = Math.max(0, (COMPACT_LABEL_WIDTH - node.w) / 2);
      minX = Math.min(minX, node.x - labelOverflow);
      maxX = Math.max(maxX, node.x + node.w + labelOverflow);
      maxY = Math.max(
        maxY,
        node.y +
          node.h +
          (node.depth === 0 ? COMPACT_ROOT_LABEL_HEIGHT : COMPACT_LABEL_HEIGHT),
      );
    }
  });
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new Error('Radial graph layout produced non-finite bounds.');
  }

  return {nodes, edges, minX, minY, maxX, maxY};
}

import {DENSE_GRAPH_NODE_THRESHOLD} from './renderDetail.ts';

/**
 * Automatic expansion used to follow remembered recipes as deep as they went, which is how
 * selecting one item in a pack like GT New Horizons produces thousands of nodes before the canvas
 * has drawn anything useful. The depth it is allowed to reach is derived from how wide the tree
 * is: a branch that splits ten ways fills any sane budget in two levels, while a near-linear
 * chain can run far deeper and still be readable. That is the same budget expressed two ways --
 * log_width(budget) -- rather than a fixed depth, which would be far too deep for a wide pack and
 * uselessly shallow for a simple recipe.
 */
export const DEFAULT_EXPANSION_NODE_BUDGET = DENSE_GRAPH_NODE_THRESHOLD;
/** A near-linear chain would otherwise be allowed to run essentially forever. */
export const MAX_AUTO_EXPAND_DEPTH = 12;
const MIN_AUTO_EXPAND_DEPTH = 2;

export function autoExpandDepthLimit(
  branchingWidth: number,
  nodeBudget: number = DEFAULT_EXPANSION_NODE_BUDGET,
): number {
  if (!Number.isFinite(branchingWidth) || branchingWidth < 0) {
    throw new Error(`Auto expand width must be a non-negative number, got ${branchingWidth}.`);
  }
  if (!Number.isFinite(nodeBudget) || nodeBudget < 1) {
    throw new Error(`Auto expand node budget must be at least 1, got ${nodeBudget}.`);
  }
  // A width of one never multiplies, so log would divide by zero: such a chain gets the cap.
  if (branchingWidth <= 1) return MAX_AUTO_EXPAND_DEPTH;
  const depth = Math.floor(Math.log(nodeBudget) / Math.log(branchingWidth));
  return Math.max(MIN_AUTO_EXPAND_DEPTH, Math.min(MAX_AUTO_EXPAND_DEPTH, depth));
}

/**
 * Tracks the shape of an expansion as it happens. The width is only known once branches start
 * landing, so the depth limit is re-derived from the average branching seen so far rather than
 * guessed once from the root.
 */
export class ExpansionBudget {
  private expandedNodes = 0;
  private expandedParents = 0;
  private children = 0;
  private readonly nodeBudget: number;
  private readonly baseDepth: number;

  /**
   * `baseDepth` is where this cascade starts, which is not the tree root once the user expands a
   * node part way down: depth arrives measured from the root, and comparing that against a limit
   * meant to describe levels below the tapped node would refuse to expand anything at all.
   */
  constructor(nodeBudget: number = DEFAULT_EXPANSION_NODE_BUDGET, baseDepth = 0) {
    if (!Number.isFinite(nodeBudget) || nodeBudget < 1) {
      throw new Error(`Auto expand node budget must be at least 1, got ${nodeBudget}.`);
    }
    if (!Number.isSafeInteger(baseDepth) || baseDepth < 0) {
      throw new Error(`Auto expand base depth must be a non-negative integer, got ${baseDepth}.`);
    }
    this.nodeBudget = nodeBudget;
    this.baseDepth = baseDepth;
  }

  /** Average children per expanded parent, which is the tree's observed width. */
  get branchingWidth(): number {
    return this.expandedParents === 0 ? 0 : this.children / this.expandedParents;
  }

  get depthLimit(): number {
    return autoExpandDepthLimit(this.branchingWidth, this.nodeBudget);
  }

  record(childCount: number): void {
    if (!Number.isSafeInteger(childCount) || childCount < 0) {
      throw new Error(`Expanded child count must be a non-negative integer, got ${childCount}.`);
    }
    this.expandedParents += 1;
    this.children += childCount;
    this.expandedNodes += childCount;
  }

  /** Whether a node at this depth may still be expanded automatically. */
  allowsDepth(depth: number): boolean {
    if (!Number.isSafeInteger(depth) || depth < 0) {
      throw new Error(`Expansion depth must be a non-negative integer, got ${depth}.`);
    }
    if (this.expandedNodes >= this.nodeBudget) return false;
    return depth - this.baseDepth < this.depthLimit;
  }
}

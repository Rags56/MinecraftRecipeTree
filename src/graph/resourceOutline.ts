import {catalystItemIdentity} from './catalystItems.ts';
import type {ItemTreeNode} from './model';
import type {NodeByproductCoverage} from './treeTotals.ts';

/**
 * The resources list as the shape of the tree rather than one flat total. An item whose recipe is
 * set holds the things that recipe needs, so it becomes a section; an item with no recipe is a
 * resource to go and get. Collapsing is not a second piece of state: a section is folded exactly
 * when its node is folded in the tree, so collapsing in either place collapses in both.
 */
export interface ResourceOutlineRow {
  nodeId: string;
  key: string;
  tag?: string;
  /** Nesting depth below the root, which the header shows separately. */
  depth: number;
  amount: number | null;
  /** Slot variants, which together with the tag decide whether this is a tag requirement. */
  variants: number;
  /** Its recipe is set and what that recipe needs is listed below it. */
  expanded: boolean;
  /** Its recipe is set but its subtree is folded away, here and in the tree alike. */
  collapsed: boolean;
  /**
   * What a byproduct of something else in the tree already supplies. The amount above is the gross
   * requirement, which does not move when byproducts are toggled -- this is what does, and what
   * makes the toggle change the list rather than only the setting.
   */
  byproductCredited: number;
  /** Fully supplied by byproducts: nothing here to go and get. */
  byproductCovered: boolean;
  /**
   * Consumed by the recipe that asked for it. A tool or a machine is not: it is needed once and
   * survives the craft. Reported so the row menu can say what the pack does with the item, and
   * deliberately not used to decide which list it belongs on -- that is the user's choice.
   */
  consumed: boolean;
  retentionMode?: 'reusable' | 'durability';
  /** Crafts one of these survives, when the pack says so.  */
  retentionUses?: number;
}

/** Which of the two lists a row belongs to. */
export type ResourceOutlineKind = 'consumed' | 'catalyst';

/**
 * The items the user has moved to the catalysts list, by logical identity. Nothing is put there on
 * the pack's word: `consumed` below says what the recipe does with an item, which is worth knowing
 * but is not the same as how someone wants to shop for it.
 */
export type CatalystItems = ReadonlySet<string>;

export function outlineRowKind(
  row: ResourceOutlineRow,
  catalysts?: CatalystItems,
): ResourceOutlineKind {
  return catalysts?.has(outlineRowIdentity(row)) ? 'catalyst' : 'consumed';
}

/** The logical item a row asks for, which is what a list choice is remembered against. */
export function outlineRowIdentity(row: ResourceOutlineRow): string {
  return catalystItemIdentity({key: row.key, tag: row.tag, variantCount: row.variants});
}

export interface ResourceOutlineOptions {
  /** Amounts the tree calculation worked out, keyed by node id. */
  requiredByNode?: ReadonlyMap<string, number | null>;
  /** Byproduct credit per node, which is empty when byproducts are turned off. */
  byproductCoverageByNode?: ReadonlyMap<string, NodeByproductCoverage>;
  /** An active branch focus: only the nodes it allows are listed. */
  visibleNodeIds?: ReadonlySet<string>;
}

/** Supplied entirely by something the tree already makes, so there is nothing left to gather. */
function isByproductCovered(coverage: NodeByproductCoverage | undefined): boolean {
  return coverage !== undefined && coverage.remainingAmount === 0 && coverage.creditedAmount > 0;
}

/** A node is a section once its recipe is set, whether that recipe is currently folded or not. */
export function isOutlineBranch(node: ItemTreeNode): boolean {
  return node.source !== undefined || node.collapsedSource !== undefined;
}

export function resourceOutlineRows(
  root: ItemTreeNode | null,
  options: ResourceOutlineOptions = {},
): ResourceOutlineRow[] {
  if (!root) return [];
  const rows: ResourceOutlineRow[] = [];
  const {requiredByNode, byproductCoverageByNode, visibleNodeIds} = options;

  const visit = (node: ItemTreeNode, depth: number) => {
    // A folded branch keeps its subtree, so it is walked for structure but never listed: its
    // contents are put away in the tree and belong put away here too.
    // Biggest job first within each section, unknown amounts last, which is the order the list
    // is worked through -- the nesting decides the shape, this decides the order inside it.
    const children = [...(node.source?.inputs ?? [])].sort((left, right) => {
      const l = requiredByNode?.get(left.id) ?? left.amount ?? null;
      const r = requiredByNode?.get(right.id) ?? right.amount ?? null;
      if (l == null || r == null) {
        if (l == null && r == null) return left.key.localeCompare(right.key);
        return l == null ? 1 : -1;
      }
      return l !== r ? r - l : left.key.localeCompare(right.key);
    });
    for (const child of children) {
      if (visibleNodeIds && !visibleNodeIds.has(child.id)) continue;
      rows.push({
        nodeId: child.id,
        key: child.key,
        ...(child.tag === undefined ? {} : {tag: child.tag}),
        depth,
        amount: requiredByNode?.get(child.id) ?? child.amount ?? null,
        variants: child.variantCount ?? 1,
        expanded: child.source !== undefined,
        collapsed: child.source === undefined && child.collapsedSource !== undefined,
        byproductCredited: byproductCoverageByNode?.get(child.id)?.creditedAmount ?? 0,
        byproductCovered: isByproductCovered(byproductCoverageByNode?.get(child.id)),
        consumed: child.nonConsumed !== true,
        ...(child.retentionMode === undefined ? {} : {retentionMode: child.retentionMode}),
        ...(child.retentionUses === undefined ? {} : {retentionUses: child.retentionUses}),
      });
      if (child.source) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

/**
 * The rows a person still has to go and get: an expanded section is a step on the way rather than
 * something to gather, so the percentage counts what is left at the ends of the tree.
 */
export function outlineResourceRows(
  rows: readonly ResourceOutlineRow[],
): ResourceOutlineRow[] {
  return rows.filter(row => !row.expanded);
}

/**
 * Every gatherable item beneath a node: the ends of its branch, which are the things a person
 * actually collects. It follows a folded subtree as well as an open one, so ticking a section that
 * is currently put away still ticks what it holds rather than silently nothing.
 *
 * Identified by node rather than by item, because two recipes wanting the same thing are two
 * separate jobs. A ring block and a chevron block that each need eighty hieroglyphs need a hundred
 * and sixty between them, and gathering the ring block's eighty does not gather the chevron's --
 * keyed by item, one tick would have struck off both and the list would have read half done. The
 * flat totals still add them together, which is the right answer to a different question.
 */
export interface GatherableOptions {
  byproductCoverageByNode?: ReadonlyMap<string, NodeByproductCoverage>;
  /** One list's worth, or the whole tree when it is left out. */
  kind?: ResourceOutlineKind;
  catalysts?: CatalystItems;
}

export function gatherableNodeIdsUnder(
  node: ItemTreeNode,
  options: GatherableOptions = {},
): string[] {
  const {byproductCoverageByNode, kind, catalysts} = options;
  const isCatalyst = (current: ItemTreeNode) =>
    catalysts?.has(catalystItemIdentity(current)) === true;
  // Covered by a byproduct is not something to go and get, so turning byproducts on moves the count
  // as well as the amounts.
  const covered = (current: ItemTreeNode) =>
    isByproductCovered(byproductCoverageByNode?.get(current.id));
  const nodeIds: string[] = [];
  const visit = (current: ItemTreeNode) => {
    // A tool is the end of its own list: whether it is bought or built, what the tools list asks
    // for is the tool. Its ingredients belong to the materials list, which is why the walk carries
    // on through it there -- moving an item between lists moves that item, not the work under it.
    if (isCatalyst(current)) {
      if (kind !== 'consumed' && !covered(current)) nodeIds.push(current.id);
      if (kind === 'catalyst') return;
    }
    const source = current.source ?? current.collapsedSource;
    if (!source) {
      if (!isCatalyst(current) && kind !== 'catalyst' && !covered(current)) {
        nodeIds.push(current.id);
      }
      return;
    }
    for (const child of source.inputs) visit(child);
  };
  visit(node);
  return nodeIds;
}

/**
 * One list's worth of rows. A section is kept when it holds something the list wants, so a tool
 * buried three recipes down still arrives with the path that explains where it is needed.
 */
export function filterOutlineRows(
  rows: readonly ResourceOutlineRow[],
  kind: ResourceOutlineKind,
  catalysts?: CatalystItems,
): ResourceOutlineRow[] {
  const keep = rows.map(row => outlineRowKind(row, catalysts) === kind);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (keep[index] || !rows[index].expanded) continue;
    for (let next = index + 1; next < rows.length && rows[next].depth > rows[index].depth; next += 1) {
      if (keep[next]) {
        keep[index] = true;
        break;
      }
    }
  }
  return rows
    .filter((_row, index) => keep[index])
    // On the tools list a tool is a single line, even when its own recipe is open in the tree: what
    // the list asks for is the tool, and what it takes to make one is materials.
    .map(row =>
      kind === 'catalyst' && outlineRowKind(row, catalysts) === 'catalyst' && row.expanded
        ? {...row, expanded: false, collapsed: false}
        : row,
    );
}

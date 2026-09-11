import type {ItemTreeNode} from './model';
import {treeTotalIdentity} from './treeTotals.ts';

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
}

export interface ResourceOutlineOptions {
  /** Amounts the tree calculation worked out, keyed by node id. */
  requiredByNode?: ReadonlyMap<string, number | null>;
  /** An active branch focus: only the nodes it allows are listed. */
  visibleNodeIds?: ReadonlySet<string>;
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
  const {requiredByNode, visibleNodeIds} = options;

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

/** The same logical identity the checklist and the totals use, from an outline row. */
export function outlineRowIdentity(row: ResourceOutlineRow): string {
  return treeTotalIdentity({key: row.key, tag: row.tag, variants: row.variants});
}

/**
 * Every gatherable item beneath a node: the ends of its branch, which are the things a person
 * actually collects. It follows a folded subtree as well as an open one, so ticking a section that
 * is currently put away still ticks what it holds rather than silently nothing.
 */
export function gatherableIdentitiesUnder(node: ItemTreeNode): string[] {
  const identities = new Set<string>();
  const visit = (current: ItemTreeNode) => {
    const source = current.source ?? current.collapsedSource;
    if (!source) {
      identities.add(
        treeTotalIdentity({
          key: current.key,
          tag: current.tag,
          variants: current.variantCount ?? 1,
        }),
      );
      return;
    }
    for (const child of source.inputs) visit(child);
  };
  const source = node.source ?? node.collapsedSource;
  // The node itself is a resource when it has no recipe; otherwise only its ends count.
  if (!source) {
    return [
      treeTotalIdentity({key: node.key, tag: node.tag, variants: node.variantCount ?? 1}),
    ];
  }
  for (const child of source.inputs) visit(child);
  return [...identities];
}

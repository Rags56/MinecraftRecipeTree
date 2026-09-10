import type {ItemTreeNode} from './model';

/**
 * Focusing a node reduces the tree to the one branch that node belongs to: the chain of parents
 * that leads down to it, plus everything underneath it. Sibling branches are dropped rather than
 * dimmed, the way a research tree narrows to the path you selected, so a tree far too wide to
 * read collapses to the part actually being worked on.
 */
export interface TreeFocus {
  /** Every node id the layout may draw, including the path down to the focused node. */
  visibleNodeIds: ReadonlySet<string>;
  /** Root-first item keys from the tree root to the focused node, for a breadcrumb. */
  pathKeys: string[];
}

export function findTreeNodeById(
  root: ItemTreeNode | null,
  nodeId: string,
): ItemTreeNode | null {
  if (!root) return null;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) return node;
    for (const child of node.source?.inputs ?? []) stack.push(child);
  }
  return null;
}

function collectSubtreeIds(node: ItemTreeNode, into: Set<string>): void {
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    into.add(current.id);
    for (const child of current.source?.inputs ?? []) stack.push(child);
  }
}

/**
 * Null when nothing is focused or the focused node is no longer in the tree, which callers read
 * as "draw everything". A focus that outlived its node must not blank the canvas.
 */
export function treeFocus(
  root: ItemTreeNode | null,
  focusNodeId: string | null,
): TreeFocus | null {
  if (!root || !focusNodeId || focusNodeId === root.id) return null;

  const parents = new Map<string, ItemTreeNode>();
  const stack = [root];
  let focused: ItemTreeNode | null = null;
  while (stack.length > 0 && !focused) {
    const node = stack.pop()!;
    if (node.id === focusNodeId) {
      focused = node;
      break;
    }
    for (const child of node.source?.inputs ?? []) {
      parents.set(child.id, node);
      stack.push(child);
    }
  }
  if (!focused) return null;

  const visibleNodeIds = new Set<string>();
  const pathNodes: ItemTreeNode[] = [];
  for (let node: ItemTreeNode | undefined = focused; node; node = parents.get(node.id)) {
    pathNodes.push(node);
    visibleNodeIds.add(node.id);
  }
  pathNodes.reverse();
  collectSubtreeIds(focused, visibleNodeIds);

  return {visibleNodeIds, pathKeys: pathNodes.map(node => node.key)};
}

/** A node the layout may draw: the root is always drawn, and unfocused trees draw everything. */
export function isNodeVisible(
  visibleNodeIds: ReadonlySet<string> | undefined,
  nodeId: string,
): boolean {
  return !visibleNodeIds || visibleNodeIds.has(nodeId);
}

/** The children a layout should place under a node, honouring an active focus. */
export function visibleInputs(
  node: ItemTreeNode,
  visibleNodeIds?: ReadonlySet<string>,
): ItemTreeNode[] {
  const inputs = node.source?.inputs ?? [];
  if (!visibleNodeIds) return inputs;
  return inputs.filter(child => visibleNodeIds.has(child.id));
}

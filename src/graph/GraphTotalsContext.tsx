import React, {createContext, useCallback, useContext, useMemo, useRef, useState} from 'react';
import type {ItemTreeNode} from './model';
import type {TreeCalculation, TreeTotal} from './treeTotals';

/**
 * The tree and its totals live inside the active GraphScreen, which owns the expansion state they
 * are derived from. The resources tab is a sibling of that screen rather than a child, so the
 * active tree publishes a snapshot here for it to read, instead of the tree being lifted out of
 * the screen that mutates it.
 */
export interface GraphTotalsSnapshot {
  /** Item key of the tree's root, which scopes the checklist. */
  rootKey: string;
  /** How many of the root the tree is built for, which is what every amount below is relative to. */
  rootAmount: number | null;
  /** The calculation, not just its lists: the outline needs the per-node amounts from it. */
  totals: TreeCalculation;
  /** The live tree, so the list can take the shape of it rather than flattening it. */
  root: ItemTreeNode | null;
  /** Bumped whenever the tree is edited in place, which is how the list knows to re-read it. */
  version: number;
  /** An active branch focus, which narrows the list to that branch. */
  visibleNodeIds?: ReadonlySet<string>;
  /** Folds a node here and in the tree at once: there is one collapse, not two. */
  onToggleNode(node: ItemTreeNode): void;
  /**
   * The tree's own actions, so the resources list acts through the graph rather than keeping a
   * second implementation of anything: choosing a recipe, swapping which member of a logical
   * ingredient slot is wanted, and saying an item is a tool rather than a material.
   */
  onSelectAlternative(node: ItemTreeNode, selectedKey: string): void;
  onChangeRecipe(node: ItemTreeNode): void;
  onTreatAsTool(node: ItemTreeNode, isTool: boolean): void;
  /** One preference shared with the tree, not a second copy of it. */
  useByproducts: boolean;
  onUseByproductsChange(value: boolean): void;
  /** Opens the resource in the tree the way tapping it in the old totals panel did. */
  onResourceTap(total: TreeTotal): void;
  /** The list these resources came from is the thing being exported, so it owns the action. */
  onExportCsv(): void;
  /** A recipe lookup is in flight; the surface that started it owes the user some sign of it. */
  lookupPending: boolean;
}

interface GraphTotalsValue {
  snapshot: GraphTotalsSnapshot | null;
  publish(snapshot: GraphTotalsSnapshot | null): void;
}

const GraphTotalsContext = createContext<GraphTotalsValue | null>(null);

export function GraphTotalsProvider({children}: {children: React.ReactNode}) {
  const [snapshot, setSnapshot] = useState<GraphTotalsSnapshot | null>(null);
  // Publishing happens from a render-time effect in the graph; comparing here keeps an unchanged
  // tree from re-rendering the rest of the app on every graph frame.
  const snapshotRef = useRef<GraphTotalsSnapshot | null>(null);
  const publish = useCallback((next: GraphTotalsSnapshot | null) => {
    const current = snapshotRef.current;
    if (
      current === next ||
      (current &&
        next &&
        current.rootKey === next.rootKey &&
        current.rootAmount === next.rootAmount &&
        current.totals === next.totals &&
        current.root === next.root &&
        current.version === next.version &&
        current.visibleNodeIds === next.visibleNodeIds &&
        current.onToggleNode === next.onToggleNode &&
        current.onSelectAlternative === next.onSelectAlternative &&
        current.onChangeRecipe === next.onChangeRecipe &&
        current.onTreatAsTool === next.onTreatAsTool &&
        current.useByproducts === next.useByproducts &&
        current.onUseByproductsChange === next.onUseByproductsChange &&
        current.onResourceTap === next.onResourceTap &&
        current.onExportCsv === next.onExportCsv &&
        current.lookupPending === next.lookupPending)
    ) {
      return;
    }
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const value = useMemo<GraphTotalsValue>(() => ({snapshot, publish}), [publish, snapshot]);
  return <GraphTotalsContext.Provider value={value}>{children}</GraphTotalsContext.Provider>;
}

export function useGraphTotals(): GraphTotalsValue {
  const value = useContext(GraphTotalsContext);
  if (!value) throw new Error('GraphTotalsProvider missing');
  return value;
}

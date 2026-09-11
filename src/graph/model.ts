import type {DropStat, Mob, Recipe, RecipeRef} from '../types';
import type {IngredientSelections} from '../data/ingredientAlternativeSelection';
import type {GraphDirection} from './direction';
import type {ProductionPlan} from './machineParallels';

/**
 * The flowchart is a tree rooted at the item being crafted, growing downward.
 * An expanded item is drawn as a single "source" node (recipe image / mob / block
 * with the item name + required amount in its header) — no separate item node —
 * which keeps the chart compact. Collapsed items stay small item nodes.
 */
export type SourceKind = 'recipe' | 'mob' | 'block';

export interface ByproductAllocation {
  producerSourceId: string;
  amount: number;
}

export interface ByproductFulfillment {
  creditedAmount: number;
  allocations: ByproductAllocation[];
}

export interface DeferredRecipeExpansion {
  ref: RecipeRef;
  allowFluidTransfer?: true;
  ingredientSelections?: IngredientSelections;
}

export interface SourceTreeNode {
  id: string;
  kind: SourceKind;
  /** recipe source */
  ref?: RecipeRef;
  recipe?: Recipe;
  dir?: string;
  catTitle?: string;
  /** Whether this source expands toward ingredients or toward recipe products. */
  direction?: GraphDirection;
  /** User-selected concrete members for interchangeable recipe input slots. */
  ingredientSelections?: IngredientSelections;
  /** Recipe was explicitly allowed through the default fluid-transfer filter. */
  allowFluidTransfer?: boolean;
  /** mob-drop source */
  mob?: Mob;
  /** block-mining source */
  blockKey?: string;
  /** drop odds for mob/block sources */
  stat?: DropStat;
  /** ingredient children (recipe sources only) */
  inputs: ItemTreeNode[];
}

/** Synthetic ProjectE recipes use structured data instead of a JEI screenshot. */
export function isEmcTransmutationSource(source: SourceTreeNode): boolean {
  return (
    source.kind === 'recipe' &&
    source.recipe?.id?.startsWith('projecte:emc/') === true
  );
}

export interface ItemTreeNode {
  id: string;
  /** Catalog key */
  key: string;
  /** Total amount required by the parent recipe (summed over merged slots) */
  /** null means the selected recipe did not export a usable quantity. */
  amount?: number | null;
  /** User planning target. Currently applied to the graph root. */
  productionPlan?: ProductionPlan;
  /** Number of interchangeable variants in the parent slot (tags) */
  variantCount?: number;
  /** Resolved members of a logical ingredient tag. */
  alternatives?: string[];
  /** Stable first member of the parent slot used to persist an alternative selection. */
  selectionKey?: string;
  /** Canonical tag id reconstructed from an unambiguous variant family. */
  tag?: string;
  /** Required by the parent source but retained after the recipe runs. */
  nonConsumed?: boolean;
  /** The retained item is either indefinitely reusable or eventually replaced after wear. */
  retentionMode?: 'reusable' | 'durability';
  /** Recipe runs available from one fresh durability-bearing item. */
  retentionUses?: number;
  /** Exact per-run chance that this consumed input is used; null means conflicting chances. */
  consumptionProbability?: number | null;
  /** Exact per-run chance that this output is produced; null means conflicting chances. */
  productionProbability?: number | null;
  /** Byproduct quantity reserved for this ingredient before its selected source is run. */
  byproductFulfillment?: ByproductFulfillment;
  /** Keys of item ancestors, for cycle detection */
  ancestors: string[];
  /** This item already appears up the chain */
  cyclic?: boolean;
  loading?: boolean;
  /** The chosen way to obtain this item; set = expanded */
  source?: SourceTreeNode;
  /** Recipe expansion held by another occurrence while expand-once mode is active. */
  deferredRecipeExpansion?: DeferredRecipeExpansion;
  /**
   * The subtree this node had before it was collapsed, so reopening it restores what was there
   * rather than rebuilding a different tree from remembered recipes. Held in memory only: the
   * saved session records what is expanded, and a folded branch is not.
   */
  collapsedSource?: SourceTreeNode;
}

export function makeRoot(key: string): ItemTreeNode {
  return {id: 'root', key, ancestors: []};
}

/** A node is a recursion boundary when its item already exists in its own path. */
export function isRecursiveItemNode(node: ItemTreeNode): boolean {
  return node.cyclic === true || node.ancestors.includes(node.key);
}

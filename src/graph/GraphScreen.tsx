import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import {formatDropStat} from '../components/DropList';
import {DisclosureChevron} from '../components/DisclosureChevron';
import {ItemIcon, pixelated} from '../components/ItemIcon';
import {
  RADIAL_ROOT_ITEM_ICON_SIZE,
} from '../components/itemIconSizing';
import {MobSprite} from '../components/MobSprite';
import {MultiblockPreview} from '../components/MultiblockPreview';
import {ItemChip} from '../components/RecipeCard';
import {
  PickerGroupProgress,
  PickerModal,
  PickerOption,
} from '../components/PickerModal';
import {slotSummary} from '../data/slotSummary';
import {
  applyIngredientSelections,
  selectSlotAlternative,
  type IngredientSelections,
} from '../data/ingredientAlternativeSelection';
import {signalTarget, useSignalSurface} from '../analytics/signal';
import {RecipePreviewImage} from '../components/RecipePreviewImage';
import {ProjecteEmcPreview} from '../components/ProjecteEmcPreview';
import {recipeImagePath, useData} from '../data/DataContext';
import {
  formatIngredientQuantity,
  shouldShowIngredientQuantity,
} from '../data/ingredientQuantities';
import {displayIngredientName} from '../data/ingredientTags';
import {isDefaultDisabledRecipeCategory} from '../data/recipeCategories';
import {
  loadCollapsedRecipeCategories,
  persistCollapsedRecipeCategories,
  toggleCollapsedRecipeCategory,
} from '../data/recipeCategoryPreferences';
import {useRecipeStages} from '../data/RecipeStageContext';
import {isRecipeVisibleForStages} from '../data/recipeStages';
import {
  isFluidContainerTransferRecipe,
  isRedundantFluidContainerRecipe,
} from '../data/recipeVisibility';
import {recipeDisplayTitle} from '../data/recipeTitles';
import {recipeNeedsLayoutPreviewUnavailableNotice} from '../data/recipePresentation';
import {projecteEmcTransmutation} from '../data/projecteEmc';
import {
  claimAnonymousRecipeFavorites,
  cleanupInvalidPersonalRecipeFavorites,
  loadCommunityRecipeFavorites,
  loadPersonalRecipeFavorites,
  updateCommunityRecipeFavorite,
} from '../data/recipeFavorites';
import {reportRecipeRetentionOverride} from '../data/recipeRetentionReports';
import {useUser} from '../account/UserContext';
import {theme} from '../theme';
import {DropStat, Mob, Recipe, RecipeRef} from '../types';
import {useUi, type Tab} from '../ui/UiContext';
import {
  COMPACT_LABEL_WIDTH,
  COMPACT_ITEM_SIZE,
  COMPACT_ROOT_DIAMOND_SIZE,
  COMPACT_ROOT_LABEL_GAP,
  COMPACT_ROOT_SIZE,
  ITEM_H,
  ITEM_W,
  ROOT_ATTACHED_ACTIONS_WIDTH,
  ROOT_SOURCE_ACTIONS_WIDTH,
  SOURCE_EMC_PREVIEW_HEIGHT,
  SOURCE_EMC_PREVIEW_WIDTH,
  SOURCE_HEADER,
  SOURCE_STRUCTURE_PREVIEW_WIDTH,
  type ByproductSupplyEdge,
  attachedRootVisualX,
  byproductSupplyEdges,
  layoutTree,
  recipeImageDisplay,
} from './layout';
import {
  RADIAL_ITEM_SIZE,
  RADIAL_ROOT_DIAMOND_SIZE,
  RADIAL_ROOT_SIZE,
  layoutRadialTree,
} from './radialLayout';
import {
  PreferredSource,
  PreferredSources,
  loadPreferredSources,
  persistPreferredSources,
} from './preferredSources';
import {preferredSourceTargets} from './preferencePropagation';
import {automaticGraphFitScale} from './fitScale';
import {
  capturePanGestureOrigin,
  graphDisplayTransform,
  graphPinchZoomFactor,
  graphViewportPointFromClient,
  graphWheelZoomFactor,
  transformForPanGesture,
} from './panGesture';
import type {GraphTransform, PanGestureOrigin} from './panGesture';
import {recordRecipeHistory} from './recipeHistory';
import {RecipeLoadTimeoutError, withRecipeLoadTimeout} from './recipeLoadTimeout';
import {
  loadManualRetentionOverrides,
  manualRetentionOverrideFor,
  manualRetentionOverrideKey,
  persistManualRetentionOverrides,
  type ManualRetentionOverrides,
} from './manualRetentionOverrides';
import {planRecipePickerChoices} from './recipePickerPlan';
import {
  DEFAULT_USE_BYPRODUCTS,
  useByproductsFromStoredValue,
} from './byproductPreference';
import {
  materialInputSummary,
  recipeChildrenForDirection,
  usageGraphStart,
  type GraphDirection,
} from './direction';
import {
  clearGraphSession,
  loadGraphSession,
  persistGraphSession,
  persistGraphSessionSnapshot,
  serializeGraphSession,
  type GraphSession,
  type StoredGraphSelection,
} from './graphSession';
import {
  assertPortableTreePackMatches,
  buildPortableTree,
  parsePortableTree,
  portableRecipeMatchesKey,
  portableSelectionAsStored,
  resolveConnectedPortableSelections,
  type PortableTreeSelection,
} from './portableTree';
import {
  pickPortableTreeFile,
  sharePortableTree,
} from './portableTreeTransfer';
import {TreeShareModal} from './TreeShareModal';
import {
  RecipeImportDetailsModal,
  type RecipeImportReport,
} from './RecipeImportDetailsModal';
import {
  AutoExpandSummaryModal,
  type AutoExpandSummaryEntry,
} from './AutoExpandSummaryModal';
import {LowDetailGraphCanvas} from './LowDetailGraphCanvas';
import {GraphMinimap, MINIMAP_MAX_WIDTH} from './GraphMinimap';
import {GraphSettingsSheet, type GraphSettingOption} from './GraphSettingsSheet';
import {shouldShowMinimap, transformCenteredOn} from './minimap';
import {useGraphTotals} from './GraphTotalsContext';
import {autoExpandPreferredNodes} from './autoExpandTree';
import {
  createDeferredRecipeSourceResolver,
  deferredRecipeExpansionNodes,
  duplicateRecipeExpansions,
  findRecipeExpansionOwner,
  recipeExpansionFromSource,
  recipeExpansionIdentity,
} from './expansionOwnership';
import {isEmcTransmutationSource, isRecursiveItemNode, makeRoot} from './model';
import {treeFocus} from './treeFocus';
import {ExpansionBudget} from './expansionBudget';
import type {
  DeferredRecipeExpansion,
  ItemTreeNode,
  SourceTreeNode,
} from './model';
import {
  buildTreeTotalsCsv,
  downloadBlob,
  safeExportFilename,
} from './treeExports';
import {calculateTreeTotals, requiredAmountFor} from './treeTotals';
import type {
  NodeByproductCoverage,
  TreeCalculation,
  TreeTotal,
  TreeTotals,
} from './treeTotals';
import {
  GRAPH_VIEWPORT_OVERSCAN,
  shouldRecomputeCulling,
  visibleGraphElements,
} from './viewportCulling';
import {indexedRecipeRefs} from './indexedRecipeRefs';
import {
  DENSE_GRAPH_NODE_THRESHOLD,
  shouldShowNodeAmounts,
  shouldUseLowDetailGraph,
} from './renderDetail';
import {
  nodeContextMenuPlacement,
  type NodeContextAnchor,
  type NodeContextMenuPlacement,
} from './nodeContextMenu';
import {
  findTreeTotalTarget,
  type TreeTotalTargetKind,
} from './treeTotalTargets';
import {
  estimateParallelMachines,
  type ProductionPlan,
} from './machineParallels';

/** One way to obtain an item: craft it, kill for it, or mine for it. */
type SourceChoice =
  | {
      t: 'recipe';
      ref: RecipeRef;
      allowFluidTransfer?: true;
      ingredientSelections?: IngredientSelections;
    }
  | {t: 'mob'; mob: Mob; stat: DropStat}
  | {t: 'block'; blockKey: string; stat: DropStat};

interface PickerEntry {
  option: PickerOption;
  choice: SourceChoice;
  recipe?: Recipe;
}

type RecipeSourceChoice = Extract<SourceChoice, {t: 'recipe'}>;

interface PickerState {
  requestId: number;
  direction: GraphDirection;
  title: string;
  standardEntries: PickerEntry[];
  fluidTransferEntries: PickerEntry[];
  showFluidTransfers: boolean;
  identifiedFluidTransferCount: number;
  remainingRecipeChoices: Record<string, RecipeSourceChoice[]>;
  recipeGroupProgress: Record<string, PickerGroupProgress>;
  target: ItemTreeNode;
  byproductCoverage?: NodeByproductCoverage;
  rememberSource: boolean;
  productionPlan?: ProductionPlan;
  collapsedGroupKeys: Set<string>;
}

interface NodeMenuState {
  node: ItemTreeNode;
  anchor: NodeContextAnchor;
}

interface NodeActionPointer {
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
}

type NodeActionEvent = GestureResponderEvent | (NodeActionPointer & {
  nativeEvent?: NodeActionPointer;
  preventDefault?: () => void;
  stopPropagation?: () => void;
});

function nodeActionPointer(event?: NodeActionEvent): NodeActionPointer | undefined {
  if (!event) return undefined;
  const native = 'nativeEvent' in event ? event.nativeEvent : undefined;
  const source = (native ?? event) as NodeActionPointer;
  return {
    clientX: source.clientX,
    clientY: source.clientY,
    pageX: source.pageX,
    pageY: source.pageY,
  };
}

function visiblePickerEntries(
  picker: PickerState,
  hiddenRecipeStages: ReadonlySet<string>,
): PickerEntry[] {
  const visibleStandard = picker.standardEntries.filter(
    entry =>
      !entry.recipe ||
      isRecipeVisibleForStages(entry.recipe, hiddenRecipeStages),
  );
  if (!picker.showFluidTransfers) return visibleStandard;
  return [
    ...visibleStandard,
    ...picker.fluidTransferEntries.filter(
      entry =>
        !entry.recipe ||
        isRecipeVisibleForStages(entry.recipe, hiddenRecipeStages),
    ),
  ];
}

function pickerRecipeStageCounts(picker: PickerState): {stage: string; count: number}[] {
  const counts = new Map<string, number>();
  for (const entry of [...picker.standardEntries, ...picker.fluidTransferEntries]) {
    const stage = entry.recipe?.stage;
    if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stage, count]) => ({stage, count}));
}

function preferredSourceFromChoice(choice: SourceChoice): PreferredSource {
  if (choice.t === 'recipe') {
    return {
      t: 'recipe',
      ref: choice.ref,
      ...(choice.allowFluidTransfer ? {allowFluidTransfer: true as const} : {}),
      ...(choice.ingredientSelections
        ? {ingredientSelections: {...choice.ingredientSelections}}
        : {}),
    };
  }
  if (choice.t === 'mob') return {t: 'mob', mobId: choice.mob.id};
  return {t: 'block', blockKey: choice.blockKey};
}

function choiceMatchesPreference(choice: SourceChoice, preferred: PreferredSource): boolean {
  if (choice.t !== preferred.t) return false;
  if (choice.t === 'recipe' && preferred.t === 'recipe') {
    return choice.ref[0] === preferred.ref[0] && choice.ref[1] === preferred.ref[1];
  }
  if (choice.t === 'mob' && preferred.t === 'mob') return choice.mob.id === preferred.mobId;
  return choice.t === 'block' && preferred.t === 'block' && choice.blockKey === preferred.blockKey;
}

function releaseByproductFulfillments(
  root: ItemTreeNode | null,
  removedNode: ItemTreeNode,
): void {
  const removedSourceIds = new Set<string>();
  const removedStack = [removedNode];
  while (removedStack.length > 0) {
    const current = removedStack.pop()!;
    if (!current.source) continue;
    removedSourceIds.add(current.source.id);
    for (const child of current.source.inputs) removedStack.push(child);
  }
  if (removedSourceIds.size === 0 || !root) return;

  let releasedAmount = 0;
  const treeStack = [root];
  while (treeStack.length > 0) {
    const current = treeStack.pop()!;
    const fulfillment = current.byproductFulfillment;
    if (fulfillment) {
      const retainedAllocations = fulfillment.allocations.filter(allocation => {
        if (!removedSourceIds.has(allocation.producerSourceId)) return true;
        releasedAmount += allocation.amount;
        return false;
      });
      const retainedAmount = retainedAllocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      );
      if (retainedAmount > 0) {
        current.byproductFulfillment = {
          creditedAmount: retainedAmount,
          allocations: retainedAllocations,
        };
      } else {
        current.byproductFulfillment = undefined;
      }
    }
    for (const child of current.source?.inputs ?? []) treeStack.push(child);
  }
  if (releasedAmount > 0) {
    console.info('Byproduct fulfillment was released because its producing recipe left the tree.', {
      releasedAmount,
      removedProducerCount: removedSourceIds.size,
    });
  }
}

function parentRecipeSource(
  root: ItemTreeNode | null,
  target: ItemTreeNode,
): SourceTreeNode | null {
  if (!root || root === target) return null;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const source = current.source;
    if (!source) continue;
    if (source.inputs.includes(target)) return source;
    stack.push(...source.inputs);
  }
  return null;
}

function applyManualRetentionOverrideToTree(
  root: ItemTreeNode | null,
  ref: RecipeRef,
  itemKey: string,
  reusable: boolean,
): void {
  if (!root) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const source = current.source;
    if (!source) continue;
    if (
      source.kind === 'recipe' &&
      source.direction === 'inputs' &&
      source.ref?.[0] === ref[0] &&
      source.ref[1] === ref[1]
    ) {
      for (const child of source.inputs) {
        if (child.key !== itemKey) continue;
        child.nonConsumed = reusable;
        child.retentionMode = reusable ? 'reusable' : undefined;
        child.retentionUses = undefined;
      }
    }
    stack.push(...source.inputs);
  }
}

/** Dragging the canvas must never start a text selection (web). */
const noSelect = Platform.OS === 'web' ? ({userSelect: 'none'} as unknown as object) : null;
const COMPACT_MODE_KEY = 'graphCompactMode';
const RADIAL_LAYOUT_KEY = 'graphRadialLayout';
const LEGACY_PACKED_LAYOUT_KEY = 'graphPackedLayout';
const LOW_DETAIL_KEY = 'graphLowDetail';
const USE_BYPRODUCTS_KEY = 'graphUseByproducts';
/** Distance from the canvas top to the controls bar; panels below it clear it by measurement. */
const CONTROLS_TOP_INSET = 10;
/**
 * Surfaces that can ask the graph for a recipe. The resources list opens the picker without
 * leaving itself, so an in-flight lookup started there must not be abandoned as though the user
 * had navigated away from the graph.
 */
const TABS_DRIVING_THE_PICKER: ReadonlySet<Tab> = new Set<Tab>(['graph', 'resources']);
const CANVAS_EDGE_INSET = 10;
const FIT_CONTROL_SIZE = Platform.OS === 'web' ? 40 : 44;
/**
 * Bottom-edge notices start clear of the fit control in the corner and end at the opposite edge.
 * They used to be placed by hand-counted offsets with no right bound at all, which reads fine on a
 * desktop canvas and runs straight off the side of a phone.
 */
const BOTTOM_NOTICE_LEFT_INSET = CANVAS_EDGE_INSET + FIT_CONTROL_SIZE + 12;
const EXPAND_RECIPES_ONCE_KEY = 'graphExpandRecipesOnce';
const MAX_RECIPE_PICKER_CHOICES = 40;
const RECIPE_PICKER_GROUP_PAGE = 40;
const GRAPH_EXPORT_PADDING = 48;
const GRAPH_EXPORT_PIXEL_RATIO = 3;
const AUTO_EXPAND_BATCH_SIZE = 12;
const AUTO_EXPAND_BATCH_DELAY_MS = 100;

function waitForAutoExpandBatch(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, AUTO_EXPAND_BATCH_DELAY_MS));
}

function blockRecursiveExpansion(node: ItemTreeNode, interaction: string): boolean {
  if (!isRecursiveItemNode(node)) return false;
  console.info('Recursive graph input expansion was blocked.', {
    nodeId: node.id,
    itemKey: node.key,
    interaction,
    ancestorDepth: node.ancestors.length,
  });
  return true;
}

function recipeRefKey([categoryIndex, recipeIndex]: RecipeRef): string {
  return `${categoryIndex}:${recipeIndex}`;
}

function nodeForStoredSelection(
  root: ItemTreeNode,
  selection: StoredGraphSelection,
  restoredNodesByPath: ReadonlyMap<string, ItemTreeNode>,
): ItemTreeNode {
  if (selection.path.length === 0) {
    if (root.key !== selection.itemKey) {
      throw new Error(
        `Saved graph root resolved to ${JSON.stringify(root.key)} instead of ${JSON.stringify(selection.itemKey)}.`,
      );
    }
    return root;
  }

  const parentPath = selection.path.slice(0, -1).join('.');
  const parent = restoredNodesByPath.get(parentPath);
  if (!parent) {
    throw new Error(
      `Saved graph parent path ${parentPath} was not reconstructed.`,
    );
  }
  const storedChildIndex = selection.path[selection.path.length - 1];
  const indexedChild = parent.source?.inputs[storedChildIndex];
  if (indexedChild?.key === selection.itemKey) return indexedChild;

  const matchingChildren = (parent.source?.inputs ?? []).filter(
    child => child.key === selection.itemKey,
  );
  if (matchingChildren.length === 1) {
    console.info(
      'A saved graph path was remapped after presentation-only recipe inputs were removed.',
      {
        storedPath: selection.path,
        itemKey: selection.itemKey,
        storedChildIndex,
        reconstructedChildIndex: parent.source!.inputs.indexOf(matchingChildren[0]),
      },
    );
    return matchingChildren[0];
  }
  throw new Error(
    `Saved graph path ${selection.path.join('.')} could not uniquely resolve ` +
      `${JSON.stringify(selection.itemKey)} in the reconstructed parent.`,
  );
}

function loadCompactMode(): boolean {
  try {
    return globalThis.localStorage?.getItem(COMPACT_MODE_KEY) === '1';
  } catch (error) {
    console.error('Compact graph mode could not be loaded from localStorage.', error);
    return false;
  }
}

function loadRadialLayout(): boolean {
  try {
    const storage = globalThis.localStorage;
    const saved = storage?.getItem(RADIAL_LAYOUT_KEY);
    if (saved !== null && saved !== undefined) return saved !== '0';
    const legacyPacked = storage?.getItem(LEGACY_PACKED_LAYOUT_KEY);
    if (legacyPacked !== null && legacyPacked !== undefined) {
      console.info('Migrating the Packed graph preference to Radial mode.');
      storage?.setItem(RADIAL_LAYOUT_KEY, legacyPacked);
      return legacyPacked !== '0';
    }
    // Default off: Unique mode is the recommended default and reads best in the plain
    // (non-radial) layout.
    return false;
  } catch (error) {
    console.error('Radial graph layout could not be loaded from localStorage.', error);
    return false;
  }
}

/**
 * Far-zoom trees drop to flat chips so a dense graph stays interactive. A phone needs that to
 * survive a large pack at all, so it stays automatic there. A desktop has the headroom to keep
 * drawing real nodes, and the chips are a downgrade it should be asked for rather than given.
 */
function loadLowDetailMode(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    return globalThis.localStorage?.getItem(LOW_DETAIL_KEY) === '1';
  } catch (error) {
    console.error('Low-detail preference could not be loaded from localStorage.', error);
    return false;
  }
}

function loadUseByproducts(): boolean {
  try {
    return useByproductsFromStoredValue(
      globalThis.localStorage?.getItem(USE_BYPRODUCTS_KEY),
    );
  } catch (error) {
    console.error('Byproduct-credit preference could not be loaded from localStorage.', error);
    return DEFAULT_USE_BYPRODUCTS;
  }
}

function loadExpandRecipesOnce(): boolean {
  try {
    // Defaults on: absence of a stored preference means "never explicitly turned off", not
    // "off". Native has no persistence for this at all yet, so this default is also the only
    // thing that makes Unique mode "stick" there.
    return globalThis.localStorage?.getItem(EXPAND_RECIPES_ONCE_KEY) !== '0';
  } catch (error) {
    console.error('Expand-once graph preference could not be loaded from localStorage.', error);
    return true;
  }
}

function nodeDepthBucket(
  node: ItemTreeNode,
): 'root' | 'depth-1' | 'depth-2' | 'depth-3-plus' {
  if (node.id === 'root' || node.ancestors.length === 0) return 'root';
  if (node.ancestors.length === 1) return 'depth-1';
  if (node.ancestors.length === 2) return 'depth-2';
  return 'depth-3-plus';
}

export function GraphScreen({
  treeId,
  rootKey: graphRootKey,
  recipeRef: graphRecipeRef,
  direction: graphDirection,
  requestId: graphRequestId = 0,
  isActive = true,
  openTreeCount = 1,
  onClose,
  interfaceZoom = 1,
  contentZoom = 1,
  onContentZoomChange,
  onContentZoomComplete,
  showGraphControls,
  onToggleGraphControls,
  onSwipeSuppressChange,
  recipeImportRequestId = 0,
  onRecipeImportRequestHandled,
  recipeImportJob = null,
  onRecipeImportStart,
  onRecipeImportComplete,
  recipeImportNotice = null,
  onRecipeImportNoticeChange,
  recipeImportReport = null,
  onRecipeImportReportChange,
}: {
  /** Stable id of this open tree; every other tree open alongside it has its own instance. */
  treeId: number;
  rootKey: string;
  recipeRef: RecipeRef | null;
  direction: GraphDirection;
  /** Bumped by changeGraphDirection/retry to reset this tree's own transient UI state. */
  requestId?: number;
  /** Whether this is the currently focused tree among possibly several open side by side. */
  isActive?: boolean;
  openTreeCount?: number;
  onClose?: () => void;
  interfaceZoom?: number;
  contentZoom?: number;
  onContentZoomChange?: (value: number) => void;
  onContentZoomComplete?: (value: number) => void;
  showGraphControls: boolean;
  onToggleGraphControls(): void;
  /** While true, the enclosing multi-tree pager must not swipe — a drag inside this tree is active. */
  onSwipeSuppressChange?: (suppressed: boolean) => void;
  recipeImportRequestId?: number;
  onRecipeImportRequestHandled?: () => void;
  recipeImportJob?: {id: number; raw: string} | null;
  onRecipeImportStart: (raw: string) => void;
  onRecipeImportComplete: () => void;
  recipeImportNotice?: string | null;
  onRecipeImportNoticeChange?: React.Dispatch<React.SetStateAction<string | null>>;
  recipeImportReport?: RecipeImportReport | null;
  onRecipeImportReportChange?: React.Dispatch<React.SetStateAction<RecipeImportReport | null>>;
}) {
  const data = useData();
  const account = useUser();
  const {
    hiddenStages: hiddenRecipeStages,
    toggleStage: toggleRecipeStage,
  } = useRecipeStages();
  const {
    openRecipeInGraph,
    clearGraphTreeRecipe,
    restoreGraph,
    openItem,
    tab,
    setTab,
    restoredLastTab,
    animateMobs,
    changeGraphDirection: changeGraphDirectionForTree,
  } = useUi();
  const changeGraphDirection = useCallback(
    (direction: GraphDirection) => changeGraphDirectionForTree(treeId, direction),
    [changeGraphDirectionForTree, treeId],
  );

  const [root, setRoot] = useState<ItemTreeNode | null>(null);
  const rootRef = useRef<ItemTreeNode | null>(null);
  rootRef.current = root;
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion(v => v + 1), []);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerLookup, setPickerLookup] = useState<{
    requestId: number;
    title: string;
  } | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  pickerRef.current = picker;
  const [showRootActions, setShowRootActions] = useState(false);
  const [showTreeShare, setShowTreeShare] = useState(false);
  const [treeTransferMode, setTreeTransferMode] = useState<'share' | 'import'>('share');
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [autoExpandSummary, setAutoExpandSummary] =
    useState<AutoExpandSummaryEntry[] | null>(null);
  const [showRecipeImportDetails, setShowRecipeImportDetails] = useState(false);
  useEffect(() => setShowRootActions(false), [graphRequestId]);
  useEffect(() => {
    if (recipeImportRequestId <= 0) return;
    onRecipeImportReportChange?.(null);
    setShowRecipeImportDetails(false);
    setTreeTransferMode('import');
    setShowTreeShare(true);
  }, [onRecipeImportReportChange, recipeImportRequestId]);
  useEffect(() => {
    if (tab !== 'graph') setShowRootActions(false);
  }, [tab]);
  const drivingThePicker = TABS_DRIVING_THE_PICKER.has(tab);
  useSignalSurface(
    drivingThePicker && picker
      ? `${tab}/source-picker`
      : drivingThePicker && pickerLookup
        ? `${tab}/source-lookup`
        : tab === 'graph' && nodeMenu
          ? 'graph/node-options'
        : tab,
    drivingThePicker && (picker || pickerLookup) ? 'modal' : 'screen',
  );
  const pickerGroupLoadsRef = useRef(new Set<string>());
  const pickerRequestIdRef = useRef(0);
  const pendingRootChoiceRef = useRef<{
    key: string;
    direction: GraphDirection;
    choice: SourceChoice;
  } | null>(null);
  const pendingGraphSessionRef = useRef<GraphSession | null>(null);
  const graphSessionRestoreAttemptedRef = useRef(false);
  const restoringGraphSessionRef = useRef(recipeImportJob !== null);
  const recipeImportRestoreAttemptedRef = useRef<number | null>(null);
  const [compactMode, setCompactMode] = useState(loadCompactMode);
  const [radialLayout, setRadialLayout] = useState(loadRadialLayout);
  // The controls wrap onto as many rows as the screen width forces, so the panels below them
  // cannot assume a fixed single-row height without ending up underneath the buttons.
  const [controlsHeight, setControlsHeight] = useState(0);
  const [showMoreControls, setShowMoreControls] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [lowDetailEnabled, setLowDetailEnabled] = useState(loadLowDetailMode);
  const [useByproducts, setUseByproducts] = useState(loadUseByproducts);
  const [expandRecipesOnce, setExpandRecipesOnce] = useState(loadExpandRecipesOnce);
  const expandRecipesOnceRef = useRef(expandRecipesOnce);
  expandRecipesOnceRef.current = expandRecipesOnce;
  useEffect(() => {
    const storedPreference = loadExpandRecipesOnce();
    expandRecipesOnceRef.current = storedPreference;
    setExpandRecipesOnce(storedPreference);
  }, [graphRequestId]);
  const pendingRecipeExpansionOwnersRef = useRef(new Map<string, ItemTreeNode>());
  const [exportingTree, setExportingTree] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const preferredSourceIsAvailable = useCallback(
    (itemKey: string, source: PreferredSource) => {
      const indexed = data.index[itemKey];
      if (!indexed) return false;
      if (source.t !== 'recipe') return true;
      const sourceKey = recipeRefKey(source.ref);
      return (indexed.p ?? []).some(ref => recipeRefKey(ref) === sourceKey);
    },
    [data.index],
  );
  const [preferredSources, setPreferredSources] =
    useState<PreferredSources>(() =>
      loadPreferredSources(data.descriptor, preferredSourceIsAvailable),
    );
  const preferredSourcesRef = useRef(preferredSources);
  preferredSourcesRef.current = preferredSources;
  useEffect(() => {
    const loaded = loadPreferredSources(data.descriptor, preferredSourceIsAvailable);
    preferredSourcesRef.current = loaded;
    setPreferredSources(loaded);
  }, [data.descriptor.publicationId, data.descriptor.slug, preferredSourceIsAvailable]);
  const [manualRetentionOverrides, setManualRetentionOverrides] =
    useState<ManualRetentionOverrides>(() => loadManualRetentionOverrides(data.descriptor));
  const manualRetentionOverridesRef = useRef(manualRetentionOverrides);
  manualRetentionOverridesRef.current = manualRetentionOverrides;
  useEffect(() => {
    const loaded = loadManualRetentionOverrides(data.descriptor);
    manualRetentionOverridesRef.current = loaded;
    setManualRetentionOverrides(loaded);
  }, [data.descriptor.publicationId, data.descriptor.slug]);
  const personalFavoriteSyncRequestRef = useRef(0);
  useEffect(() => {
    if (!account.user || /^local-[a-f0-9]{16}$/u.test(data.descriptor.slug)) return;
    const requestId = personalFavoriteSyncRequestRef.current + 1;
    personalFavoriteSyncRequestRef.current = requestId;
    void (async () => {
      try {
        const browserFavorites = Object.entries(preferredSourcesRef.current)
          .filter(
            (entry): entry is [string, Extract<PreferredSource, {t: 'recipe'}>] =>
              entry[1].t === 'recipe' && preferredSourceIsAvailable(entry[0], entry[1]),
          )
          .map(([itemKey, source]) => ({itemKey, recipeRef: source.ref}));
        await claimAnonymousRecipeFavorites(data.descriptor, browserFavorites);
        const storedFavorites = await loadPersonalRecipeFavorites(data.descriptor);
        const favorites = storedFavorites.filter(favorite =>
          preferredSourceIsAvailable(favorite.itemKey, {t: 'recipe', ref: favorite.recipeRef}),
        );
        const staleFavorites = storedFavorites.filter(favorite =>
          !preferredSourceIsAvailable(favorite.itemKey, {t: 'recipe', ref: favorite.recipeRef}),
        );
        if (staleFavorites.length > 0) {
          const removed = await cleanupInvalidPersonalRecipeFavorites(
            data.descriptor,
            staleFavorites,
          );
          if (removed !== staleFavorites.length) {
            console.warn('Some cross-pack favorites changed before graph cleanup completed.', {
              packSlug: data.descriptor.slug,
              publicationId: data.descriptor.publicationId,
              requested: staleFavorites.length,
              removed,
            });
          }
        }
        if (personalFavoriteSyncRequestRef.current !== requestId) return;
        const next: PreferredSources = {};
        for (const [itemKey, source] of Object.entries(preferredSourcesRef.current)) {
          if (source.t !== 'recipe' && preferredSourceIsAvailable(itemKey, source)) {
            next[itemKey] = source;
          }
        }
        for (const favorite of favorites) {
          const existing = preferredSourcesRef.current[favorite.itemKey];
          next[favorite.itemKey] =
            existing?.t === 'recipe' &&
            existing.ref[0] === favorite.recipeRef[0] &&
            existing.ref[1] === favorite.recipeRef[1]
              ? existing
              : {t: 'recipe', ref: favorite.recipeRef};
        }
        preferredSourcesRef.current = next;
        persistPreferredSources(data.descriptor, next);
        setPreferredSources(next);
      } catch (error) {
        console.error('Signed-in recipe favorites could not be synchronized.', error);
        setExportMessage('Signed-in favorites could not be synchronized.');
      }
    })();
    return () => {
      if (personalFavoriteSyncRequestRef.current === requestId) {
        personalFavoriteSyncRequestRef.current += 1;
      }
    };
  }, [account.revision, account.user, data.descriptor, preferredSourceIsAvailable]);
  const communityPreferredSourcesRef = useRef<PreferredSources>({});
  const communityAutoExpandRef = useRef(false);
  const communityFavoriteRequestRef = useRef(0);
  const [communityAutoExpand, setCommunityAutoExpand] = useState(false);
  const [communityAutoExpandLoading, setCommunityAutoExpandLoading] = useState(false);
  useEffect(() => {
    communityFavoriteRequestRef.current += 1;
    communityPreferredSourcesRef.current = {};
    communityAutoExpandRef.current = false;
    setCommunityAutoExpand(false);
    setCommunityAutoExpandLoading(false);
    setAutoExpandSummary(null);
  }, [data.descriptor.slug, data.descriptor.publicationId]);

  const [transform, setTransform] = useState<GraphTransform>({x: 60, y: 60, scale: 1});
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const displayTransform = graphDisplayTransform(
    transform,
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  );
  const applyTransform = useCallback((next: GraphTransform) => {
    // Gesture events may arrive before React commits the preceding render. Keep
    // the imperative reference synchronized so every event sees the newest transform.
    transformRef.current = next;
    setTransform(next);
    setCullingTransform(next);
  }, []);
  /**
   * Pointer and touch move events arrive far faster than the screen refreshes -- a high-polling
   * mouse reports hundreds of times a second, and a finger is not much kinder -- and rendering the
   * graph once per event meant most of those renders were thrown away before anything was drawn.
   * Gesture updates are coalesced to one render per frame; everything else still applies at once,
   * since a tap or a fit is a single change the user is waiting on.
   */
  const pendingTransformRef = useRef<GraphTransform | null>(null);
  const transformFrameRef = useRef(0);
  const scheduleTransform = useCallback((next: GraphTransform) => {
    transformRef.current = next;
    pendingTransformRef.current = next;
    if (transformFrameRef.current !== 0) return;
    transformFrameRef.current = requestAnimationFrame(() => {
      transformFrameRef.current = 0;
      const pending = pendingTransformRef.current;
      pendingTransformRef.current = null;
      if (!pending) return;
      setTransform(pending);
      setCullingTransform(current =>
        shouldRecomputeCulling(current, pending) ? pending : current,
      );
    });
  }, []);
  useEffect(
    () => () => {
      if (transformFrameRef.current !== 0) cancelAnimationFrame(transformFrameRef.current);
    },
    [],
  );
  const viewportRef = useRef({w: 0, h: 0});
  const [viewportSize, setViewportSize] = useState({w: 0, h: 0});
  const [cullingTransform, setCullingTransform] = useState<GraphTransform>({
    x: 60,
    y: 60,
    scale: 1,
  });
  const needsFitRef = useRef(false);
  const wrapRef = useRef<View>(null);
  const anchorRef = useRef<View>(null);

  const recipesFor = useCallback(
    (key: string, equivalentKeys?: readonly string[]): RecipeRef[] => {
      const all = indexedRecipeRefs(data.index, key, equivalentKeys, 'p').filter(
        r =>
          !data.metaCategories.has(r[0]) &&
          !isDefaultDisabledRecipeCategory(data.categories[r[0]]),
      );
      // Prefer real recipes; then smithing/trading; anvil repairs only as a last resort.
      const primary = all.filter(r => !data.secondaryCategories.has(r[0]));
      if (primary.length > 0) return primary;
      const nonRepair = all.filter(r => !data.repairCategories.has(r[0]));
      return nonRepair.length > 0 ? nonRepair : all;
    },
    [
      data.index,
      data.categories,
      data.metaCategories,
      data.secondaryCategories,
      data.repairCategories,
    ],
  );

  const usagesFor = useCallback(
    (key: string, equivalentKeys?: readonly string[]): RecipeRef[] => {
      const all = indexedRecipeRefs(data.index, key, equivalentKeys, 'u').filter(
        ref =>
          !data.metaCategories.has(ref[0]) &&
          !isDefaultDisabledRecipeCategory(data.categories[ref[0]]),
      );
      const primary = all.filter(ref => !data.secondaryCategories.has(ref[0]));
      if (primary.length > 0) return primary;
      const nonRepair = all.filter(ref => !data.repairCategories.has(ref[0]));
      return nonRepair.length > 0 ? nonRepair : all;
    },
    [
      data.index,
      data.categories,
      data.metaCategories,
      data.secondaryCategories,
      data.repairCategories,
    ],
  );

  const recipeRefsFor = useCallback(
    (
      key: string,
      direction: GraphDirection = graphDirection,
      equivalentKeys?: readonly string[],
    ): RecipeRef[] =>
      direction === 'outputs'
        ? usagesFor(key, equivalentKeys)
        : recipesFor(key, equivalentKeys),
    [graphDirection, recipesFor, usagesFor],
  );

  /** Direction-appropriate recipe choices, plus physical sources for ingredient trees. */
  const choicesFor = useCallback(
    (
      key: string,
      direction: GraphDirection = graphDirection,
      equivalentKeys?: readonly string[],
    ): SourceChoice[] => {
      const lookupKeys = [...new Set([key, ...(equivalentKeys ?? [])])];
      const recipes = recipeRefsFor(key, direction, equivalentKeys).map(
        ref => ({t: 'recipe', ref}) as SourceChoice,
      );
      if (direction === 'outputs') return recipes;
      const blockChoices = lookupKeys.flatMap(lookupKey => data.minedFrom.get(lookupKey) ?? []);
      const mobChoices = lookupKeys.flatMap(lookupKey => data.droppedByMobs.get(lookupKey) ?? []);
      return [
        ...recipes,
        ...blockChoices.map(
          ({blockKey, stat}) => ({t: 'block', blockKey, stat}) as SourceChoice,
        ),
        ...mobChoices.map(
          ({mob, stat}) => ({t: 'mob', mob, stat}) as SourceChoice,
        ),
      ];
    },
    [graphDirection, recipeRefsFor, data.minedFrom, data.droppedByMobs],
  );

  const preferredSourceFor = useCallback(
    (key: string, equivalentKeys?: readonly string[]): SourceChoice | null => {
      if (graphDirection === 'outputs') return null;
      const choiceForPreference = (preferred: PreferredSource | undefined): SourceChoice | null => {
        if (!preferred) return null;
        if (preferred.t === 'recipe') {
          const exists = indexedRecipeRefs(data.index, key, equivalentKeys, 'p').some(
            ref =>
              !data.metaCategories.has(ref[0]) &&
              !isDefaultDisabledRecipeCategory(data.categories[ref[0]]) &&
              ref[0] === preferred.ref[0] &&
              ref[1] === preferred.ref[1],
          );
          return exists
            ? {
                t: 'recipe',
                ref: preferred.ref,
                ...(preferred.allowFluidTransfer ? {allowFluidTransfer: true as const} : {}),
                ...(preferred.ingredientSelections
                  ? {ingredientSelections: {...preferred.ingredientSelections}}
                  : {}),
              }
            : null;
        }
        return choicesFor(key, graphDirection, equivalentKeys).find(choice =>
          choiceMatchesPreference(choice, preferred),
        ) ?? null;
      };

      const personalChoice = choiceForPreference(preferredSourcesRef.current[key]);
      if (personalChoice) return personalChoice;
      return communityAutoExpandRef.current
        ? choiceForPreference(communityPreferredSourcesRef.current[key])
        : null;
    },
    [graphDirection, choicesFor, data.index, data.categories, data.metaCategories],
  );

  const setPreferredSource = useCallback(
    (key: string, choice: SourceChoice | null) => {
      const next = {...preferredSourcesRef.current};
      if (choice) next[key] = preferredSourceFromChoice(choice);
      else delete next[key];
      preferredSourcesRef.current = next;
      persistPreferredSources(data.descriptor, next);
      setPreferredSources(next);
      const recipeRef = choice?.t === 'recipe' ? choice.ref : null;
      void updateCommunityRecipeFavorite(data.descriptor, key, recipeRef).catch(error => {
        console.error('The shared recipe favorite could not be updated.', error);
      });
    },
    [data.descriptor],
  );

  const applyChoiceRef = useRef<
    | ((
        node: ItemTreeNode,
        choice: SourceChoice,
        options?: {renderUpdates?: boolean; expansionBudget?: ExpansionBudget},
      ) => void)
    | null
  >(null);

  const expandRecipe = useCallback(
    async (
      node: ItemTreeNode,
      ref: RecipeRef,
      {
        allowFluidTransfer = false,
        expandPreferredChildren = true,
        recordHistory = true,
        ingredientSelections,
        renderUpdates = true,
        expansionBudget,
      }: {
        allowFluidTransfer?: boolean;
        expandPreferredChildren?: boolean;
        recordHistory?: boolean;
        ingredientSelections?: IngredientSelections;
        renderUpdates?: boolean;
        /** Present only for the automatic cascade; a deliberate Auto expand passes none. */
        expansionBudget?: ExpansionBudget;
      } = {},
    ): Promise<boolean> => {
      node.loading = true;
      if (renderUpdates) bump();
      try {
        const [recipe] = await withRecipeLoadTimeout(
          data.getRecipes([ref]),
          `Recipe ${ref.join(':')}`,
        );
        const cat = data.categories[ref[0]];
        if (!recipe || !cat || recipe.err) {
          console.error('The selected graph recipe is unavailable or invalid.', {
            itemKey: node.key,
            recipeRef: ref,
            recipeLoaded: !!recipe,
            categoryLoaded: !!cat,
            recipeError: recipe?.err,
          });
          return false;
        }
        const selectedRecipe = applyIngredientSelections(recipe, ingredientSelections);
        if (isRedundantFluidContainerRecipe(selectedRecipe, data.itemsByKey)) {
          console.info('A redundant fluid-container recipe was excluded from the graph.', {
            itemKey: node.key,
            recipeRef: ref,
          });
          const stored = preferredSourcesRef.current[node.key];
          if (
            stored?.t === 'recipe' &&
            stored.ref[0] === ref[0] &&
            stored.ref[1] === ref[1]
          ) {
            setPreferredSource(node.key, null);
          }
          return false;
        }
        if (
          !allowFluidTransfer &&
          isFluidContainerTransferRecipe(selectedRecipe, data.itemsByKey, cat)
        ) {
          console.info('A fluid container-transfer recipe was suppressed by the default filter.', {
            itemKey: node.key,
            recipeRef: ref,
          });
          const stored = preferredSourcesRef.current[node.key];
          if (
            stored?.t === 'recipe' &&
            stored.ref[0] === ref[0] &&
            stored.ref[1] === ref[1]
          ) {
            setPreferredSource(node.key, null);
          }
          return false;
        }
        if (graphDirection === 'outputs') {
          const anchor = recipeChildrenForDirection(selectedRecipe, 'inputs').find(
            input =>
              input.key === node.key || input.alternatives.includes(node.key),
          );
          if (!anchor) {
            console.error('An output-directed recipe does not use its graph anchor item.', {
              itemKey: node.key,
              recipeRef: ref,
            });
            return false;
          }
          node.amount = anchor.amount;
        } else if (node.id === 'root') {
          const output = slotSummary(selectedRecipe.out).find(
            candidate =>
              candidate.key === node.key || candidate.alternatives.includes(node.key),
          );
          if (!output) {
            console.error('An ingredient-directed root recipe does not produce its graph root item.', {
              itemKey: node.key,
              recipeRef: ref,
            });
            return false;
          }
          node.amount = output.amount;
        }
        const sourceId = `${node.id}.s`;
        const childSpecs = recipeChildrenForDirection(selectedRecipe, graphDirection);
        const children = childSpecs.map((spec, i) => {
          const retentionOverride = graphDirection === 'inputs'
            ? manualRetentionOverrideFor(manualRetentionOverridesRef.current, ref, spec.key)
            : undefined;
          const nonConsumed = retentionOverride ?? spec.nonConsumed;
          const child: ItemTreeNode = {
            id: `${sourceId}.${i}`,
            key: spec.key,
            amount: spec.amount,
            variantCount: spec.variants,
            alternatives: spec.alternatives,
            selectionKey:
              Object.entries(ingredientSelections ?? {}).find(
                ([selectionKey, selectedKey]) =>
                  selectedKey === spec.key && spec.alternatives.includes(selectionKey),
              )?.[0] ?? spec.key,
            tag: spec.tag,
            nonConsumed,
            retentionMode:
              retentionOverride === undefined
                ? spec.retentionMode
                : retentionOverride
                  ? 'reusable'
                  : undefined,
            retentionUses:
              retentionOverride === undefined ? spec.retentionUses : undefined,
            consumptionProbability:
              spec.probabilityRole === 'consume' && !nonConsumed
                ? spec.probability
                : undefined,
            productionProbability:
              spec.probabilityRole === 'produce' ? spec.probability : undefined,
            ancestors: [...node.ancestors, node.key],
            cyclic: node.ancestors.includes(spec.key) || spec.key === node.key,
          };
          return child;
        });
        node.collapsedSource = undefined;
        node.source = {
          id: sourceId,
          kind: 'recipe',
          ref,
          recipe: selectedRecipe,
          dir: cat.dir,
          catTitle: recipeDisplayTitle(cat.title, recipe),
          direction: graphDirection,
          ingredientSelections:
            ingredientSelections && Object.keys(ingredientSelections).length > 0
              ? {...ingredientSelections}
              : undefined,
          allowFluidTransfer: allowFluidTransfer || undefined,
          inputs: children,
        };
        if (node.id === 'root' && recordHistory) {
          recordRecipeHistory(data.descriptor, {
            itemKey: node.key,
            ref,
            title: recipeDisplayTitle(cat.title, recipe),
            recipeId: recipe.id ?? null,
            openedAt: Date.now(),
            direction: graphDirection,
          });
        }
        if (expandPreferredChildren) {
          // The budget learns the tree's width from each level as it lands, so a pack that
          // branches ten ways stops after two levels while a near-linear chain keeps going.
          expansionBudget?.record(children.length);
          for (const child of children) {
            if (child.cyclic) continue;
            if (expansionBudget && !expansionBudget.allowsDepth(child.ancestors.length)) {
              continue;
            }
            const preferred =
              graphDirection === 'inputs'
                ? preferredSourceFor(child.key, child.alternatives)
                : null;
            if (preferred) {
              applyChoiceRef.current?.(child, preferred, {expansionBudget});
            }
          }
        }
        return true;
      } catch (error) {
        console.error('The selected graph recipe could not be expanded.', error);
        if (error instanceof RecipeLoadTimeoutError) {
          setExportMessage(`${error.message} Tap the item to try again.`);
        }
        return false;
      } finally {
        node.loading = false;
        if (renderUpdates) bump();
      }
    },
    [data, bump, graphDirection, preferredSourceFor, setPreferredSource],
  );

  /** Replace every eligible occurrence with the newly preferred source. */
  const applyPreferredSourceAcrossTree = useCallback(
    (target: ItemTreeNode, choice: SourceChoice, expansionBudget?: ExpansionBudget) => {
      const currentRoot = rootRef.current;
      const matches = preferredSourceTargets(currentRoot, target);
      for (const match of matches) {
        if (match.source) releaseByproductFulfillments(currentRoot, match);
        match.source = undefined;
      }
      for (const match of matches) {
        applyChoiceRef.current?.(match, choice, {expansionBudget});
      }
    },
    [],
  );

  const applyRecipeChoice = useCallback(
    async (
      node: ItemTreeNode,
      choice: RecipeSourceChoice,
      {
        expandPreferredChildren = true,
        renderUpdates = true,
        recordHistory = true,
        expansionBudget,
      }: {
        expandPreferredChildren?: boolean;
        renderUpdates?: boolean;
        recordHistory?: boolean;
        expansionBudget?: ExpansionBudget;
      } = {},
    ): Promise<boolean> => {
      const identity = recipeExpansionIdentity(node.key, graphDirection, choice);
      if (expandRecipesOnceRef.current) {
        const owner =
          findRecipeExpansionOwner(
            rootRef.current,
            node.key,
            graphDirection,
            choice,
            node,
          ) ?? pendingRecipeExpansionOwnersRef.current.get(identity);
        if (owner && owner !== node) {
          node.source = undefined;
          node.deferredRecipeExpansion = {
            ref: [...choice.ref],
            ...(choice.allowFluidTransfer ? {allowFluidTransfer: true as const} : {}),
            ...(choice.ingredientSelections
                ? {ingredientSelections: {...choice.ingredientSelections}}
                : {}),
          };
          // Deferring a duplicate changes expansion ownership, not the user's
          // viewport intent. Preserve the current pan and zoom transform.
          if (renderUpdates) bump();
          return true;
        }
      }

      node.deferredRecipeExpansion = undefined;
      pendingRecipeExpansionOwnersRef.current.set(identity, node);
      try {
        const expanded = await expandRecipe(node, choice.ref, {
          allowFluidTransfer: choice.allowFluidTransfer === true,
          ingredientSelections: choice.ingredientSelections,
          expandPreferredChildren,
          renderUpdates,
          recordHistory,
          expansionBudget,
        });
        if (!expanded) {
          console.error('The requested recipe expansion could not claim its graph position.', {
            nodeId: node.id,
            itemKey: node.key,
            recipeRef: choice.ref,
          });
        }
        return expanded;
      } finally {
        if (pendingRecipeExpansionOwnersRef.current.get(identity) === node) {
          pendingRecipeExpansionOwnersRef.current.delete(identity);
        }
      }
    },
    [bump, expandRecipe, graphDirection],
  );

  const applyChoice = useCallback(
    (
      node: ItemTreeNode,
      choice: SourceChoice,
      {renderUpdates = true, expansionBudget}: {
        renderUpdates?: boolean;
        expansionBudget?: ExpansionBudget;
      } = {},
    ) => {
      if (blockRecursiveExpansion(node, 'apply source choice')) return;
      if (choice.t === 'recipe') {
        void applyRecipeChoice(node, choice, {renderUpdates, expansionBudget});
        return;
      }
      node.deferredRecipeExpansion = undefined;
      node.collapsedSource = undefined;
      const sourceId = `${node.id}.s`;
      node.source =
        choice.t === 'mob'
          ? {id: sourceId, kind: 'mob', mob: choice.mob, stat: choice.stat, inputs: []}
          : {id: sourceId, kind: 'block', blockKey: choice.blockKey, stat: choice.stat, inputs: []};
      if (renderUpdates) bump();
    },
    [applyRecipeChoice, bump],
  );
  applyChoiceRef.current = applyChoice;

  const restoreExpandedGraph = useCallback(
    async (newRoot: ItemTreeNode, session: GraphSession) => {
      try {
        if (session.direction !== graphDirection) {
          throw new Error(
            `Saved graph direction ${session.direction} does not match active direction ${graphDirection}.`,
          );
        }
        const restoredNodesByPath = new Map<string, ItemTreeNode>();
        const reconstructionFailures: Array<{
          path: number[];
          itemKey: string;
          error: string;
        }> = [];
        let dependentSelectionCount = 0;
        let restoredSelectionCount = 0;
        newRoot.productionPlan = session.productionPlan
          ? {...session.productionPlan}
          : undefined;
        for (const selection of session.selections) {
          const pathKey = selection.path.join('.');
          if (
            selection.path.length > 0 &&
            !restoredNodesByPath.has(selection.path.slice(0, -1).join('.'))
          ) {
            dependentSelectionCount += 1;
            continue;
          }
          try {
            const node = nodeForStoredSelection(
              newRoot,
              selection,
              restoredNodesByPath,
            );
            if (isRecursiveItemNode(node)) {
              throw new Error(
                `Saved graph tries to expand recursive item ${JSON.stringify(node.key)}.`,
              );
            }
            if (selection.source.kind === 'recipe') {
              if (selection.deferred) {
                node.deferredRecipeExpansion = {
                  ref: [...selection.source.ref],
                  ...(selection.source.allowFluidTransfer
                    ? {allowFluidTransfer: true as const}
                    : {}),
                  ...(selection.source.ingredientSelections
                    ? {ingredientSelections: {...selection.source.ingredientSelections}}
                    : {}),
                };
                restoredNodesByPath.set(pathKey, node);
                restoredSelectionCount += 1;
                continue;
              }
              const expanded = await expandRecipe(node, selection.source.ref, {
                allowFluidTransfer: selection.source.allowFluidTransfer === true,
                ingredientSelections: selection.source.ingredientSelections,
                expandPreferredChildren: false,
                recordHistory: false,
              });
              if (!expanded) {
                throw new Error(
                  `Saved recipe ${selection.source.ref.join(':')} could not be reconstructed.`,
                );
              }
            } else {
              const storedSource = selection.source;
              const sourceChoice = choicesFor(node.key, session.direction).find(choice =>
                storedSource.kind === 'mob'
                  ? choice.t === 'mob' && choice.mob.id === storedSource.mobId
                  : choice.t === 'block' && choice.blockKey === storedSource.blockKey,
              );
              if (!sourceChoice) {
                throw new Error(
                  `Saved ${selection.source.kind} source for ${JSON.stringify(node.key)} is unavailable.`,
                );
              }
              applyChoice(node, sourceChoice);
            }
            restoredNodesByPath.set(pathKey, node);
            restoredSelectionCount += 1;
          } catch (error) {
            reconstructionFailures.push({
              path: selection.path,
              itemKey: selection.itemKey,
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown graph reconstruction failure.',
            });
          }
        }
        const skippedSelectionCount =
          reconstructionFailures.length + dependentSelectionCount;
        if (skippedSelectionCount > 0) {
          console.warn('A saved graph was reconstructed partially.', {
            restoredSelectionCount,
            reconstructionFailures,
            dependentSelectionCount,
          });
          const reconstructionMessage =
            `Reconstruction kept ${restoredSelectionCount} selections and skipped ` +
            `${skippedSelectionCount} invalid or dependent selections.`;
          onRecipeImportNoticeChange?.(current =>
            current ? `${current} ${reconstructionMessage}` : reconstructionMessage,
          );
          setExportMessage(current =>
            current?.startsWith('Opened partial tree:')
              ? `${current} ${reconstructionMessage}`
              : `Opened partial tree: ${reconstructionMessage}`,
          );
        }
        needsFitRef.current = true;
      } catch (error) {
        console.error('The saved graph could not be reconstructed; its snapshot was discarded.', error);
        clearGraphSession(data.descriptor);
        const cleanRoot = makeRoot(session.rootKey);
        rootRef.current = cleanRoot;
        setRoot(cleanRoot);
        needsFitRef.current = true;
      } finally {
        restoringGraphSessionRef.current = false;
        bump();
      }
    },
    [
      applyChoice,
      bump,
      choicesFor,
      data.descriptor,
      expandRecipe,
      graphDirection,
      onRecipeImportNoticeChange,
    ],
  );

  const pickerEntryFor = useCallback(
    (
      targetKey: string,
      choice: SourceChoice,
      recipe?: Recipe,
      direction: GraphDirection = graphDirection,
    ): PickerEntry => {
      const currentPreferred =
        direction === 'inputs' ? preferredSourcesRef.current[targetKey] : undefined;
      const favoritePrefix =
        currentPreferred && choiceMatchesPreference(choice, currentPreferred) ? '★ ' : '';
      const itemName = (key: string) => data.itemsByKey.get(key)?.n ?? key;
      if (choice.t === 'recipe') {
        const presentedRecipe = recipe
          ? applyIngredientSelections(recipe, choice.ingredientSelections)
          : recipe;
        const [categoryIndex, recipeIndex] = choice.ref;
        const category = data.categories[categoryIndex];
        if (!category) {
          console.error('A recipe-source picker option references a missing category.', {
            itemKey: targetKey,
            categoryIndex,
            recipeIndex,
          });
        }
        const title =
          presentedRecipe && category
            ? recipeDisplayTitle(category.title, presentedRecipe)
            : category?.title;
        return {
          choice,
          recipe: presentedRecipe,
          option: {
            label: `${favoritePrefix}${title ?? `category ${categoryIndex}`}`,
            groupKey: category?.id ?? `recipe-category:${categoryIndex}`,
            groupLabel: category?.title ?? `Recipe category ${categoryIndex}`,
            sublabel:
              [
                presentedRecipe?.id,
                presentedRecipe?.stage
                  ? `Requires stage ${presentedRecipe.stage}`
                  : undefined,
                presentedRecipe && recipeNeedsLayoutPreviewUnavailableNotice(presentedRecipe)
                  ? 'JEI layout preview unavailable'
                  : undefined,
              ]
                .filter((value): value is string => !!value)
                .join(' · ') || undefined,
            imageUri:
              presentedRecipe?.img && category
                ? data.imageUrl(recipeImagePath(category.dir, presentedRecipe.img))
                : undefined,
            imageBackgroundUri:
              presentedRecipe?.bg && category
                ? data.imageUrl(recipeImagePath(category.dir, presentedRecipe.bg))
                : undefined,
            imageW: presentedRecipe?.w,
            imageH: presentedRecipe?.h,
            structure: presentedRecipe?.structure,
            inputs:
              recipe && direction === 'inputs'
                ? materialInputSummary(recipe).map(input => {
                    const selectedEntry = Object.entries(
                      choice.ingredientSelections ?? {},
                    ).find(([selectionKey]) =>
                      input.alternatives.includes(selectionKey),
                    );
                    const selected = selectedEntry?.[1];
                    return selected
                      ? selectSlotAlternative(
                          {...input, selectionKey: selectedEntry[0]},
                          selected,
                        )
                      : input;
                  })
                : undefined,
            outputs: presentedRecipe
              ? slotSummary(presentedRecipe.out)
              : undefined,
            machineKey: category?.catalysts[0],
            machineLabel: category?.catalysts[0]
              ? itemName(category.catalysts[0])
              : undefined,
          },
        };
      }
      if (choice.t === 'block') {
        return {
          choice,
          option: {
            label: `${favoritePrefix}Mining · ${itemName(choice.blockKey)}`,
            groupKey: 'physical:mining',
            groupLabel: 'Mining',
            sublabel: formatDropStat(choice.stat),
          },
        };
      }
      return {
        choice,
        option: {
          label: `${favoritePrefix}Mob drop · ${choice.mob.n}`,
          groupKey: 'physical:mob-drops',
          groupLabel: 'Mob drops',
          sublabel: formatDropStat(choice.stat),
        },
      };
    },
    [data, graphDirection],
  );

  const openPicker = useCallback(
    async (
      target: ItemTreeNode,
      byproductCoverage?: NodeByproductCoverage,
      direction: GraphDirection = graphDirection,
    ) => {
      if (blockRecursiveExpansion(target, 'open source picker')) return;
      const requestId = ++pickerRequestIdRef.current;
      const itemName = data.itemsByKey.get(target.key)?.n ?? target.key;
      const lookupTitle =
        direction === 'outputs' ? `Find uses for ${itemName}` : `Find recipes for ${itemName}`;
      setPickerLookup({requestId, title: lookupTitle});
      try {
      const currentPreferred =
        direction === 'inputs' ? preferredSourcesRef.current[target.key] : undefined;
      const allChoices = choicesFor(target.key, direction, target.alternatives);
      const physicalChoices = allChoices.filter(choice => choice.t !== 'recipe');
      const recipeChoices = allChoices.filter(
        (choice): choice is RecipeSourceChoice => choice.t === 'recipe',
      );
      const plan = planRecipePickerChoices(
        recipeChoices,
        data.categories,
        MAX_RECIPE_PICKER_CHOICES,
      );
      const recipesByRef = new Map<string, Awaited<ReturnType<typeof data.getRecipes>>[number]>();
      const standardRecipeChoices: RecipeSourceChoice[] = [];
      const fluidTransferChoices: RecipeSourceChoice[] = [];
      const loadedRefKeys = new Set<string>();
      let identifiedFluidTransferCount = 0;
      let excludedRedundantContainerCount = 0;
      const initialRecipes = await withRecipeLoadTimeout(
        data.getRecipes(plan.initialChoices.map(choice => choice.ref)),
        `Recipes for ${itemName}`,
      );
      plan.initialChoices.forEach((choice, index) => {
        const recipe = initialRecipes[index];
        const refKey = recipeRefKey(choice.ref);
        recipesByRef.set(refKey, recipe);
        loadedRefKeys.add(refKey);
        if (isRedundantFluidContainerRecipe(recipe, data.itemsByKey)) {
          excludedRedundantContainerCount += 1;
          return;
        }
        if (
          isFluidContainerTransferRecipe(
            recipe,
            data.itemsByKey,
            data.categories[choice.ref[0]],
          )
        ) {
          identifiedFluidTransferCount += 1;
          fluidTransferChoices.push({...choice, allowFluidTransfer: true});
        } else {
          standardRecipeChoices.push(choice);
        }
      });

      // Preserve a saved source even when it is a later variant in a staged group.
      if (currentPreferred?.t === 'recipe') {
        const preferredChoice = recipeChoices.find(choice =>
          choiceMatchesPreference(choice, currentPreferred),
        );
        if (preferredChoice && !recipesByRef.has(recipeRefKey(preferredChoice.ref))) {
          const [recipe] = await data.getRecipes([preferredChoice.ref]);
          const preferredRefKey = recipeRefKey(preferredChoice.ref);
          recipesByRef.set(preferredRefKey, recipe);
          loadedRefKeys.add(preferredRefKey);
          if (isRedundantFluidContainerRecipe(recipe, data.itemsByKey)) {
            excludedRedundantContainerCount += 1;
          } else if (
            isFluidContainerTransferRecipe(
              recipe,
              data.itemsByKey,
              data.categories[preferredChoice.ref[0]],
            )
          ) {
            identifiedFluidTransferCount += 1;
            const explicitChoice = {...preferredChoice, allowFluidTransfer: true as const};
            fluidTransferChoices.push(explicitChoice);
          } else {
            standardRecipeChoices.push(preferredChoice);
          }
        }
      }

      if (excludedRedundantContainerCount > 0) {
        console.info('Redundant fluid-container recipes were excluded from the source picker.', {
          itemKey: target.key,
          excludedRecipes: excludedRedundantContainerCount,
        });
      }

      const remainingRecipeChoices: Record<string, RecipeSourceChoice[]> = {};
      const recipeGroupProgress: Record<string, PickerGroupProgress> = {};
      for (const group of plan.groups) {
        const remaining = group.choices.filter(
          choice => !loadedRefKeys.has(recipeRefKey(choice.ref)),
        );
        remainingRecipeChoices[group.groupKey] = remaining;
        recipeGroupProgress[group.groupKey] = {
          loaded: group.choices.length - remaining.length,
          total: group.choices.length,
        };
      }

      const withCurrentPreference = (
        choice: RecipeSourceChoice,
      ): RecipeSourceChoice =>
        currentPreferred?.t === 'recipe' &&
        choiceMatchesPreference(choice, currentPreferred)
          ? {
              ...choice,
              ...(currentPreferred.allowFluidTransfer
                ? {allowFluidTransfer: true as const}
                : {}),
              ...(currentPreferred.ingredientSelections
                ? {
                    ingredientSelections: {
                      ...currentPreferred.ingredientSelections,
                    },
                  }
                : {}),
            }
          : choice;
      if (requestId !== pickerRequestIdRef.current) {
        console.info('A stale recipe-source picker request was discarded.', {
          itemKey: target.key,
          requestId,
          currentRequestId: pickerRequestIdRef.current,
        });
        return;
      }
      setPicker({
        requestId,
        direction,
        title:
          direction === 'outputs'
            ? `Use ${itemName} to produce`
            : `Obtain ${itemName}`,
        standardEntries: [
          ...physicalChoices.map(choice =>
            pickerEntryFor(target.key, choice, undefined, direction),
          ),
          ...standardRecipeChoices.map(choice =>
            pickerEntryFor(
              target.key,
              withCurrentPreference(choice),
              recipesByRef.get(recipeRefKey(choice.ref)),
              direction,
            ),
          ),
        ],
        fluidTransferEntries: fluidTransferChoices.map(choice =>
          pickerEntryFor(
            target.key,
            withCurrentPreference(choice),
            recipesByRef.get(recipeRefKey(choice.ref)),
            direction,
          ),
        ),
        showFluidTransfers: false,
        identifiedFluidTransferCount,
        remainingRecipeChoices,
        recipeGroupProgress,
        target,
        byproductCoverage,
        rememberSource: direction === 'inputs',
        productionPlan:
          target.id === 'root' && direction === 'inputs'
            ? target.productionPlan ?? {
                amount: Math.max(1, target.amount ?? 1),
                windowSeconds: 1,
              }
            : undefined,
        collapsedGroupKeys: loadCollapsedRecipeCategories(),
      });
      } finally {
        setPickerLookup(current =>
          current?.requestId === requestId ? null : current,
        );
      }
    },
    [data, choicesFor, graphDirection, pickerEntryFor],
  );

  const loadPickerRecipeGroup = useCallback(
    async (groupKey: string) => {
      const snapshot = pickerRef.current;
      const remaining = snapshot?.remainingRecipeChoices[groupKey] ?? [];
      if (!snapshot || remaining.length === 0 || pickerGroupLoadsRef.current.has(groupKey)) {
        return;
      }
      const batch = remaining.slice(0, RECIPE_PICKER_GROUP_PAGE);
      pickerGroupLoadsRef.current.add(groupKey);
      setPicker(current => {
        if (!current || current.requestId !== snapshot.requestId) return current;
        return {
          ...current,
          recipeGroupProgress: {
            ...current.recipeGroupProgress,
            [groupKey]: {...current.recipeGroupProgress[groupKey], loading: true},
          },
        };
      });
      try {
        const recipes = await data.getRecipes(batch.map(choice => choice.ref));
        const standardEntries: PickerEntry[] = [];
        const fluidTransferEntries: PickerEntry[] = [];
        let identifiedFluidTransferCount = 0;
        let excludedRedundantContainerCount = 0;
        batch.forEach((choice, index) => {
          const recipe = recipes[index];
          if (isRedundantFluidContainerRecipe(recipe, data.itemsByKey)) {
            excludedRedundantContainerCount += 1;
            return;
          }
          if (
            isFluidContainerTransferRecipe(
              recipe,
              data.itemsByKey,
              data.categories[choice.ref[0]],
            )
          ) {
            identifiedFluidTransferCount += 1;
            const explicitChoice = {...choice, allowFluidTransfer: true as const};
            fluidTransferEntries.push(
              pickerEntryFor(
                snapshot.target.key,
                explicitChoice,
                recipe,
                snapshot.direction,
              ),
            );
          } else {
            standardEntries.push(
              pickerEntryFor(
                snapshot.target.key,
                choice,
                recipe,
                snapshot.direction,
              ),
            );
          }
        });
        if (excludedRedundantContainerCount > 0) {
          console.info('Redundant fluid-container recipes were excluded from a picker page.', {
            itemKey: snapshot.target.key,
            groupKey,
            excludedRecipes: excludedRedundantContainerCount,
          });
        }
        setPicker(current => {
          if (!current || current.requestId !== snapshot.requestId) return current;
          const currentRemaining = current.remainingRecipeChoices[groupKey] ?? [];
          const loadedKeys = new Set(batch.map(choice => recipeRefKey(choice.ref)));
          const nextRemaining = currentRemaining.filter(
            choice => !loadedKeys.has(recipeRefKey(choice.ref)),
          );
          const progress = current.recipeGroupProgress[groupKey];
          return {
            ...current,
            standardEntries: [...current.standardEntries, ...standardEntries],
            fluidTransferEntries: [
              ...current.fluidTransferEntries,
              ...fluidTransferEntries,
            ],
            identifiedFluidTransferCount:
              current.identifiedFluidTransferCount + identifiedFluidTransferCount,
            remainingRecipeChoices: {
              ...current.remainingRecipeChoices,
              [groupKey]: nextRemaining,
            },
            recipeGroupProgress: {
              ...current.recipeGroupProgress,
              [groupKey]: {
                loaded: (progress?.loaded ?? 0) + batch.length,
                total: progress?.total ?? batch.length,
                loading: false,
              },
            },
          };
        });
      } catch (error) {
        console.error('Additional recipe-source variants could not be loaded.', {
          itemKey: snapshot.target.key,
          groupKey,
          requestedRecipes: batch.length,
          error,
        });
        setPicker(current => {
          if (!current || current.requestId !== snapshot.requestId) return current;
          return {
            ...current,
            recipeGroupProgress: {
              ...current.recipeGroupProgress,
              [groupKey]: {
                ...current.recipeGroupProgress[groupKey],
                loading: false,
              },
            },
          };
        });
      } finally {
        pickerGroupLoadsRef.current.delete(groupKey);
      }
    },
    [data, pickerEntryFor],
  );

  const togglePickerGroup = useCallback(
    (groupKey: string) => {
      setPicker(current => {
        if (!current) return current;
        const nextCollapsed = toggleCollapsedRecipeCategory(
          current.collapsedGroupKeys,
          groupKey,
        );
        if (data.categories.some(category => category.id === groupKey)) {
          const categoryIds = new Set(data.categories.map(category => category.id));
          persistCollapsedRecipeCategories(
            new Set([...nextCollapsed].filter(id => categoryIds.has(id))),
          );
        }
        return {...current, collapsedGroupKeys: nextCollapsed};
      });
    },
    [data.categories],
  );

  const openPickerWithErrorHandling = useCallback(
    (
      node: ItemTreeNode,
      byproductCoverage?: NodeByproductCoverage,
      direction: GraphDirection = graphDirection,
    ) => {
      void openPicker(node, byproductCoverage, direction).catch(error => {
        console.error('The recipe-source picker could not be opened.', error);
        setExportMessage(
          error instanceof RecipeLoadTimeoutError
            ? `${error.message} Tap the item to try again.`
            : 'Recipes for that item could not be loaded.',
        );
      });
    },
    [graphDirection, openPicker],
  );

  /**
   * Auto expand pauses on a node with no remembered recipe and asks. The picker reports its
   * outcome through this, so the run continues on a choice and stops when the prompt is dismissed
   * -- the alternative being a prompt for every remaining node with no way out of them.
   */
  const sourcePromptRef = useRef<((chosen: boolean) => void) | null>(null);
  const pickerSelectionMadeRef = useRef(false);
  const settleSourcePrompt = useCallback((chosen: boolean) => {
    const resolve = sourcePromptRef.current;
    sourcePromptRef.current = null;
    resolve?.(chosen);
  }, []);
  useEffect(() => {
    if (picker || !sourcePromptRef.current) return;
    const chosen = pickerSelectionMadeRef.current;
    pickerSelectionMadeRef.current = false;
    settleSourcePrompt(chosen);
  }, [picker, settleSourcePrompt]);
  const requestSourceChoice = useCallback(
    (node: ItemTreeNode) =>
      new Promise<boolean>(resolve => {
        // A prompt already waiting means the previous one never settled; treat it as dismissed
        // rather than leaving two runs waiting on the same picker.
        settleSourcePrompt(false);
        pickerSelectionMadeRef.current = false;
        sourcePromptRef.current = resolve;
        openPickerWithErrorHandling(node);
      }),
    [openPickerWithErrorHandling, settleSourcePrompt],
  );

  const cancelPickerLookup = useCallback(() => {
    pickerRequestIdRef.current += 1;
    setPickerLookup(null);
  }, []);

  useEffect(() => {
    if (!TABS_DRIVING_THE_PICKER.has(tab) && pickerLookup) cancelPickerLookup();
  }, [cancelPickerLookup, pickerLookup, tab]);

  const updateRootRequestedAmount = useCallback(
    (requestedAmount: number) => {
      const currentRoot = rootRef.current;
      if (!currentRoot || !Number.isFinite(requestedAmount)) return;
      const amount = Math.min(1_000_000_000_000, Math.max(1, Math.floor(requestedAmount)));
      currentRoot.productionPlan = {
        ...currentRoot.productionPlan,
        amount,
        // Legacy saved graphs require this field. Parallel suggestions now target one cycle.
        windowSeconds: currentRoot.productionPlan?.windowSeconds ?? 1,
      };
      bump();
    },
    [bump],
  );

  const openRootPicker = useCallback(
    (direction: GraphDirection) => {
      const currentRoot = rootRef.current;
      if (!currentRoot) return;
      setShowRootActions(false);
      openPickerWithErrorHandling(currentRoot, undefined, direction);
    },
    [openPickerWithErrorHandling],
  );

  const applyOnlyChoice = useCallback(
    async (node: ItemTreeNode, choice: SourceChoice, expansionBudget?: ExpansionBudget) => {
      if (graphDirection === 'outputs') {
        applyChoice(node, choice, {expansionBudget});
        return;
      }
      if (choice.t === 'recipe') {
        const [recipe] = await data.getRecipes([choice.ref]);
        if (
          isRedundantFluidContainerRecipe(recipe, data.itemsByKey) ||
          isFluidContainerTransferRecipe(
            recipe,
            data.itemsByKey,
            data.categories[choice.ref[0]],
          ) ||
          (recipe.stage && hiddenRecipeStages.has(recipe.stage))
        ) {
          await openPicker(node);
          return;
        }
      }
      setPreferredSource(node.key, choice);
      applyPreferredSourceAcrossTree(node, choice, expansionBudget);
    },
    [
      applyChoice,
      applyPreferredSourceAcrossTree,
      data,
      graphDirection,
      hiddenRecipeStages,
      openPicker,
      setPreferredSource,
    ],
  );

  /**
   * Expanding a node follows its remembered recipes downward, and that cascade was unbounded:
   * one tap on a node deep in a pack like GT New Horizons could unfold thousands of nodes at
   * once. Every user-initiated expansion now gets its own budget, measured from that node.
   */
  const budgetFor = useCallback(
    (node: ItemTreeNode) => new ExpansionBudget(undefined, node.ancestors.length),
    [],
  );

  const applyOnlyChoiceWithErrorHandling = useCallback(
    (node: ItemTreeNode, choice: SourceChoice) => {
      void applyOnlyChoice(node, choice, budgetFor(node)).catch(error => {
        console.error('The only recipe source could not be classified and applied.', error);
      });
    },
    [applyOnlyChoice, budgetFor],
  );

  const releaseByproductFulfillmentsFromSubtree = useCallback(
    (removedNode: ItemTreeNode) => {
      releaseByproductFulfillments(rootRef.current, removedNode);
    },
    [],
  );

  const transferDeferredRecipeExpansion = useCallback(
    async (node: ItemTreeNode, expansion: DeferredRecipeExpansion) => {
      const owner = findRecipeExpansionOwner(
        rootRef.current,
        node.key,
        graphDirection,
        expansion,
        node,
      );
      if (!owner) {
        console.error('A deferred recipe node has no expanded owner; expanding it directly.', {
          nodeId: node.id,
          itemKey: node.key,
          recipeRef: expansion.ref,
        });
        node.deferredRecipeExpansion = undefined;
        await applyRecipeChoice(node, {t: 'recipe', ...expansion}, {
          expansionBudget: budgetFor(node),
        });
        return;
      }
      const ownerExpansion = recipeExpansionFromSource(owner.source);
      if (!ownerExpansion) {
        console.error('The expanded recipe owner has no transferable recipe metadata.', {
          ownerNodeId: owner.id,
          targetNodeId: node.id,
        });
        return;
      }

      releaseByproductFulfillmentsFromSubtree(owner);
      owner.source = undefined;
      owner.deferredRecipeExpansion = ownerExpansion;
      node.deferredRecipeExpansion = undefined;
      // Moving the visible occurrence of a recipe must not behave like Fit.
      bump();

      const expanded = await applyRecipeChoice(node, {t: 'recipe', ...expansion}, {
        expansionBudget: budgetFor(node),
      });
      if (expanded && node.source) return;

      console.error('Recipe expansion ownership transfer failed; restoring the previous owner.', {
        ownerNodeId: owner.id,
        targetNodeId: node.id,
        recipeRef: expansion.ref,
      });
      node.deferredRecipeExpansion = expansion;
      owner.deferredRecipeExpansion = undefined;
      const restored = await applyRecipeChoice(owner, {t: 'recipe', ...ownerExpansion}, {
        expansionBudget: budgetFor(owner),
      });
      if (!restored || !owner.source) {
        console.error('The previous recipe expansion owner could not be restored.', {
          ownerNodeId: owner.id,
          recipeRef: ownerExpansion.ref,
        });
      }
    },
    [
      applyRecipeChoice,
      budgetFor,
      bump,
      graphDirection,
      releaseByproductFulfillmentsFromSubtree,
    ],
  );

  /**
   * Expanding or collapsing a node re-lays out the whole tree, and the canvas transform is
   * unchanged, so every other node slides to a new position underneath the user. Pinning the
   * node they touched keeps the tree still around the one thing they were looking at.
   */
  const anchorNodeRef = useRef<{id: string; screenX: number; screenY: number} | null>(null);
  const pinNodePosition = useCallback((node: ItemTreeNode) => {
    const laid = graphRef.current?.nodes.find(candidate => candidate.item.id === node.id);
    if (!laid) {
      anchorNodeRef.current = null;
      return;
    }
    const {x, y, scale} = transformRef.current;
    anchorNodeRef.current = {
      id: node.id,
      screenX: x + (laid.x + laid.w / 2) * scale,
      screenY: y + (laid.y + laid.h / 2) * scale,
    };
  }, []);

  const onItemTap = useCallback(
    (node: ItemTreeNode) => {
      pinNodePosition(node);
      if (node.loading) return;
      if (blockRecursiveExpansion(node, 'tap graph node')) return;
      if (node.deferredRecipeExpansion) {
        void transferDeferredRecipeExpansion(node, node.deferredRecipeExpansion);
        return;
      }
      if (node.source) {
        const collapsedExpansion = recipeExpansionFromSource(node.source);
        if (expandRecipesOnceRef.current && collapsedExpansion) {
          const collapsedIdentity = recipeExpansionIdentity(
            node.key,
            graphDirection,
            collapsedExpansion,
          );
          for (const candidate of deferredRecipeExpansionNodes(rootRef.current)) {
            const deferred = candidate.deferredRecipeExpansion;
            if (
              deferred &&
              recipeExpansionIdentity(candidate.key, graphDirection, deferred) ===
                collapsedIdentity
            ) {
              candidate.deferredRecipeExpansion = undefined;
            }
          }
        }
        releaseByproductFulfillmentsFromSubtree(node);
        // Kept so reopening restores this exact subtree. The byproduct credits released above do
        // not come back with it; they are re-derived from whatever the tree looks like then.
        node.collapsedSource = node.source;
        node.source = undefined;
        bump();
        return;
      }
      if (node.collapsedSource) {
        const restored = node.collapsedSource;
        const expansion = recipeExpansionFromSource(restored);
        // Unique mode may have handed this recipe to another occurrence while it was folded, and
        // restoring it here would leave the same recipe expanded twice.
        const takenOver =
          expandRecipesOnceRef.current &&
          expansion !== null &&
          findRecipeExpansionOwner(
            rootRef.current,
            node.key,
            graphDirection,
            expansion,
            node,
          ) !== null;
        if (!takenOver) {
          node.collapsedSource = undefined;
          node.source = restored;
          bump();
          return;
        }
        node.collapsedSource = undefined;
      }
      const choices = choicesFor(node.key, graphDirection, node.alternatives);
      if (choices.length === 0) {
        const itemName = data.itemsByKey.get(node.key)?.n ?? node.key;
        setExportMessage(
          graphDirection === 'outputs'
            ? `Nothing in this pack uses ${itemName}.`
            : `${itemName} has no recipe in this pack; it has to be gathered.`,
        );
        return;
      }
      const preferred = preferredSourceFor(node.key, node.alternatives);
      if (preferred) {
        applyChoice(node, preferred, {expansionBudget: budgetFor(node)});
      } else if (choices.length === 1) {
        applyOnlyChoiceWithErrorHandling(node, choices[0]);
      } else {
        openPickerWithErrorHandling(node);
      }
    },
    [
      bump,
      applyChoice,
      budgetFor,
      data.itemsByKey,
      pinNodePosition,
      openPickerWithErrorHandling,
      choicesFor,
      preferredSourceFor,
      applyOnlyChoiceWithErrorHandling,
      releaseByproductFulfillmentsFromSubtree,
      transferDeferredRecipeExpansion,
      graphDirection,
    ],
  );

  const collapseNodeRecipe = useCallback(
    (node: ItemTreeNode) => {
      if (node.source) {
        onItemTap(node);
      } else if (node.deferredRecipeExpansion) {
        node.deferredRecipeExpansion = undefined;
        bump();
      }
      setNodeMenu(null);
    },
    [bump, onItemTap],
  );

  /**
   * Discards the tree outright rather than collapsing it back to a bare root: a lone root node
   * left sitting on the canvas is not a cleared workspace, and re-expanding it was one tap away
   * from everything the user just asked to be rid of. Three things have to go together or the
   * tree comes back -- the open tree itself, the saved session that would restore it on the next
   * launch, and the root's remembered base recipe, which is also what reopening that item would
   * silently re-expand. Descendants keep their remembered sources; those are a per-item
   * preference, not part of this workspace.
   */
  const treeIsExpanded = !!root?.source;
  const toggleWholeTree = useCallback(() => {
    const currentRoot = rootRef.current;
    if (!currentRoot) return;
    onItemTap(currentRoot);
  }, [onItemTap]);

  const clearAllExpansions = useCallback(() => {
    const currentRoot = rootRef.current;
    if (currentRoot) {
      if (currentRoot.source) releaseByproductFulfillmentsFromSubtree(currentRoot);
      currentRoot.source = undefined;
      currentRoot.deferredRecipeExpansion = undefined;
      if (preferredSourcesRef.current[currentRoot.key]) {
        // Local-only removal: forgetting the root here is part of clearing this tree, not the user
        // un-favoriting the recipe everywhere (that's unsetNodeRecipe, which also syncs it).
        const next = {...preferredSourcesRef.current};
        delete next[currentRoot.key];
        preferredSourcesRef.current = next;
        persistPreferredSources(data.descriptor, next);
        setPreferredSources(next);
      }
    }
    clearGraphTreeRecipe(treeId);
    clearGraphSession(data.descriptor);
    // Suppresses the persist effect, which would otherwise write this tree straight back out on
    // the render that follows.
    restoringGraphSessionRef.current = true;
    onClose?.();
  }, [
    clearGraphTreeRecipe,
    data.descriptor,
    onClose,
    releaseByproductFulfillmentsFromSubtree,
    treeId,
  ]);

  const unsetNodeRecipe = useCallback(
    (node: ItemTreeNode) => {
      const next = {...preferredSourcesRef.current};
      for (const key of new Set([node.key, ...(node.alternatives ?? [])])) delete next[key];
      preferredSourcesRef.current = next;
      persistPreferredSources(data.descriptor, next);
      setPreferredSources(next);
      for (const key of new Set([node.key, ...(node.alternatives ?? [])])) {
        void updateCommunityRecipeFavorite(data.descriptor, key, null).catch(error => {
          console.error('The cleared recipe favorite could not be synchronized.', {key, error});
        });
      }
      if (node.source) releaseByproductFulfillmentsFromSubtree(node);
      node.source = undefined;
      node.collapsedSource = undefined;
      node.deferredRecipeExpansion = undefined;
      bump();
      setNodeMenu(null);
    },
    [bump, data.descriptor, releaseByproductFulfillmentsFromSubtree],
  );

  const selectNodeAlternative = useCallback(
    (node: ItemTreeNode, selectedKey: string) => {
      if (!node.alternatives?.includes(selectedKey)) {
        console.error('A graph ingredient alternative was not present in its logical slot.', {
          nodeId: node.id,
          selectedKey,
          alternatives: node.alternatives,
        });
        return;
      }
      if (node.source) releaseByproductFulfillmentsFromSubtree(node);
      node.source = undefined;
      node.deferredRecipeExpansion = undefined;
      const parent = parentRecipeSource(rootRef.current, node);
      const selectionKey = node.selectionKey ?? node.alternatives[0];
      if (parent?.kind === 'recipe' && parent.direction !== 'outputs' && parent.recipe) {
        const selections = {
          ...parent.ingredientSelections,
          [selectionKey]: selectedKey,
        };
        parent.ingredientSelections = selections;
        parent.recipe = applyIngredientSelections(parent.recipe, selections);
      }
      node.key = selectedKey;
      node.cyclic = node.ancestors.includes(selectedKey);
      bump();
      setNodeMenu(null);
    },
    [bump, releaseByproductFulfillmentsFromSubtree],
  );

  useEffect(() => setNodeMenu(null), [graphRequestId, tab]);

  useEffect(() => {
    if (graphSessionRestoreAttemptedRef.current) return;
    graphSessionRestoreAttemptedRef.current = true;
    if (recipeImportJob) return;
    const session = loadGraphSession(data.descriptor);
    if (!session) return;
    if (graphRecipeRef) return;
    // A resumed launch already knows which tab the user left off on; only a launch without that
    // memory should be pulled onto the graph just because a saved tree exists.
    const focusRestoredGraph = () => {
      if (!restoredLastTab) setTab('graph');
    };
    if (graphRootKey) {
      if (session.rootKey !== graphRootKey || session.direction !== graphDirection) return;
      pendingGraphSessionRef.current = session;
      restoringGraphSessionRef.current = true;
      focusRestoredGraph();
      return;
    }
    pendingGraphSessionRef.current = session;
    restoringGraphSessionRef.current = true;
    focusRestoredGraph();
    restoreGraph(session.rootKey, session.direction);
  }, [
    data.descriptor,
    graphDirection,
    graphRecipeRef,
    graphRootKey,
    recipeImportJob,
    restoreGraph,
    restoredLastTab,
    setTab,
  ]);

  // (Re)build and refit for every request. The request id is intentionally
  // included so selecting the same item again still resets an off-screen or
  // previously expanded chart.
  useEffect(() => {
    if (!graphRootKey) return;
    const newRoot = makeRoot(graphRootKey);
    rootRef.current = newRoot;
    setRoot(newRoot);
    needsFitRef.current = true;
    const pendingGraphSession = pendingGraphSessionRef.current;
    if (pendingGraphSession) {
      pendingGraphSessionRef.current = null;
      if (
        pendingGraphSession.rootKey !== graphRootKey ||
        pendingGraphSession.direction !== graphDirection
      ) {
        console.error('The saved graph did not match the requested restoration root.', {
          savedRootKey: pendingGraphSession.rootKey,
          graphRootKey,
          savedDirection: pendingGraphSession.direction,
          graphDirection,
        });
        restoringGraphSessionRef.current = false;
        clearGraphSession(data.descriptor);
      } else {
        void restoreExpandedGraph(newRoot, pendingGraphSession);
        return;
      }
    }
    const pendingRootChoice = pendingRootChoiceRef.current;
    if (pendingRootChoice) {
      pendingRootChoiceRef.current = null;
      if (
        pendingRootChoice.key !== graphRootKey ||
        pendingRootChoice.direction !== graphDirection
      ) {
        console.error('A pending root recipe selection did not match the rebuilt graph.', {
          pendingItemKey: pendingRootChoice.key,
          graphRootKey,
          pendingDirection: pendingRootChoice.direction,
          graphDirection,
        });
      } else {
        applyChoice(newRoot, pendingRootChoice.choice, {expansionBudget: budgetFor(newRoot)});
        return;
      }
    }
    if (graphRecipeRef) {
      const requestedChoice: SourceChoice = {
        t: 'recipe',
        ref: graphRecipeRef,
        allowFluidTransfer: true,
      };
      if (graphDirection === 'inputs') {
        setPreferredSource(graphRootKey, requestedChoice);
      }
      applyChoice(newRoot, requestedChoice, {expansionBudget: budgetFor(newRoot)});
      return;
    }
    // An imported tree owns this fresh root. Its selections are resolved and
    // rendered incrementally by the import effect below.
    if (recipeImportJob) return;
    const choices = choicesFor(graphRootKey);
    const preferred = preferredSourceFor(graphRootKey);
    if (preferred) {
      applyChoice(newRoot, preferred, {expansionBudget: budgetFor(newRoot)});
    } else if (choices.length === 1) {
      const onlyChoice = choices[0];
      applyOnlyChoiceWithErrorHandling(newRoot, onlyChoice);
    }
  }, [
    graphRootKey,
    graphRequestId,
    graphRecipeRef,
    graphDirection,
    recipeImportJob,
    applyChoice,
    choicesFor,
    preferredSourceFor,
    data.descriptor,
    restoreExpandedGraph,
    setPreferredSource,
    applyOnlyChoiceWithErrorHandling,
  ]);

  useEffect(() => {
    if (!root || restoringGraphSessionRef.current) return;
    persistGraphSession(data.descriptor, root, graphDirection);
  }, [data.descriptor, graphDirection, root, version]);

  // Recomputed against `version` so a focus survives the branch under it being expanded, and
  // resolves to null the moment its node stops existing rather than blanking the canvas.
  const focus = useMemo(
    () => treeFocus(root, focusNodeId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version tracks in-place tree edits.
    [root, focusNodeId, version],
  );
  const focusVisibleNodeIds = focus?.visibleNodeIds;
  const focusLabel = useMemo(() => {
    const focusedKey = focus?.pathKeys[focus.pathKeys.length - 1];
    if (!focusedKey) return null;
    return data.itemsByKey.get(focusedKey)?.n ?? focusedKey;
  }, [data.itemsByKey, focus]);
  const focusBranch = useCallback((node: ItemTreeNode) => {
    setFocusNodeId(current => (current === node.id ? null : node.id));
    setNodeMenu(null);
    needsFitRef.current = true;
  }, []);
  const clearFocus = useCallback(() => {
    setFocusNodeId(null);
    needsFitRef.current = true;
  }, []);
  // A rebuilt tree issues new node ids, so a focus from the previous one can never match.
  useEffect(() => setFocusNodeId(null), [graphRequestId]);

  const graphLayout = useMemo(() => {
    if (!root) return {graph: null, fallback: null as string | null};
    if (!radialLayout) {
      return {
        graph: layoutTree(root, compactMode, true, showRootActions, focusVisibleNodeIds),
        fallback: null as string | null,
      };
    }
    try {
      return {
        graph: layoutRadialTree(
          root,
          compactMode,
          graphDirection === 'outputs'
            ? item => usagesFor(item.key).length === 0
            : undefined,
          true,
          showRootActions,
          focusVisibleNodeIds,
        ),
        fallback: null as string | null,
      };
    } catch (error) {
      console.error(
        'Radial layout could not place this tree; the standard large-tree layout is being used.',
        error,
      );
      return {
        graph: layoutTree(root, compactMode, true, showRootActions, focusVisibleNodeIds),
        fallback: 'This tree is too complex for Radial placement, so the standard layout is shown.',
      };
    }
  },
    [
      root,
      version,
      compactMode,
      radialLayout,
      focusVisibleNodeIds,
      graphDirection,
      usagesFor,
      showRootActions,
    ],
  );
  const graph = graphLayout.graph;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const openNodeMenu = useCallback(
    (node: ItemTreeNode, pointer?: NodeActionPointer) => {
      const laidNode = graphRef.current?.nodes.find(candidate => candidate.item.id === node.id);
      const currentTransform = transformRef.current;
      let anchor: NodeContextAnchor = laidNode
        ? {
            x: currentTransform.x + (laidNode.x + laidNode.w / 2) * currentTransform.scale,
            y: currentTransform.y + (laidNode.y + laidNode.h / 2) * currentTransform.scale,
          }
        : {
            x: viewportRef.current.w / 2,
            y: viewportRef.current.h / 2,
          };

      if (Platform.OS === 'web' && pointer) {
        const element = wrapRef.current as unknown as HTMLElement | null;
        const rect = element?.getBoundingClientRect?.();
        const clientX = pointer.clientX ?? pointer.pageX;
        const clientY = pointer.clientY ?? pointer.pageY;
        if (rect && Number.isFinite(clientX) && Number.isFinite(clientY)) {
          anchor = {
            x: (clientX as number) - rect.left,
            y: (clientY as number) - rect.top,
          };
        }
      }

      setShowRootActions(false);
      setNodeMenu({node, anchor});
    },
    [],
  );
  const toggleNodeReusable = useCallback(
    (node: ItemTreeNode) => {
      const parent = parentRecipeSource(rootRef.current, node);
      const ref = parent?.kind === 'recipe' ? parent.ref : undefined;
      if (!parent || parent.direction !== 'inputs' || !ref) {
        console.warn('A manual retention override was requested outside a recipe input.', {
          nodeId: node.id,
          itemKey: node.key,
        });
        setNodeMenu(null);
        return;
      }
      const reusable = node.nonConsumed !== true;
      const overrideKey = manualRetentionOverrideKey(ref, node.key);
      const next = {
        ...manualRetentionOverridesRef.current,
        [overrideKey]: reusable,
      };
      manualRetentionOverridesRef.current = next;
      setManualRetentionOverrides(next);
      persistManualRetentionOverrides(data.descriptor, next);
      applyManualRetentionOverrideToTree(rootRef.current, ref, node.key, reusable);
      const category = data.categories[ref[0]];
      console.info('A recipe ingredient retention override was changed.', {
        packSlug: data.descriptor.slug,
        publicationId: data.descriptor.publicationId,
        recipeRef: ref,
        categoryId: category?.id ?? null,
        recipeId: parent.recipe?.id ?? null,
        itemKey: node.key,
        itemName: data.itemsByKey.get(node.key)?.n ?? null,
        reusable,
      });
      setNodeMenu(null);
      bump();
      void reportRecipeRetentionOverride(
        data.descriptor,
        ref,
        node.key,
        reusable,
      ).catch(error => {
        console.error('The manual recipe retention report could not be recorded.', error);
        setExportMessage('Reusable override saved locally; its report could not be sent.');
      });
    },
    [bump, data],
  );
  const treeTotals = useMemo(() => {
    if (!root || graphDirection === 'outputs') {
      return {
        inputs: [],
        prerequisites: [],
        byproductCredits: [],
        byproducts: [],
        requiredByNode: new Map(),
        byproductCoverageByNode: new Map(),
      } as TreeCalculation;
    }
    // A collapsed branch keeps its subtree, so folding one away is a view change rather than a
    // decision to gather that item directly. It matters most at the root, which is the thing being
    // built rather than an ingredient: counting a collapsed root as an input replaced the entire
    // checklist with a single line asking for the item the user is trying to make.
    const rootForTotals =
      !root.source && root.collapsedSource ? {...root, source: root.collapsedSource} : root;
    const totals = calculateTreeTotals(rootForTotals, useByproducts, {
      resolveDeferredRecipeSource: expandRecipesOnce
        ? createDeferredRecipeSourceResolver(root, graphDirection)
        : undefined,
    });
    const byName = (a: TreeTotal, b: TreeTotal) =>
      (data.itemsByKey.get(a.key)?.n ?? a.key).localeCompare(data.itemsByKey.get(b.key)?.n ?? b.key);
    totals.inputs.sort(byName);
    totals.prerequisites.sort(byName);
    totals.byproductCredits.sort(byName);
    totals.byproducts.sort(byName);
    return totals;
  }, [
    root,
    version,
    data.itemsByKey,
    graphDirection,
    useByproducts,
    expandRecipesOnce,
  ]);
  const supplyEdges = useMemo(
    () =>
      graph
        ? byproductSupplyEdges(
            graph.nodes,
            treeTotals.byproductCoverageByNode.values(),
          )
        : [],
    [graph, treeTotals],
  );
  const lowDetailGraph =
    lowDetailEnabled &&
    !exportingTree &&
    shouldUseLowDetailGraph(transform.scale, graph?.nodes.length ?? 0);
  const rasterLowDetailGraph = Platform.OS === 'web' && lowDetailGraph;
  const renderedGraph = useMemo(() => {
    if (!graph) return null;
    if (exportingTree) {
      return {
        nodes: graph.nodes,
        edges: graph.edges,
        supplyEdges,
        culled: false,
      };
    }
    const visible = visibleGraphElements(
      graph,
      cullingTransform,
      viewportSize,
      rasterLowDetailGraph ? 0 : GRAPH_VIEWPORT_OVERSCAN,
      // Kept at every tier: the lines are what make this read as a tree rather than as loose
      // chips, and they are the cheapest thing on the canvas -- a plain rect each.
      true,
    );
    const visibleSupplyEdges = lowDetailGraph
      ? []
      : (visibleGraphElements(
          {...graph, edges: supplyEdges},
          transform,
          viewportSize,
        ).edges as ByproductSupplyEdge[]);
    return {...visible, supplyEdges: visibleSupplyEdges};
  }, [
    cullingTransform,
    exportingTree,
    graph,
    lowDetailGraph,
    rasterLowDetailGraph,
    supplyEdges,
    viewportSize,
  ]);
  const showNodeAmounts = shouldShowNodeAmounts(transform.scale, exportingTree);
  const displayedAmountFor = useCallback(
    (node: ItemTreeNode) =>
      graphDirection === 'outputs'
        ? node.amount === undefined
          ? 1
          : node.amount
        : requiredAmountFor(node, treeTotals),
    [graphDirection, treeTotals],
  );
  const isCollapsedBranch = useCallback(
    (node: ItemTreeNode) =>
      !node.source &&
      !node.deferredRecipeExpansion &&
      node.id !== 'root' &&
      preferredSources[node.key] !== undefined,
    [preferredSources],
  );

  const handleLowDetailNodeTap = useCallback(
    (node: ItemTreeNode) => onItemTap(node),
    [onItemTap],
  );
  const handleLowDetailNodeActions = useCallback(
    (node: ItemTreeNode, pointer?: NodeActionPointer) => openNodeMenu(node, pointer),
    [openNodeMenu],
  );

  const [focusedSourceId, setFocusedSourceId] = useState<string | null>(null);
  const focusByproductProducer = useCallback(
    (sourceId: string) => {
      const laidSource = graphRef.current?.nodes.find(node => node.id === sourceId);
      const viewport = viewportRef.current;
      if (!laidSource || viewport.w <= 0 || viewport.h <= 0) {
        console.error('The byproduct-producing recipe could not be located in the current graph.', {
          sourceId,
        });
        return;
      }
      const scale = transformRef.current.scale;
      applyTransform({
        x: viewport.w / 2 - (laidSource.x + laidSource.w / 2) * scale,
        y: viewport.h / 2 - (laidSource.y + laidSource.h / 2) * scale,
        scale,
      });
      setFocusedSourceId(sourceId);
    },
    [applyTransform],
  );

  const handleCollapsedIngredientTap = useCallback(
    (node: ItemTreeNode, defaultAction: () => void) => {
      if (blockRecursiveExpansion(node, 'tap collapsed ingredient')) return;
      if (node.deferredRecipeExpansion) {
        defaultAction();
        return;
      }
      const coverage = treeTotals.byproductCoverageByNode.get(node.id);
      if (!coverage) {
        defaultAction();
        return;
      }
      if (coverage.remainingAmount > 0) {
        openPickerWithErrorHandling(node, coverage);
        return;
      }
      const producer = [...coverage.allocations].sort(
        (left, right) => right.amount - left.amount,
      )[0];
      if (!producer) {
        console.error('A completed byproduct ingredient has no producing recipe allocation.', {
          nodeId: node.id,
          itemKey: node.key,
        });
        return;
      }
      focusByproductProducer(producer.producerSourceId);
    },
    [focusByproductProducer, openPickerWithErrorHandling, treeTotals],
  );

  const handleCompactNodeTap = useCallback(
    (node: ItemTreeNode, radial = false) => {
      if (node.id === 'root') {
        onItemTap(node);
        return;
      }
      handleCollapsedIngredientTap(node, () =>
        node.deferredRecipeExpansion || radial
          ? onItemTap(node)
          : openPickerWithErrorHandling(node),
      );
    },
    [handleCollapsedIngredientTap, onItemTap, openPickerWithErrorHandling],
  );
  const handleItemNodeTap = useCallback(
    (node: ItemTreeNode) => {
      if (node.id === 'root') {
        onItemTap(node);
        return;
      }
      handleCollapsedIngredientTap(node, () => onItemTap(node));
    },
    [handleCollapsedIngredientTap, onItemTap],
  );
  const handleNodeInfo = useCallback(
    (node: ItemTreeNode) => openItem(node.key),
    [openItem],
  );
  const handleNodeSwap = useCallback(
    (node: ItemTreeNode) => openPickerWithErrorHandling(node),
    [openPickerWithErrorHandling],
  );

  const handleTreeTotalIngredientTap = useCallback(
    (total: TreeTotal, kind: TreeTotalTargetKind) => {
      const node = findTreeTotalTarget(rootRef.current, total, kind);
      if (!node) {
        console.error('A tree-total ingredient could not be resolved to a graph node.', {
          itemKey: total.key,
          tag: total.tag,
          totalKind: kind,
        });
        return;
      }
      handleCollapsedIngredientTap(node, () => {
        if (compactMode && !radialLayout) {
          openPickerWithErrorHandling(node);
          return;
        }
        onItemTap(node);
      });
    },
    [
      compactMode,
      handleCollapsedIngredientTap,
      onItemTap,
      openPickerWithErrorHandling,
      radialLayout,
    ],
  );

  const rootExportName = useMemo(
    () => {
      const rootKey = root?.key ?? 'recipe-tree';
      return safeExportFilename(data.itemsByKey.get(rootKey)?.n ?? rootKey);
    },
    [data.itemsByKey, root?.key],
  );

  const portableTreeJson = useCallback(async () => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('There is no recipe tree to share.');
    const session = serializeGraphSession(currentRoot, graphDirection);
    const recipeRefs = session.selections
      .filter(selection => selection.source.kind === 'recipe')
      .map(selection => selection.source.kind === 'recipe' ? selection.source.ref : null)
      .filter((ref): ref is RecipeRef => ref !== null);
    const uniqueRefs = [...new Map(recipeRefs.map(ref => [ref.join(':'), ref])).values()];
    const recipes = await data.getRecipes(uniqueRefs);
    const recipeKeys = new Map<string, string>();
    uniqueRefs.forEach((ref, index) => {
      const category = data.categories[ref[0]];
      const recipe = recipes[index];
      if (!category || !recipe?.id) return;
      recipeKeys.set(ref.join(':'), `${category.id}|${recipe.id}`);
    });
    return JSON.stringify(
      buildPortableTree(session, data.descriptor, recipeKeys),
      null,
      2,
    );
  }, [data, graphDirection]);

  const shareCurrentTree = useCallback(async () => {
    const json = await portableTreeJson();
    return sharePortableTree(`${rootExportName}-tree.mrtree.json`, json);
  }, [portableTreeJson, rootExportName]);

  const importPortableTree = useCallback(async (raw: string) => {
    const share = parsePortableTree(raw);
    assertPortableTreePackMatches(share, data.descriptor);
    if (!data.itemsByKey.has(share.rootKey)) {
      throw new Error('The shared starting item is not available in the selected modpack.');
    }
    setShowTreeShare(false);
    onRecipeImportRequestHandled?.();
    onRecipeImportStart(raw);
    setTab('graph');
    restoreGraph(share.rootKey, share.direction);
  }, [
    data.descriptor,
    data.itemsByKey,
    onRecipeImportRequestHandled,
    onRecipeImportStart,
    restoreGraph,
    setTab,
  ]);

  const restorePortableTreeIncrementally = useCallback(
    async (raw: string, newRoot: ItemTreeNode) => {
      const share = parsePortableTree(raw);
      assertPortableTreePackMatches(share, data.descriptor);
      if (share.rootKey !== newRoot.key || share.direction !== graphDirection) {
        throw new Error('The imported crafting tree does not match the active graph root.');
      }
      newRoot.productionPlan = share.productionPlan
        ? {...share.productionPlan}
        : undefined;
      const restoredSelections: StoredGraphSelection[] = [];
      const restoredNodesByPath = new Map<string, ItemTreeNode>();
      const saveProgress = () => {
        persistGraphSessionSnapshot(data.descriptor, {
          version: 2,
          rootKey: share.rootKey,
          direction: share.direction,
          ...(share.productionPlan ? {productionPlan: {...share.productionPlan}} : {}),
          selections: [...restoredSelections],
        });
      };
      saveProgress();

      const recipeRefCache = new Map<string, RecipeRef>();
      const resolveRecipeRef = async (selection: PortableTreeSelection): Promise<RecipeRef> => {
        if (selection.source.kind !== 'recipe') {
          throw new Error('Only recipe sources have recipe references.');
        }
        const recipeSource = selection.source;
        const cacheKey = `${selection.itemKey}\n${recipeSource.recipeKey}`;
        const cached = recipeRefCache.get(cacheKey);
        if (cached) return [...cached];
        const candidates = choicesFor(selection.itemKey, share.direction)
          .filter((choice): choice is RecipeSourceChoice => choice.t === 'recipe');
        const ordered = recipeSource.ref
          ? [
              ...candidates.filter(choice =>
                choice.ref[0] === recipeSource.ref?.[0] &&
                choice.ref[1] === recipeSource.ref?.[1],
              ),
              ...candidates.filter(choice =>
                choice.ref[0] !== recipeSource.ref?.[0] ||
                choice.ref[1] !== recipeSource.ref?.[1],
              ),
            ]
          : candidates;
        const recipes = await data.getRecipes(ordered.map(choice => choice.ref));
        for (let index = 0; index < ordered.length; index += 1) {
          const candidate = ordered[index];
          const category = data.categories[candidate.ref[0]];
          const recipe = recipes[index];
          if (!category || !recipe) continue;
          if (await portableRecipeMatchesKey(category.id, recipe, recipeSource.recipeKey)) {
            recipeRefCache.set(cacheKey, candidate.ref);
            return [...candidate.ref];
          }
        }
        throw new Error(
          `Recipe ${recipeSource.recipeKey} for ${selection.itemKey} is unavailable in this modpack.`,
        );
      };

      const resolution = await resolveConnectedPortableSelections(
        share.selections,
        async selection => {
          let stored: StoredGraphSelection;
          if (selection.source.kind === 'recipe') {
            stored = portableSelectionAsStored(
              selection,
              await resolveRecipeRef(selection),
            );
          } else {
            stored = portableSelectionAsStored(selection);
          }

          const node = nodeForStoredSelection(
            newRoot,
            stored,
            restoredNodesByPath,
          );
          if (isRecursiveItemNode(node)) {
            throw new Error(
              `Imported tree tries to expand recursive item ${JSON.stringify(node.key)}.`,
            );
          }
          if (stored.source.kind === 'recipe') {
            if (stored.deferred) {
              node.deferredRecipeExpansion = {
                ref: [...stored.source.ref],
                ...(stored.source.allowFluidTransfer
                  ? {allowFluidTransfer: true as const}
                  : {}),
                ...(stored.source.ingredientSelections
                  ? {ingredientSelections: {...stored.source.ingredientSelections}}
                  : {}),
              };
              bump();
            } else {
              const expanded = await expandRecipe(node, stored.source.ref, {
                allowFluidTransfer: stored.source.allowFluidTransfer === true,
                ingredientSelections: stored.source.ingredientSelections,
                expandPreferredChildren: false,
                recordHistory: false,
              });
              if (!expanded) {
                throw new Error(
                  `Imported recipe ${stored.source.ref.join(':')} could not be reconstructed.`,
                );
              }
            }
          } else {
            const storedSource = stored.source;
            const sourceChoice = choicesFor(node.key, share.direction).find(choice =>
              storedSource.kind === 'mob'
                ? choice.t === 'mob' && choice.mob.id === storedSource.mobId
                : choice.t === 'block' && choice.blockKey === storedSource.blockKey,
            );
            if (!sourceChoice) {
              throw new Error(
                `Imported ${storedSource.kind} source for ${JSON.stringify(node.key)} is unavailable.`,
              );
            }
            applyChoice(node, sourceChoice);
          }
          const pathKey = stored.path.join('.');
          restoredNodesByPath.set(pathKey, node);
          restoredSelections.push(stored);
          saveProgress();
          return stored;
        },
      );
      const unavailableSelections = resolution.skipped.filter(
        skipped => skipped.reason === 'unavailable',
      );
      const dependentSelections = resolution.skipped.filter(
        skipped => skipped.reason === 'dependent',
      );
      const duplicateSelections = resolution.skipped.filter(
        skipped => skipped.reason === 'duplicate',
      );
      if (resolution.skipped.length > 0) {
        console.warn('A shared recipe tree was opened partially.', {
          restoredSelections: resolution.selections.length,
          unavailableSelections: unavailableSelections.map(skipped => ({
            path: skipped.selection.path,
            itemKey: skipped.selection.itemKey,
            source: skipped.selection.source,
            error:
              skipped.error instanceof Error
                ? skipped.error.message
                : String(skipped.error),
          })),
          dependentSelectionCount: dependentSelections.length,
          duplicateSelectionCount: duplicateSelections.length,
        });
      }
      onRecipeImportReportChange?.(
        resolution.skipped.length === 0
          ? null
          : {
              restoredCount: resolution.selections.length,
              details: resolution.skipped.map(skipped => {
                const source = skipped.selection.source;
                const unavailableMessage =
                  skipped.error instanceof Error
                    ? skipped.error.message
                    : skipped.error === undefined
                      ? null
                      : String(skipped.error);
                return {
                  path: [...skipped.selection.path],
                  itemKey: skipped.selection.itemKey,
                  itemName:
                    data.itemsByKey.get(skipped.selection.itemKey)?.n ??
                    skipped.selection.itemKey,
                  ...(source.kind === 'recipe' ? {recipeKey: source.recipeKey} : {}),
                  reason: skipped.reason,
                  message:
                    unavailableMessage ??
                    (skipped.reason === 'dependent'
                      ? 'This selection depends on a parent recipe that could not be restored.'
                      : 'Another selection already uses this exact tree path.'),
                };
              }),
            },
      );
      setShowRecipeImportDetails(false);
      setExportMessage(
        resolution.skipped.length === 0
          ? 'Crafting tree imported.'
          : `Opened partial tree: ${resolution.selections.length} selections restored; ` +
              `${unavailableSelections.length} unavailable and ` +
              `${dependentSelections.length + duplicateSelections.length} disconnected selections skipped.`,
      );
      onRecipeImportNoticeChange?.(
        resolution.skipped.length === 0
          ? null
          : `${resolution.selections.length} selections were restored. ` +
              `${unavailableSelections.length} unavailable and ` +
              `${dependentSelections.length + duplicateSelections.length} dependent selections were skipped.`,
      );
      needsFitRef.current = true;
    },
    [
      applyChoice,
      bump,
      choicesFor,
      data,
      expandRecipe,
      graphDirection,
      onRecipeImportNoticeChange,
      onRecipeImportReportChange,
    ],
  );

  useEffect(() => {
    if (!recipeImportJob || !root) return;
    if (recipeImportRestoreAttemptedRef.current === recipeImportJob.id) return;
    recipeImportRestoreAttemptedRef.current = recipeImportJob.id;
    restoringGraphSessionRef.current = true;
    void restorePortableTreeIncrementally(recipeImportJob.raw, root)
      .catch(error => {
        console.error('The imported crafting tree could not be reconstructed.', error);
        const message =
          error instanceof Error
            ? error.message
            : 'The imported crafting tree could not be reconstructed.';
        setExportMessage(message);
        onRecipeImportNoticeChange?.(message);
      })
      .finally(() => {
        restoringGraphSessionRef.current = false;
        bump();
        onRecipeImportComplete();
      });
  }, [
    bump,
    onRecipeImportComplete,
    onRecipeImportNoticeChange,
    recipeImportJob,
    restorePortableTreeIncrementally,
    root,
  ]);

  const closeTreeShare = useCallback(() => {
    setShowTreeShare(false);
    if (treeTransferMode === 'import') onRecipeImportRequestHandled?.();
  }, [onRecipeImportRequestHandled, treeTransferMode]);

  const exportTotals = useCallback(() => {
    try {
      const csv = buildTreeTotalsCsv(treeTotals, (key, tag) =>
        displayIngredientName(
          data.itemsByKey.get(key)?.n ?? key,
          tag,
          data.descriptor.minecraftVersion,
        ),
      );
      downloadBlob(
        `${rootExportName}-resources.csv`,
        new Blob([csv], {type: 'text/csv;charset=utf-8'}),
      );
      setExportMessage('Resource list exported.');
    } catch (error) {
      console.error('Tree resource-list export failed.', error);
      setExportMessage(error instanceof Error ? error.message : 'Resource-list export failed.');
    }
  }, [
    data.descriptor.minecraftVersion,
    data.itemsByKey,
    rootExportName,
    treeTotals,
  ]);

  const exportTreeImage = useCallback(async () => {
    if (Platform.OS !== 'web') {
      const message = 'High-quality tree export is currently available in the web viewer.';
      console.error(message);
      setExportMessage(message);
      return;
    }
    const source = anchorRef.current as unknown as HTMLElement | null;
    const currentGraph = graphRef.current;
    if (!source || !currentGraph) {
      const message = 'The tree export surface is not ready.';
      console.error(message);
      setExportMessage(message);
      return;
    }

    setExportingTree(true);
    setExportMessage('Rendering high-quality PNG…');
    try {
      const width = Math.ceil(currentGraph.maxX - currentGraph.minX + GRAPH_EXPORT_PADDING * 2);
      const height = Math.ceil(currentGraph.maxY - currentGraph.minY + GRAPH_EXPORT_PADDING * 2);
      const {renderTiledPng} = await import('./tiledPng');
      const result = await renderTiledPng({
        source,
        logicalWidth: width,
        logicalHeight: height,
        sourceLeft: GRAPH_EXPORT_PADDING - currentGraph.minX,
        sourceTop: GRAPH_EXPORT_PADDING - currentGraph.minY,
        requestedScale: GRAPH_EXPORT_PIXEL_RATIO,
        backgroundColor: theme.bg,
        onProgress: (completedTiles, totalTiles) => {
          setExportMessage(`Rendering PNG tile ${completedTiles} of ${totalTiles}…`);
        },
      });
      if (result.plan.scale < GRAPH_EXPORT_PIXEL_RATIO) {
        console.warn('Tree PNG resolution was capped by the tiled export safety budget.', {
          requestedScale: GRAPH_EXPORT_PIXEL_RATIO,
          appliedScale: result.plan.scale,
          outputWidth: result.plan.outputWidth,
          outputHeight: result.plan.outputHeight,
          outputPixels: result.plan.outputPixels,
          tiles: result.plan.totalTiles,
        });
      }
      downloadBlob(`${rootExportName}-tree.png`, result.blob);
      setExportMessage(
        `Tree exported at ${result.plan.scale}× resolution using ` +
          `${result.plan.totalTiles} ${result.plan.totalTiles === 1 ? 'tile' : 'tiles'}.`,
      );
    } catch (error) {
      console.error('High-quality tree PNG export failed.', error);
      setExportMessage(error instanceof Error ? error.message : 'Tree PNG export failed.');
    } finally {
      setExportingTree(false);
    }
  }, [rootExportName]);

  /** @returns false when the viewport isn't measurable yet (hidden tab) */
  const fitView = useCallback(() => {
    const g = graphRef.current;
    const vp = viewportRef.current;
    if (!g || vp.w === 0 || vp.h === 0) return false;
    const bw = Math.max(60, g.maxX - g.minX);
    const bh = Math.max(60, g.maxY - g.minY);
    const scale = automaticGraphFitScale(vp.w, vp.h, bw, bh);
    applyTransform({
      x: vp.w / 2 - (g.minX + bw / 2) * scale,
      y: vp.h / 2 - (g.minY + bh / 2) * scale,
      scale,
    });
    return true;
  }, [applyTransform]);

  useEffect(() => {
    if (needsFitRef.current && fitView()) {
      needsFitRef.current = false;
      anchorNodeRef.current = null;
      return;
    }
    // Runs after the relayout the tap caused: shift the canvas by however far the pinned node
    // moved, so it ends up back under the finger and the rest of the tree moves around it.
    const pinned = anchorNodeRef.current;
    anchorNodeRef.current = null;
    if (!pinned || !graph) return;
    const laid = graph.nodes.find(candidate => candidate.item.id === pinned.id);
    if (!laid) return;
    const current = transformRef.current;
    const nextX = pinned.screenX - (laid.x + laid.w / 2) * current.scale;
    const nextY = pinned.screenY - (laid.y + laid.h / 2) * current.scale;
    if (Math.abs(nextX - current.x) < 0.5 && Math.abs(nextY - current.y) < 0.5) return;
    applyTransform({...current, x: nextX, y: nextY});
  }, [applyTransform, graph, fitView]);

  const recenterOnGraphPoint = useCallback(
    (graphPoint: {x: number; y: number}) => {
      const vp = viewportRef.current;
      if (vp.w === 0 || vp.h === 0) return;
      applyTransform(transformCenteredOn(graphPoint, transformRef.current, vp));
    },
    [applyTransform],
  );
  // Stable identity, or the memo on the overview cannot hold across a pan.
  // graphMenuScaleStyle itself is declared past the empty-tree return, so the same zoom is
  // derived here rather than referenced.
  const minimapStyle = useMemo(
    () =>
      [
        styles.minimap,
        Platform.OS === 'web' ? ({zoom: interfaceZoom} as unknown as object) : null,
      ] as unknown as object,
    [interfaceZoom],
  );
  const minimapVisible = useMemo(
    () => (graph ? shouldShowMinimap(graph, viewportSize, transform) : false),
    [graph, transform, viewportSize],
  );
  // The bottom notices span to the right edge, which is exactly where the overview sits.
  const bottomNoticeStyle = useMemo(
    () =>
      minimapVisible
        ? {right: CANVAS_EDGE_INSET + MINIMAP_MAX_WIDTH + 8}
        : null,
    [minimapVisible],
  );

  // Wheel and pinch both arrive as a stream rather than as single events, so they coalesce the
  // same way a drag does.
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const current = transformRef.current;
    const scale = Math.min(4, Math.max(0.12, current.scale * factor));
    const k = scale / current.scale;
    scheduleTransform({
      x: px - (px - current.x) * k,
      y: py - (py - current.y) * k,
      scale,
    });
  }, [scheduleTransform]);

  const toggleLowDetail = useCallback(() => {
    setLowDetailEnabled(current => {
      const next = !current;
      try {
        const storage = globalThis.localStorage;
        if (storage) storage.setItem(LOW_DETAIL_KEY, next ? '1' : '0');
        else if (Platform.OS === 'web') {
          console.warn('Low-detail mode is using memory only because localStorage is unavailable.');
        }
      } catch (error) {
        console.error('Low-detail preference could not be saved to localStorage.', error);
      }
      return next;
    });
  }, []);

  const toggleCompactMode = useCallback(() => {
    setCompactMode(current => {
      const next = !current;
      needsFitRef.current = true;
      try {
        const storage = globalThis.localStorage;
        if (storage) storage.setItem(COMPACT_MODE_KEY, next ? '1' : '0');
        else if (Platform.OS === 'web') {
          console.warn('Compact graph mode is using memory only because localStorage is unavailable.');
        }
      } catch (error) {
        console.error('Compact graph mode could not be saved to localStorage.', error);
      }
      return next;
    });
  }, []);

  const toggleRadialLayout = useCallback(() => {
    setRadialLayout(current => {
      const next = !current;
      needsFitRef.current = true;
      try {
        const storage = globalThis.localStorage;
        if (storage) storage.setItem(RADIAL_LAYOUT_KEY, next ? '1' : '0');
        else if (Platform.OS === 'web') {
          console.warn('Radial graph layout is using memory only because localStorage is unavailable.');
        }
      } catch (error) {
        console.error('Radial graph layout could not be saved to localStorage.', error);
      }
      return next;
    });
  }, []);

  const updateExpandRecipesOnce = useCallback(
    (value: boolean, persistPreference = true) => {
      expandRecipesOnceRef.current = value;
      setExpandRecipesOnce(value);
      needsFitRef.current = true;
      if (persistPreference) {
        try {
          const storage = globalThis.localStorage;
          if (storage) storage.setItem(EXPAND_RECIPES_ONCE_KEY, value ? '1' : '0');
          else if (Platform.OS === 'web') {
            console.warn('Expand-once graph mode is using memory only because localStorage is unavailable.');
          }
        } catch (error) {
          console.error('Expand-once graph preference could not be saved to localStorage.', error);
        }
      }

      if (value) {
        const currentRoot = rootRef.current;
        const duplicates = duplicateRecipeExpansions(currentRoot, graphDirection);
        for (const {node, expansion} of duplicates) {
          releaseByproductFulfillments(currentRoot, node);
          node.source = undefined;
          node.deferredRecipeExpansion = expansion;
        }
      } else {
        for (const node of deferredRecipeExpansionNodes(rootRef.current)) {
          const expansion = node.deferredRecipeExpansion;
          if (!expansion) continue;
          node.deferredRecipeExpansion = undefined;
          // Turning Unique off asks for the duplicates themselves, not for a deep cascade under
          // every one of them, so each still expands within its own budget.
          void applyRecipeChoice(node, {t: 'recipe', ...expansion}, {
            expansionBudget: budgetFor(node),
          });
        }
      }
      bump();
    },
    [applyRecipeChoice, bump, graphDirection],
  );

  const toggleCommunityAutoExpand = useCallback(async () => {
    if (graphDirection !== 'inputs') return;
    if (communityAutoExpandLoading) {
      communityFavoriteRequestRef.current += 1;
      communityAutoExpandRef.current = false;
      communityPreferredSourcesRef.current = {};
      setCommunityAutoExpand(false);
      setCommunityAutoExpandLoading(false);
      bump();
      return;
    }
    if (communityAutoExpandRef.current) {
      communityFavoriteRequestRef.current += 1;
      communityAutoExpandRef.current = false;
      communityPreferredSourcesRef.current = {};
      setCommunityAutoExpand(false);
      bump();
      return;
    }

    const requestId = communityFavoriteRequestRef.current + 1;
    communityFavoriteRequestRef.current = requestId;
    setCommunityAutoExpandLoading(true);
    try {
      const favorites = await loadCommunityRecipeFavorites(data.descriptor);
      if (communityFavoriteRequestRef.current !== requestId) return;
      const communitySources: PreferredSources = {};
      for (const favorite of favorites) {
        // The API guarantees at least one favorite. Validate again at the point
        // where aggregate data can affect the graph, and ignore stale recipe refs.
        if (favorite.count < 1) continue;
        const exists = (data.index[favorite.itemKey]?.p ?? []).some(
          ref =>
            ref[0] === favorite.recipeRef[0] &&
            ref[1] === favorite.recipeRef[1] &&
            !data.metaCategories.has(ref[0]) &&
            !isDefaultDisabledRecipeCategory(data.categories[ref[0]]),
        );
        if (exists) communitySources[favorite.itemKey] = {t: 'recipe', ref: favorite.recipeRef};
      }
      if (Object.keys(communitySources).length === 0) {
        setExportMessage('No community recipe favorites are available for this pack version yet.');
        return;
      }
      console.info('Community favorites are ready for automatic expansion.', {
        packSlug: data.descriptor.slug,
        publicationId: data.descriptor.publicationId,
        receivedFavoriteCount: favorites.length,
        availableFavoriteCount: Object.keys(communitySources).length,
      });
      communityPreferredSourcesRef.current = communitySources;
      communityAutoExpandRef.current = true;
      setCommunityAutoExpand(true);

      const currentRoot = rootRef.current;
      let expandedNodes: ItemTreeNode[] = [];
      if (currentRoot) {
        expandedNodes = await autoExpandPreferredNodes(
          currentRoot,
          node => preferredSourceFor(node.key),
          async (node, preferred) => {
            if (preferred.t === 'recipe') {
              await applyRecipeChoice(node, preferred, {
                expandPreferredChildren: false,
                renderUpdates: false,
                recordHistory: false,
              });
              return;
            }
            applyChoice(node, preferred, {renderUpdates: false});
          },
          {
            batchSize: AUTO_EXPAND_BATCH_SIZE,
            // Nothing is favourited for this item, by the user or anyone else, so the run asks
            // rather than walking past it and reporting a tree it quietly declined to fill in.
            resolveMissingSource: async node => {
              if (
                communityFavoriteRequestRef.current !== requestId ||
                !communityAutoExpandRef.current
              ) {
                return false;
              }
              bump();
              return requestSourceChoice(node);
            },
            shouldContinue: () =>
              communityFavoriteRequestRef.current === requestId &&
              communityAutoExpandRef.current,
            onBatch: async () => {
              if (communityFavoriteRequestRef.current !== requestId) return;
              bump();
              await waitForAutoExpandBatch();
            },
          },
        );
      }
      if (communityFavoriteRequestRef.current !== requestId) return;
      const groupedEntries = new Map<string, AutoExpandSummaryEntry>();
      for (const node of expandedNodes) {
        const source = node.source;
        if (source?.kind !== 'recipe' || !source.ref) continue;
        const id = `${node.key}|${source.ref[0]}:${source.ref[1]}`;
        const existing = groupedEntries.get(id);
        if (existing) {
          existing.count += 1;
          continue;
        }
        groupedEntries.set(id, {
          id,
          itemName: displayIngredientName(
            data.itemsByKey.get(node.key)?.n ?? node.key,
            node.tag,
            data.descriptor.minecraftVersion,
          ),
          recipeTitle: source.catTitle ?? source.recipe?.id ?? `Recipe ${source.ref.join(':')}`,
          count: 1,
        });
      }
      setAutoExpandSummary([...groupedEntries.values()]);
      if (expandedNodes.length === 0) {
        setExportMessage(
          'Auto expand is on. No unexpanded nodes in this tree currently match a community favorite.',
        );
      }
      bump();
    } catch (error) {
      console.error('Community recipe favorites could not be loaded for auto expand.', error);
      setExportMessage('Community favorites could not be loaded.');
    } finally {
      if (communityFavoriteRequestRef.current === requestId) {
        setCommunityAutoExpandLoading(false);
      }
    }
  }, [
    applyChoice,
    applyRecipeChoice,
    bump,
    communityAutoExpandLoading,
    data.categories,
    data.descriptor,
    data.index,
    data.itemsByKey,
    data.metaCategories,
    graphDirection,
    preferredSourceFor,
    requestSourceChoice,
  ]);

  const updateUseByproducts = useCallback((value: boolean) => {
    setUseByproducts(value);
    try {
      const storage = globalThis.localStorage;
      if (storage) storage.setItem(USE_BYPRODUCTS_KEY, value ? '1' : '0');
      else if (Platform.OS === 'web') {
        console.warn('Byproduct-credit preference is using memory only because localStorage is unavailable.');
      }
    } catch (error) {
      console.error('Byproduct-credit preference could not be saved to localStorage.', error);
    }
  }, []);

  const {publish: publishGraphTotals} = useGraphTotals();
  const resourceTapHandlerRef = useRef((total: TreeTotal) => {
    handleTreeTotalIngredientTap(total, 'input');
  });
  resourceTapHandlerRef.current = total => handleTreeTotalIngredientTap(total, 'input');
  const onResourceTap = useCallback((total: TreeTotal) => {
    resourceTapHandlerRef.current(total);
  }, []);
  useEffect(() => {
    if (!isActive || !graphRootKey) return undefined;
    publishGraphTotals({
      rootKey: graphRootKey,
      // The production plan is edited in place, so version is what tells this it moved.
      rootAmount: root?.productionPlan?.amount ?? root?.amount ?? 1,
      totals: treeTotals,
      root,
      version,
      visibleNodeIds: focusVisibleNodeIds,
      onToggleNode: onItemTap,
      onToggleReusable: toggleNodeReusable,
      useByproducts,
      onUseByproductsChange: updateUseByproducts,
      onResourceTap,
      onExportCsv: exportTotals,
      lookupPending: pickerLookup !== null,
    });
    // Left published on unmount rather than cleared: clearing races the next tree's publish and
    // would blank the resources tab while switching between open trees.
    return undefined;
  }, [
    exportTotals,
    focusVisibleNodeIds,
    graphRootKey,
    isActive,
    onItemTap,
    onResourceTap,
    pickerLookup,
    toggleNodeReusable,
    publishGraphTotals,
    root,
    treeTotals,
    updateUseByproducts,
    useByproducts,
    version,
  ]);


  // Native web listeners handle browser behaviors that React Native Web's
  // responder and inherited userSelect style do not consistently suppress in Safari.
  // The canvas mounts/unmounts with the empty state, so attach via callback ref.
  const canvasCleanup = useRef<(() => void) | null>(null);
  const setCanvasRef = useCallback(
    (view: View | null) => {
      wrapRef.current = view;
      canvasCleanup.current?.();
      canvasCleanup.current = null;
      const el = view as unknown as HTMLElement | null;
      if (el && typeof el.addEventListener === 'function') {
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const rect = el.getBoundingClientRect();
          const viewport = viewportRef.current;
          if (viewport.w <= 0 || viewport.h <= 0) {
            console.error('Graph wheel zoom was ignored because the viewport is not measurable.', {
              viewport,
            });
            return;
          }
          const point = graphViewportPointFromClient(
            e.clientX,
            e.clientY,
            rect,
            {width: viewport.w, height: viewport.h},
          );
          zoomAt(point.x, point.y, graphWheelZoomFactor(e.deltaY, e.deltaMode));
        };
        const preventNativeDrag = (e: Event) => e.preventDefault();
        const preventPagePinch = (event: Event) => {
          const touchEvent = event as TouchEvent;
          if (!touchEvent.touches || touchEvent.touches.length >= 2) {
            event.preventDefault();
          }
        };

        // Safari can begin text selection before PanResponder crosses its movement
        // threshold. Capture selection and image-drag events at the canvas boundary.
        el.style.setProperty('user-select', 'none');
        el.style.setProperty('-webkit-user-select', 'none');
        el.style.setProperty('touch-action', 'none');
        el.style.setProperty('overscroll-behavior', 'contain');
        el.addEventListener('wheel', onWheel, {passive: false});
        el.addEventListener('touchstart', preventPagePinch, {passive: false});
        el.addEventListener('touchmove', preventPagePinch, {passive: false});
        el.addEventListener('gesturestart', preventNativeDrag, {passive: false});
        el.addEventListener('gesturechange', preventNativeDrag, {passive: false});
        el.addEventListener('selectstart', preventNativeDrag, true);
        el.addEventListener('dragstart', preventNativeDrag, true);
        canvasCleanup.current = () => {
          el.removeEventListener('wheel', onWheel);
          el.removeEventListener('touchstart', preventPagePinch);
          el.removeEventListener('touchmove', preventPagePinch);
          el.removeEventListener('gesturestart', preventNativeDrag);
          el.removeEventListener('gesturechange', preventNativeDrag);
          el.removeEventListener('selectstart', preventNativeDrag, true);
          el.removeEventListener('dragstart', preventNativeDrag, true);
        };
      } else if (Platform.OS === 'web' && view) {
        console.warn('Graph canvas could not attach native pan-suppression listeners.');
      }
    },
    [zoomAt],
  );

  // Drag to pan, two-finger pinch to zoom.
  const panOrigin = useRef<PanGestureOrigin | null>(null);
  const pinchDist = useRef(0);
  const pinching = useRef(false);
  const clearWebSelection = useCallback(() => {
    if (Platform.OS !== 'web') return;
    try {
      globalThis.getSelection?.()?.removeAllRanges();
    } catch (error) {
      console.warn('Graph canvas could not clear the active browser selection.', error);
    }
  }, []);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: event => event.nativeEvent.touches?.length === 2,
        onStartShouldSetPanResponderCapture: event => event.nativeEvent.touches?.length === 2,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) + Math.abs(g.dy) > 6 || g.numberActiveTouches === 2,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) + Math.abs(g.dy) > 6 || g.numberActiveTouches === 2,
        onPanResponderGrant: (_event, gesture) => {
          clearWebSelection();
          onSwipeSuppressChange?.(true);
          panOrigin.current = capturePanGestureOrigin(
            transformRef.current,
            gesture.dx,
            gesture.dy,
          );
          pinchDist.current = 0;
          pinching.current = false;
        },
        onPanResponderMove: (e, g) => {
          const touches = e.nativeEvent.touches;
          if (touches && touches.length === 2) {
            const dx = touches[0].pageX - touches[1].pageX;
            const dy = touches[0].pageY - touches[1].pageY;
            const dist = Math.hypot(dx, dy);
            if (pinchDist.current > 0) {
              const cx = (touches[0].locationX + touches[1].locationX) / 2;
              const cy = (touches[0].locationY + touches[1].locationY) / 2;
              zoomAt(cx, cy, graphPinchZoomFactor(dist, pinchDist.current));
            }
            pinchDist.current = dist;
            pinching.current = true;
            return;
          }
          pinchDist.current = 0;
          if (pinching.current) {
            // PanResponder's dx/dy continue across the entire gesture. Rebase
            // after a pinch so lifting one finger cannot snap back to the old origin.
            pinching.current = false;
            panOrigin.current = capturePanGestureOrigin(transformRef.current, g.dx, g.dy);
            return;
          }
          if (!panOrigin.current) {
            console.error('Graph pan received movement without a gesture origin.');
            return;
          }
          scheduleTransform(transformForPanGesture(panOrigin.current, g.dx, g.dy));
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          panOrigin.current = null;
          pinchDist.current = 0;
          pinching.current = false;
          onSwipeSuppressChange?.(false);
        },
        onPanResponderTerminate: () => {
          panOrigin.current = null;
          pinchDist.current = 0;
          pinching.current = false;
          onSwipeSuppressChange?.(false);
        },
      }),
    [applyTransform, clearWebSelection, onSwipeSuppressChange, zoomAt],
  );

  const treeShareModal = (
    <TreeShareModal
      visible={showTreeShare}
      mode={treeTransferMode}
      interfaceZoom={interfaceZoom}
      onClose={closeTreeShare}
      onShare={shareCurrentTree}
      onImport={importPortableTree}
      onChooseFile={pickPortableTreeFile}
    />
  );

  // Declared above the empty-tree return below: a hook after a conditional return runs only
  // on the renders that get past it, which React reports as rendering more hooks than the
  // previous render and refuses to draw.
  const graphSettingOptions = useMemo<GraphSettingOption[]>(() => {
    const closeAfter = (run: () => void) => () => {
      onToggleGraphControls();
      run();
    };
    const options: GraphSettingOption[] = [];
    if (graphDirection === 'inputs') {
      options.push({
        key: 'use-byproducts',
        label: 'Use byproducts',
        description: 'Count what a recipe returns against what the tree still needs',
        kind: 'toggle',
        active: useByproducts,
        metricsId: 'graph.totals.use-byproducts',
        onPress: () => updateUseByproducts(!useByproducts),
      });
    }
    options.push(
      {
        key: 'radial',
        label: 'Radial layout',
        description: 'Arrange the tree outward from its root instead of top to bottom',
        kind: 'toggle',
        active: radialLayout,
        metricsId: 'graph.control.radial',
        onPress: toggleRadialLayout,
      },
      {
        key: 'compact',
        label: 'Compact nodes',
        description: 'Smaller nodes, so more of the tree fits on screen',
        kind: 'toggle',
        active: compactMode,
        metricsId: 'graph.control.compact',
        onPress: toggleCompactMode,
      },
      {
        key: 'unique',
        label: 'Unique recipes',
        description:
          'Expand each recipe once, and mark duplicates instead of repeating them',
        kind: 'toggle',
        active: expandRecipesOnce,
        metricsId: 'graph.control.expand-once',
        onPress: () => updateExpandRecipesOnce(!expandRecipesOnce),
      },
    );
    if (graphDirection === 'inputs' && !/^local-[a-f0-9]{16}$/u.test(data.descriptor.slug)) {
      options.push({
        key: 'auto-expand',
        label: communityAutoExpandLoading
          ? communityAutoExpand
            ? 'Auto expand · Expanding…'
            : 'Auto expand · Loading…'
          : 'Auto expand',
        description: 'Fill the tree in using the recipes other players favourited',
        kind: 'toggle',
        active: communityAutoExpand,
        metricsId: 'graph.control.community-auto-expand',
        onPress: () => void toggleCommunityAutoExpand(),
      });
    }
    options.push(
      {
        key: 'export-png',
        label: exportingTree ? 'Export HQ PNG · Rendering…' : 'Export HQ PNG',
        description:
          Platform.OS === 'web'
            ? 'Render the whole tree as a high-resolution image'
            : 'Available in the web viewer',
        kind: 'action',
        metricsId: 'graph.totals.export-png',
        onPress: exportingTree ? () => {} : closeAfter(() => void exportTreeImage()),
      },
      {
        key: 'share',
        label: 'Share this tree',
        description: 'Send the tree as a file, or open one you were sent',
        kind: 'action',
        metricsId: 'graph.control.share',
        onPress: closeAfter(() => {
          setTreeTransferMode('share');
          setShowTreeShare(true);
        }),
      },
      {
        key: 'clear-all',
        label: 'Clear all',
        description: 'Discard this tree entirely',
        kind: 'action',
        destructive: true,
        metricsId: 'graph.control.clear-all',
        onPress: closeAfter(clearAllExpansions),
      },
    );
    if (onClose && openTreeCount > 1) {
      options.push({
        key: 'close-tree',
        label: 'Close this tree',
        description: 'Leave the other open trees alone',
        kind: 'action',
        metricsId: 'graph.control.close-tree',
        onPress: closeAfter(onClose),
      });
    }
    return options;
  }, [
    clearAllExpansions,
    communityAutoExpand,
    communityAutoExpandLoading,
    compactMode,
    data.descriptor.slug,
    expandRecipesOnce,
    graphDirection,
    onClose,
    onToggleGraphControls,
    openTreeCount,
    exportTotals,
    exportTreeImage,
    exportingTree,
    radialLayout,
    toggleCommunityAutoExpand,
    toggleCompactMode,
    toggleRadialLayout,
    updateExpandRecipesOnce,
    updateUseByproducts,
    useByproducts,
  ]);

  // Memoized and hoisted above the empty-tree return, because the element lists below depend on
  // it and a fresh object each render would rebuild every node.
  const rootNodeActions = useMemo<RootNodeActionProps | undefined>(
    () =>
      showRootActions && root
        ? {
            amount: root.productionPlan?.amount ?? root.amount ?? 1,
            onAmountChange: updateRootRequestedAmount,
            onChangeRecipe: () => openRootPicker('inputs'),
            onAddUsedBy: () => openRootPicker('outputs'),
          }
        : undefined,
    // version: the production plan is edited in place on the root.
    [openRootPicker, root, showRootActions, updateRootRequestedAmount, version],
  );

  /**
   * The element lists are memoized, not just the components in them. A pan changes only the
   * transform, and a profile of one showed ten milliseconds of a sixteen millisecond frame
   * inside the refresh observer: with the culled set now steady between frames, holding these
   * arrays by identity lets React skip the whole graph subtree instead of rebuilding an element
   * and a props object for every node and edge on its way to the same result.
   */
  const edgeElements = useMemo(
    () => !rasterLowDetailGraph && renderedGraph?.edges.map((e, i) => (
            <View
              key={`e${i}`}
              style={[
                styles.edge,
                {
                  left: e.x,
                  top: e.y,
                  width: e.w,
                  height: e.h,
                  transform:
                    e.angle === undefined
                      ? undefined
                      : [{rotate: `${String(e.angle)}rad`}],
                },
              ]}
            />
          )),
    [rasterLowDetailGraph, renderedGraph],
  );
  const supplyEdgeElements = useMemo(
    () => !lowDetailGraph && renderedGraph?.supplyEdges.map(edge => (
            <View
              key={`byproduct:${edge.targetNodeId}:${edge.producerSourceId}`}
              pointerEvents="none"
              style={[
                styles.byproductSupplyEdge,
                {
                  left: edge.x,
                  top: edge.y,
                  width: edge.w,
                  height: edge.h,
                  transform: [{rotate: `${String(edge.angle ?? 0)}rad`}],
                },
              ]}
            />
          )),
    [lowDetailGraph, renderedGraph],
  );
  const nodeElements = useMemo(
    () => !rasterLowDetailGraph && renderedGraph?.nodes.map(n =>
            lowDetailGraph ? (
              <LowDetailNodeView
                key={n.id}
                x={n.x}
                y={n.y}
                w={n.w}
                h={n.h}
                node={n.item}
                expanded={n.kind === 'source'}
                onActions={handleLowDetailNodeActions}
                onTap={handleLowDetailNodeTap}
              />
            ) : compactMode || n.radial ? (
              <CompactItemNodeView
                key={n.id}
                x={
                  compactMode && n.item.id === 'root'
                    ? attachedRootVisualX(
                        n.x,
                        n.w,
                        radialLayout,
                        showRootActions,
                      )
                    : n.x
                }
                y={n.y}
                node={n.item}
                requiredAmount={displayedAmountFor(n.item)}
                byproductCoverage={treeTotals.byproductCoverageByNode.get(n.item.id)}
                isRoot={n.item.id === 'root'}
                selectable={
                  n.item.id === 'root' ||
                  (!isRecursiveItemNode(n.item) &&
                    (!!n.item.deferredRecipeExpansion ||
                      treeTotals.byproductCoverageByNode.has(n.item.id) ||
                      choicesFor(
                        n.item.key,
                        graphDirection,
                        n.item.alternatives,
                      ).length > 0))
                }
                terminal={
                  isRecursiveItemNode(n.item) ||
                  (!n.item.deferredRecipeExpansion &&
                    choicesFor(
                      n.item.key,
                      graphDirection,
                      n.item.alternatives,
                    ).length === 0)
                }
                terminalLabel={
                  isRecursiveItemNode(n.item)
                    ? 'recursive input, expansion disabled'
                    : graphDirection === 'outputs'
                      ? 'no outputs'
                      : 'no inputs'
                }
                radial={n.radial === true}
                radialRoot={radialLayout && n.item.id === 'root'}
                branchLabel={n.compactBranch === true}
                showLabel
                showAmounts={showNodeAmounts}
                collapsedBranch={isCollapsedBranch(n.item)}
                deferredDuplicate={!!n.item.deferredRecipeExpansion}
                rootActions={n.item.id === 'root' ? rootNodeActions : undefined}
                onChangeRecipe={
                  n.item.id !== 'root' &&
                  treeTotals.byproductCoverageByNode.has(n.item.id) &&
                  choicesFor(
                    n.item.key,
                    graphDirection,
                    n.item.alternatives,
                  ).length > 0
                    ? () =>
                        openPickerWithErrorHandling(
                          n.item,
                          treeTotals.byproductCoverageByNode.get(n.item.id),
                        )
                    : undefined
                }
                radialTap={n.radial === true}
                onTap={handleCompactNodeTap}
                onActions={openNodeMenu}
              />
            ) : n.kind === 'item' ? (
              <ItemNodeView
                key={n.id}
                x={n.x}
                y={n.y}
                node={n.item}
                requiredAmount={displayedAmountFor(n.item)}
                byproductCoverage={treeTotals.byproductCoverageByNode.get(n.item.id)}
                isRoot={n.item.id === 'root'}
                expandable={
                  !isRecursiveItemNode(n.item) &&
                  (!!n.item.deferredRecipeExpansion ||
                    choicesFor(
                      n.item.key,
                      graphDirection,
                      n.item.alternatives,
                    ).length > 0)
                }
                collapsedBranch={isCollapsedBranch(n.item)}
                deferredDuplicate={!!n.item.deferredRecipeExpansion}
                terminalLabel={
                  isRecursiveItemNode(n.item)
                    ? 'recursive input, expansion disabled'
                    : graphDirection === 'outputs'
                      ? 'no outputs'
                      : 'no inputs'
                }
                showAmounts={showNodeAmounts}
                rootActions={n.item.id === 'root' ? rootNodeActions : undefined}
                onTap={handleItemNodeTap}
                onInfo={handleNodeInfo}
                onActions={openNodeMenu}
              />
            ) : (
              <SourceNodeView
                key={n.id}
                x={n.x}
                y={n.y}
                w={n.w}
                h={n.h}
                item={n.item}
                requiredAmount={displayedAmountFor(n.item)}
                byproductCoverage={treeTotals.byproductCoverageByNode.get(n.item.id)}
                source={n.source!}
                isRoot={n.item.id === 'root'}
                radialRoot={radialLayout && n.item.id === 'root'}
                focused={n.source?.id === focusedSourceId}
                animateMobs={animateMobs}
                showAmounts={showNodeAmounts}
                rootActions={n.item.id === 'root' ? rootNodeActions : undefined}
                canSwap={
                  n.item.id !== 'root' &&
                  !isRecursiveItemNode(n.item) &&
                  choicesFor(
                    n.item.key,
                    graphDirection,
                    n.item.alternatives,
                  ).length > 1
                }
                onCollapse={onItemTap}
                onSwap={handleNodeSwap}
                onInfo={handleNodeInfo}
                onActions={openNodeMenu}
              />
            ),
          ),
    [
      animateMobs,
      choicesFor,
      compactMode,
      displayedAmountFor,
      focusedSourceId,
      graphDirection,
      handleCompactNodeTap,
      handleItemNodeTap,
      handleNodeInfo,
      handleNodeSwap,
      isCollapsedBranch,
      onItemTap,
      openNodeMenu,
      radialLayout,
      rasterLowDetailGraph,
      renderedGraph,
      rootNodeActions,
      showNodeAmounts,
      treeTotals,
    ],
  );

  if (!graphRootKey || !root) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No item selected</Text>
        <Text style={styles.emptyText}>
          Open an item and tap one of its recipe cards to start a crafting tree. Tap nodes to
          expand how each item is obtained — recipes, mining, or mob drops.
        </Text>
        <TouchableOpacity
          {...signalTarget('graph.empty.browse-items')}
          style={styles.emptyBtn}
          onPress={() => setTab('items')}>
          <Text style={styles.emptyBtnText}>Browse items</Text>
        </TouchableOpacity>
        {treeShareModal}
      </View>
    );
  }

  const graphMenuScaleStyle =
    Platform.OS === 'web'
      ? ({zoom: interfaceZoom} as unknown as object)
      : {transform: [{scale: interfaceZoom}], transformOrigin: 'top right', maxWidth: `${96 / interfaceZoom}%`} as const;
  const nodeMenuDirection: GraphDirection =
    nodeMenu?.node.id === 'root' ? 'inputs' : graphDirection;
  const nodeMenuChoiceCount = nodeMenu
    ? choicesFor(
        nodeMenu.node.key,
        nodeMenuDirection,
        nodeMenu.node.alternatives,
      ).length
    : 0;
  const nodeMenuHasRememberedSource = nodeMenu
    ? !!preferredSourceFor(nodeMenu.node.key, nodeMenu.node.alternatives)
    : false;
  const nodeMenuParentSource = nodeMenu
    ? parentRecipeSource(root, nodeMenu.node)
    : null;
  const nodeMenuCanToggleReusable =
    nodeMenuParentSource?.kind === 'recipe' &&
    nodeMenuParentSource.direction === 'inputs' &&
    nodeMenuParentSource.ref !== undefined;
  const nodeMenuPlacement = nodeMenu
    ? nodeContextMenuPlacement(
        nodeMenu.anchor,
        {width: viewportSize.w, height: viewportSize.h},
        interfaceZoom,
      )
    : null;

  return (
    <View style={styles.root}>
      <View
        ref={setCanvasRef}
        style={[styles.canvas, noSelect]}
        onLayout={e => {
          const nextViewport = {
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          };
          viewportRef.current = nextViewport;
          setViewportSize(current =>
            current.w === nextViewport.w && current.h === nextViewport.h
              ? current
              : nextViewport,
          );
          // The graph tab mounts hidden; fit once it actually gets a size.
          if (needsFitRef.current && fitView()) {
            needsFitRef.current = false;
          }
        }}
        {...responder.panHandlers}>
        {rasterLowDetailGraph && (
          <LowDetailGraphCanvas
            nodes={renderedGraph?.nodes ?? []}
            edges={renderedGraph?.edges ?? []}
            transform={displayTransform}
            viewport={viewportSize}
          />
        )}
        {/*
          Keep translation outside the detailed web scale layer. Detailed nodes
          use CSS zoom for crisp text and pixel art. The web low-detail tier is
          painted above as one fixed canvas; this transformed path remains for
          native low-detail nodes.
        */}
        <View
          style={[
            styles.anchor,
            Platform.OS !== 'web' && styles.nativeAnchor,
            // Translated with a transform rather than left/top on both web tiers: left and top
            // are layout properties, so panning reflowed every node in the tree each frame, while
            // a transform is composited. Scale still belongs to the inner layer below, so this
            // keeps translation outside it exactly as before.
            Platform.OS === 'web'
              ? ({
                  transform: [
                    {translateX: displayTransform.x},
                    {translateY: displayTransform.y},
                  ],
                  willChange: 'transform',
                } as unknown as object)
              : {
                  transform: [
                    {translateX: displayTransform.x},
                    {translateY: displayTransform.y},
                    {scale: displayTransform.scale},
                  ],
                },
          ]}>
          <View
            ref={anchorRef}
            collapsable={false}
            style={[
              styles.anchor,
              Platform.OS !== 'web' && styles.nativeAnchor,
              Platform.OS === 'web' && !displayTransform.nativeScale
                ? lowDetailGraph
                  ? ({
                      transform: [{scale: displayTransform.scale}],
                      transformOrigin: '0 0',
                      willChange: 'transform',
                    } as unknown as object)
                  : ({zoom: displayTransform.scale} as unknown as object)
                : null,
            ]}>
          {edgeElements}
          {supplyEdgeElements}
          {nodeElements}
          </View>
        </View>
      </View>

      {graphLayout.fallback && (
        <View
          style={[styles.layoutFallbackNotice, bottomNoticeStyle, graphMenuScaleStyle]}
          accessibilityRole="alert">
          <Text style={[styles.layoutFallbackText, noSelect]}>{graphLayout.fallback}</Text>
        </View>
      )}

      <View
        style={[styles.controls, graphMenuScaleStyle]}
        onLayout={event => {
          const {height} = event.nativeEvent.layout;
          setControlsHeight(current => (current === height ? current : height));
        }}>
        {showGraphControls && Platform.OS === 'web' && (
          <View style={styles.controlOptions}>
            <CtrlBtn
              label="Radial"
              metricsId="graph.control.radial"
              active={radialLayout}
              onPress={toggleRadialLayout}
            />
            <CtrlBtn
              label="Compact"
              metricsId="graph.control.compact"
              active={compactMode}
              onPress={toggleCompactMode}
            />
            <CtrlBtn
              label="Unique"
              accessibilityLabel="Use unique recipes"
              metricsId="graph.control.expand-once"
              active={expandRecipesOnce}
              onPress={() => updateExpandRecipesOnce(!expandRecipesOnce)}
            />
            {Platform.OS === 'web' && (
              <CtrlBtn
                label="Fast zoom"
                accessibilityLabel={
                  lowDetailEnabled
                    ? 'Draw full detail when zoomed out'
                    : 'Draw zoomed-out trees as flat chips so they stay interactive'
                }
                metricsId="graph.control.low-detail"
                active={lowDetailEnabled}
                onPress={toggleLowDetail}
              />
            )}
            {/* Everything past this point is an action rather than a view toggle, and none of it
                is reached often enough to earn a permanent row across a phone's canvas. */}
            <CtrlBtn
              label="More ⋯"
              accessibilityLabel={showMoreControls ? 'Hide more graph actions' : 'Show more graph actions'}
              metricsId="graph.control.more"
              active={showMoreControls}
              onPress={() => setShowMoreControls(value => !value)}
            />
          </View>
        )}
        <TouchableOpacity
          {...signalTarget('graph.control.collapse-all')}
          accessibilityRole="button"
          accessibilityLabel={treeIsExpanded ? 'Collapse the whole tree' : 'Expand the whole tree'}
          style={[styles.ctrlBtn, styles.controlMenuBtn]}
          onPress={toggleWholeTree}>
          <Text style={[styles.ctrlBtnText, styles.settingsGearIcon]}>
            {treeIsExpanded ? '⊟' : '⊞'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          {...signalTarget('graph.control.menu')}
          accessibilityRole="button"
          accessibilityLabel={
            Platform.OS === 'web'
              ? showGraphControls
                ? 'Collapse graph controls'
                : 'Expand graph controls'
              : 'Open graph settings'
          }
          accessibilityState={{expanded: showGraphControls}}
          style={[
            styles.ctrlBtn,
            styles.controlMenuBtn,
            Platform.OS === 'web' && !showGraphControls && styles.controlMenuBtnCollapsed,
            showGraphControls && Platform.OS === 'web' && styles.ctrlBtnActive,
          ]}
          onPress={onToggleGraphControls}>
          <View style={styles.ctrlBtnContent}>
            {Platform.OS === 'web' ? (
              <>
                {!showGraphControls && (
                  <Text style={[styles.ctrlBtnText, noSelect]}>Graph controls</Text>
                )}
                <DisclosureChevron
                  expanded={showGraphControls}
                  color={showGraphControls ? theme.accent : theme.text}
                  size={18}
                  strokeWidth={2.4}
                />
              </>
            ) : (
              <Text style={[styles.ctrlBtnText, styles.settingsGearIcon]}>⚙</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
      {showGraphControls && showMoreControls && Platform.OS === 'web' && (
        <View
          style={[
            styles.moreControls,
            controlsHeight > 0 ? {top: CONTROLS_TOP_INSET + controlsHeight + 6} : null,
            graphMenuScaleStyle,
          ]}>
          {graphDirection === 'inputs' && !/^local-[a-f0-9]{16}$/u.test(data.descriptor.slug) && (
            <CtrlBtn
              label={
                communityAutoExpandLoading
                  ? communityAutoExpand
                    ? 'Expanding…'
                    : 'Loading…'
                  : communityAutoExpand
                    ? 'Auto expand on'
                    : 'Auto expand'
              }
              accessibilityLabel={
                communityAutoExpand
                  ? 'Stop automatically expanding community favorite recipes'
                  : 'Automatically expand community favorite recipes'
              }
              metricsId="graph.control.community-auto-expand"
              active={communityAutoExpand}
              onPress={() => void toggleCommunityAutoExpand()}
            />
          )}
          {graphDirection === 'inputs' && (
            <CtrlBtn
              label="Use byproducts"
              accessibilityLabel={
                useByproducts
                  ? 'Stop counting byproducts against what the tree needs'
                  : 'Count byproducts against what the tree needs'
              }
              metricsId="graph.totals.use-byproducts"
              active={useByproducts}
              onPress={() => updateUseByproducts(!useByproducts)}
            />
          )}
          <CtrlBtn
            label={exportingTree ? 'Rendering…' : 'Export HQ PNG'}
            accessibilityLabel="Export the tree as a high-resolution image"
            metricsId="graph.totals.export-png"
            onPress={() => {
              if (exportingTree) return;
              setShowMoreControls(false);
              void exportTreeImage();
            }}
          />
          <CtrlBtn
            label="Share"
            metricsId="graph.control.share"
            onPress={() => {
              setShowMoreControls(false);
              setTreeTransferMode('share');
              setShowTreeShare(true);
            }}
          />
          <CtrlBtn
            label="Clear all"
            accessibilityLabel="Discard this recipe tree entirely"
            metricsId="graph.control.clear-all"
            onPress={() => {
              setShowMoreControls(false);
              clearAllExpansions();
            }}
          />
          {onClose && openTreeCount > 1 && (
            <CtrlBtn
              label="Close tree"
              accessibilityLabel="Close this recipe tree"
              metricsId="graph.control.close-tree"
              onPress={() => {
                setShowMoreControls(false);
                onClose();
              }}
            />
          )}
        </View>
      )}
      {recipeImportNotice && (
        <View
          style={[
            styles.uniqueModeNotice,
            bottomNoticeStyle,
            graphMenuScaleStyle,
          ]}
          accessibilityRole="alert">
          <Text style={[styles.uniqueModeNoticeText, noSelect]}>
            <Text style={styles.treeImportNoticeTitle}>Partial import. </Text>
            {recipeImportNotice}
          </Text>
          <View style={styles.treeImportNoticeActions}>
            {recipeImportReport ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open partial import details"
                style={styles.treeImportNoticeDetails}
                onPress={() => setShowRecipeImportDetails(true)}>
                <Text style={styles.treeImportNoticeDetailsText}>Open details</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Dismiss partial import notice"
              style={styles.uniqueModeNoticeDismiss}
              onPress={() => {
                onRecipeImportReportChange?.(null);
                setShowRecipeImportDetails(false);
                onRecipeImportNoticeChange?.(null);
              }}>
              <Text style={styles.uniqueModeNoticeDismissText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <TouchableOpacity
        {...signalTarget('graph.control.fit')}
        accessibilityRole="button"
        accessibilityLabel="Fit graph to view"
        style={[styles.ctrlBtn, styles.fitControl, graphMenuScaleStyle, Platform.OS !== 'web' && {transformOrigin: 'bottom left'}]}
        onPress={fitView}>
        <Text style={[styles.ctrlBtnText, styles.fitControlIcon]}>⛶</Text>
      </TouchableOpacity>
      {exportMessage && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${exportMessage}. Dismiss.`}
          style={[styles.exportNotice, bottomNoticeStyle, graphMenuScaleStyle]}
          onPress={() => setExportMessage(null)}>
          <Text style={[styles.exportNoticeText, noSelect]}>{exportMessage}</Text>
          <Text style={[styles.exportNoticeDismiss, noSelect]}>✕</Text>
        </TouchableOpacity>
      )}
      {focus && (
        <TouchableOpacity
          {...signalTarget('graph.focus.clear')}
          accessibilityRole="button"
          accessibilityLabel={`Focused on ${focusLabel}. Show the whole tree.`}
          style={[
            styles.focusChip,
            controlsHeight > 0 ? {top: CONTROLS_TOP_INSET + controlsHeight + 6} : null,
            graphMenuScaleStyle,
          ]}
          onPress={clearFocus}>
          <Text style={[styles.focusChipText, noSelect]} numberOfLines={1}>
            Focused: {focusLabel}
          </Text>
          <Text style={[styles.focusChipClear, noSelect]}>Show all ✕</Text>
        </TouchableOpacity>
      )}
      {graph && minimapVisible && (
        <GraphMinimap
          layout={graph}
          transform={transform}
          viewport={viewportSize}
          onRecenter={recenterOnGraphPoint}
          style={minimapStyle}
        />
      )}
      {Platform.OS !== 'web' && (
        <GraphSettingsSheet
          visible={showGraphControls}
          options={graphSettingOptions}
          onClose={onToggleGraphControls}
        />
      )}
      {pickerLookup && (
        <View
          style={styles.recipeLookupBackdrop}
          accessibilityViewIsModal
          accessibilityLabel={pickerLookup.title}>
          <View style={[styles.recipeLookupCard, graphMenuScaleStyle]}>
            <ActivityIndicator color={theme.accent} size="large" />
            <Text style={styles.recipeLookupTitle}>{pickerLookup.title}</Text>
            <Text style={styles.recipeLookupHint}>Loading recipe options…</Text>
            <TouchableOpacity
              {...signalTarget('graph.source-lookup.cancel')}
              accessibilityRole="button"
              accessibilityLabel="Cancel recipe lookup"
              style={styles.recipeLookupCancel}
              onPress={cancelPickerLookup}>
              <Text style={styles.recipeLookupCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {picker && (
        <PickerModal
          visible
          interfaceZoom={interfaceZoom}
          contentZoom={contentZoom}
          onContentZoomChange={onContentZoomChange}
          onContentZoomComplete={onContentZoomComplete}
          title={picker.title}
          direction={picker.target.id === 'root' ? picker.direction : undefined}
          onDirectionChange={
            picker.target.id === 'root'
              ? direction => {
                  if (direction === picker.direction) return;
                  void openPicker(
                    picker.target,
                    picker.byproductCoverage,
                    direction,
                  ).catch(error => {
                    console.error('The root recipe direction could not be changed.', {
                      itemKey: picker.target.key,
                      direction,
                      error,
                    });
                  });
                }
              : undefined
          }
          options={visiblePickerEntries(picker, hiddenRecipeStages).map(entry => entry.option)}
          rememberSource={picker.rememberSource}
          onRememberSourceChange={
            picker.direction === 'inputs'
              ? rememberSource =>
                  setPicker(current => (current ? {...current, rememberSource} : current))
              : undefined
          }
          filterLabel={
            picker.identifiedFluidTransferCount > 0
              ? 'Fluid container transfers'
              : undefined
          }
          filterHint={
            picker.identifiedFluidTransferCount > 0
              ? `Hidden by default · ${picker.identifiedFluidTransferCount} identified option${picker.identifiedFluidTransferCount === 1 ? '' : 's'}`
              : undefined
          }
          filterValue={picker.showFluidTransfers}
          onFilterValueChange={
            picker.identifiedFluidTransferCount > 0
              ? showFluidTransfers =>
                  setPicker(current => (current ? {...current, showFluidTransfers} : current))
              : undefined
          }
          recipeStageCounts={pickerRecipeStageCounts(picker)}
          hiddenRecipeStages={hiddenRecipeStages}
          onToggleRecipeStage={toggleRecipeStage}
          collapsedGroupKeys={picker.collapsedGroupKeys}
          onToggleGroup={togglePickerGroup}
          groupProgress={picker.recipeGroupProgress}
          onLoadGroup={groupKey => void loadPickerRecipeGroup(groupKey)}
          onClose={() => setPicker(null)}
          onSelectAlternative={(i, selectionKey, selectedKey) => {
            setPicker(current => {
              if (!current) {
                console.error(
                  'An ingredient alternative was selected after its source picker closed.',
                  {selectedIndex: i, selectionKey, selectedKey},
                );
                return current;
              }
              const visibleEntries = visiblePickerEntries(current, hiddenRecipeStages);
              const entry = visibleEntries[i];
              if (entry?.choice.t !== 'recipe' || !entry.recipe) {
                console.error(
                  'An ingredient alternative was selected for a non-recipe source.',
                  {
                    selectedIndex: i,
                    selectionKey,
                    selectedKey,
                    optionCount: visibleEntries.length,
                  },
                );
                return current;
              }
              const displayedSlot = entry.option.inputs?.find(
                input =>
                  (input.selectionKey ?? input.key) === selectionKey &&
                  input.alternatives.includes(selectedKey),
              );
              if (!displayedSlot) {
                console.error(
                  'The selected ingredient alternative is not present in the displayed recipe slot.',
                  {selectedIndex: i, selectionKey, selectedKey},
                );
                return current;
              }
              const choice: RecipeSourceChoice = {
                ...entry.choice,
                ingredientSelections: {
                  ...entry.choice.ingredientSelections,
                  [selectionKey]: selectedKey,
                },
              };
              const nextEntry = pickerEntryFor(
                current.target.key,
                choice,
                entry.recipe,
                current.direction,
              );
              const standardIndex = current.standardEntries.indexOf(entry);
              if (standardIndex >= 0) {
                const standardEntries = [...current.standardEntries];
                standardEntries[standardIndex] = nextEntry;
                return {...current, standardEntries};
              }
              if (!current.showFluidTransfers) {
                console.error(
                  'A hidden fluid-transfer recipe received an ingredient alternative selection.',
                  {selectedIndex: i, selectionKey, selectedKey},
                );
                return current;
              }
              const fluidIndex = current.fluidTransferEntries.indexOf(entry);
              const fluidTransferEntries = [...current.fluidTransferEntries];
              if (!fluidTransferEntries[fluidIndex]) {
                console.error(
                  'The selected fluid-transfer recipe index is outside the picker entries.',
                  {selectedIndex: i, fluidIndex},
                );
                return current;
              }
              fluidTransferEntries[fluidIndex] = nextEntry;
              return {...current, fluidTransferEntries};
            });
          }}
          onOpenMachine={machineKey => {
            openItem(machineKey);
          }}
          onSelect={i => {
            // Recorded rather than resolved here: the effect below settles the prompt once the
            // picker has actually closed, so the waiting run reads a node that has its source.
            pickerSelectionMadeRef.current = true;
            const p = picker;
            const entries = visiblePickerEntries(p, hiddenRecipeStages);
            const selectedEntry = entries[i];
            const choice = selectedEntry?.choice;
            if (!choice) {
              console.error('The selected source index was not present in the picker.', {
                selectedIndex: i,
                optionCount: entries.length,
              });
              return;
            }
            if (blockRecursiveExpansion(p.target, 'select picker source')) {
              setPicker(null);
              return;
            }
            if (p.productionPlan && choice.t === 'recipe') {
              p.target.productionPlan = {...p.productionPlan};
            }
            if (p.target.id === 'root' && p.direction === 'outputs') {
              if (choice.t !== 'recipe' || !selectedEntry.recipe) {
                console.error('A root usage selection was missing its loaded recipe.', {
                  itemKey: p.target.key,
                  selectedIndex: i,
                  recipeRef: choice.t === 'recipe' ? choice.ref : undefined,
                });
                return;
              }
              const usageStart = usageGraphStart(selectedEntry.recipe);
              if (!usageStart) {
                console.error('A root usage recipe has no product to promote to the graph root.', {
                  itemKey: p.target.key,
                  recipeRef: choice.ref,
                });
                return;
              }
              setPicker(null);
              openRecipeInGraph(usageStart.rootKey, choice.ref, usageStart.direction);
              return;
            }
            setPicker(null);
            if (p.target.id === 'root' && p.direction !== graphDirection) {
              if (p.direction === 'inputs') {
                setPreferredSource(p.target.key, p.rememberSource ? choice : null);
              }
              pendingRootChoiceRef.current = {
                key: p.target.key,
                direction: p.direction,
                choice,
              };
              changeGraphDirection(p.direction);
              return;
            }
            if (p.direction === 'outputs') {
              p.target.source = undefined;
              applyChoice(p.target, choice, {expansionBudget: budgetFor(p.target)});
              return;
            }
            if (p.target.source) {
              releaseByproductFulfillmentsFromSubtree(p.target);
            }
            p.target.source = undefined;
            if (p.byproductCoverage && p.byproductCoverage.remainingAmount > 0) {
              p.target.byproductFulfillment = {
                creditedAmount: p.byproductCoverage.creditedAmount,
                allocations: p.byproductCoverage.allocations.map(allocation => ({
                  ...allocation,
                })),
              };
            }
            setPreferredSource(p.target.key, p.rememberSource ? choice : null);
            if (p.rememberSource) {
              applyPreferredSourceAcrossTree(p.target, choice, budgetFor(p.target));
              return;
            }
            applyChoice(p.target, choice, {expansionBudget: budgetFor(p.target)});
          }}
        />
      )}
      {nodeMenu && nodeMenuPlacement && (
        <NodeActionMenu
          node={nodeMenu.node}
          interfaceZoom={interfaceZoom}
          placement={nodeMenuPlacement}
          canSetRecipe={nodeMenuChoiceCount > 0}
          hasRememberedSource={nodeMenuHasRememberedSource}
          amount={
            nodeMenu.node.id === 'root'
              ? root.productionPlan?.amount ?? root.amount ?? 1
              : undefined
          }
          onClose={() => setNodeMenu(null)}
          onSelectAlternative={selectedKey =>
            selectNodeAlternative(nodeMenu.node, selectedKey)
          }
          onSetOrChangeRecipe={() => {
            const target = nodeMenu.node;
            const coverage = treeTotals.byproductCoverageByNode.get(target.id);
            setNodeMenu(null);
            if (target.id === 'root') {
              openRootPicker('inputs');
            } else {
              openPickerWithErrorHandling(target, coverage, nodeMenuDirection);
            }
          }}
          onAddUsedBy={
            nodeMenu.node.id === 'root'
              ? () => {
                  setNodeMenu(null);
                  openRootPicker('outputs');
                }
              : undefined
          }
          onAmountChange={
            nodeMenu.node.id === 'root' ? updateRootRequestedAmount : undefined
          }
          onUnsetRecipe={() => unsetNodeRecipe(nodeMenu.node)}
          onCollapseRecipe={() => collapseNodeRecipe(nodeMenu.node)}
          onToggleRootControls={
            nodeMenu.node.id === 'root'
              ? () => {
                  setShowRootActions(value => !value);
                  setNodeMenu(null);
                }
              : undefined
          }
          rootControlsShown={showRootActions}
          onFocusBranch={() => focusBranch(nodeMenu.node)}
          isFocused={focusNodeId === nodeMenu.node.id}
          onToggleReusable={
            nodeMenuCanToggleReusable
              ? () => toggleNodeReusable(nodeMenu.node)
              : undefined
          }
        />
      )}
      {treeShareModal}
      <RecipeImportDetailsModal
        report={showRecipeImportDetails ? recipeImportReport : null}
        interfaceZoom={interfaceZoom}
        onClose={() => setShowRecipeImportDetails(false)}
      />
      <AutoExpandSummaryModal
        entries={autoExpandSummary}
        interfaceZoom={interfaceZoom}
        onClose={() => setAutoExpandSummary(null)}
      />
    </View>
  );
}

type RootNodeActionProps = {
  amount: number;
  onAmountChange: (amount: number) => void;
  onChangeRecipe: () => void;
  onAddUsedBy: () => void;
};

const ROOT_AMOUNT_STEPPER_HEIGHT = 86;

function RootAmountStepper({
  amount,
  onAmountChange,
}: Pick<RootNodeActionProps, 'amount' | 'onAmountChange'>) {
  const [amountText, setAmountText] = useState(String(amount));
  useEffect(() => setAmountText(String(amount)), [amount]);
  const adjustAmount = (direction: -1 | 1) => {
    onAmountChange(amount + direction);
  };
  const updateAmountText = (value: string) => {
    setAmountText(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) onAmountChange(parsed);
  };

  return (
    <View style={styles.rootNodeAmountRail}>
      <TouchableOpacity
        {...signalTarget('graph.root-actions.amount.increase')}
        accessibilityRole="button"
        accessibilityLabel="Increase requested amount"
        style={[styles.rootNodeStepButton, styles.rootNodeIncreaseButton]}
        onPress={() => adjustAmount(1)}>
        <Text style={[styles.rootNodeStepText, styles.rootNodeIncreaseText]}>+</Text>
      </TouchableOpacity>
      <TextInput
        accessibilityLabel="Amount requested"
        style={styles.rootNodeAmountInput}
        value={amountText}
        onChangeText={updateAmountText}
        onBlur={() => setAmountText(String(amount))}
        keyboardType="number-pad"
        inputMode="numeric"
        selectTextOnFocus
      />
      <TouchableOpacity
        {...signalTarget('graph.root-actions.amount.decrease')}
        accessibilityRole="button"
        accessibilityLabel="Decrease requested amount"
        style={styles.rootNodeStepButton}
        onPress={() => adjustAmount(-1)}>
        <Text style={styles.rootNodeStepText}>−</Text>
      </TouchableOpacity>
    </View>
  );
}

function RootActionButtons({
  onChangeRecipe,
  onAddUsedBy,
}: Pick<RootNodeActionProps, 'onChangeRecipe' | 'onAddUsedBy'>) {
  return (
    <View style={styles.rootNodeActionButtons}>
      <TouchableOpacity
        {...signalTarget('graph.root-actions.change-recipe')}
        accessibilityRole="button"
        style={styles.rootNodeSecondaryAction}
        onPress={onChangeRecipe}>
        <Text style={styles.rootNodeSecondaryActionText}>Change recipe</Text>
      </TouchableOpacity>
      <TouchableOpacity
        {...signalTarget('graph.root-actions.add-used-by')}
        accessibilityRole="button"
        style={styles.rootNodePrimaryAction}
        onPress={onAddUsedBy}>
        <Text style={styles.rootNodePrimaryActionText}>Add used by</Text>
      </TouchableOpacity>
    </View>
  );
}

function AttachedRootActions({
  actions,
  nodeX,
  nodeY,
  nodeWidth,
  nodeHeight,
  buttonWidth,
}: {
  actions: RootNodeActionProps;
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  nodeHeight: number;
  buttonWidth: number;
}) {
  const wrapperLeft = nodeX - (buttonWidth - nodeWidth) / 2;
  const nodeLeft = (buttonWidth - nodeWidth) / 2;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.attachedRootActions,
        {
          left: wrapperLeft,
          top: nodeY,
          width: Math.max(buttonWidth, nodeLeft + nodeWidth + 40),
          height: nodeHeight + 62,
        },
      ]}>
      <View
        style={[
          styles.attachedRootStepper,
          {
            left: nodeLeft + nodeWidth + 6,
            top: Math.max(0, (nodeHeight - ROOT_AMOUNT_STEPPER_HEIGHT) / 2),
          },
        ]}>
        <RootAmountStepper {...actions} />
      </View>
      <View
        style={[
          styles.attachedRootButtons,
          {left: 0, top: nodeHeight + 24, width: buttonWidth},
        ]}>
        <RootActionButtons {...actions} />
      </View>
    </View>
  );
}

/**
 * Unreferenced on purpose: the canvas panel and its toggle were removed when the totals controls
 * were split into standalone settings, and totals are moving to a tab of their own. Kept because
 * that tab needs exactly this rendering, along with TreeTotalsSection below.
 */
function TreeTotalsPanel({
  interfaceZoom,
  top,
  totals,
  useByproducts,
  exportingTree,
  exportMessage,
  onUseByproductsChange,
  onExportTotals,
  onExportTree,
  onIngredientTap,
  onOpenItem,
}: {
  interfaceZoom: number;
  /** Measured clearance below the controls, which wrap onto more rows as the screen narrows. */
  top?: number;
  totals: TreeTotals;
  useByproducts: boolean;
  exportingTree: boolean;
  exportMessage: string | null;
  onUseByproductsChange: (value: boolean) => void;
  onExportTotals: () => void;
  onExportTree: () => void;
  onIngredientTap: (total: TreeTotal, kind: TreeTotalTargetKind) => void;
  onOpenItem: (key: string) => void;
}) {
  return (
    <View
      style={[
        styles.totalsPanel,
        top === undefined ? null : {top},
        Platform.OS === 'web'
          ? ({zoom: interfaceZoom} as unknown as object)
          : null,
      ]}>
      <View style={styles.totalsHeader}>
        <Text style={[styles.totalsTitle, noSelect]}>Tree totals</Text>
        <TouchableOpacity
          {...signalTarget('graph.totals.use-byproducts')}
          accessibilityRole="checkbox"
          accessibilityState={{checked: useByproducts}}
          style={[styles.totalsOption, useByproducts && styles.totalsOptionActive]}
          onPress={() => onUseByproductsChange(!useByproducts)}>
          <Text style={[styles.totalsOptionText, useByproducts && styles.totalsOptionTextActive]}>
            {useByproducts ? '✓ ' : ''}Use byproducts
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.exportActions}>
        <TouchableOpacity
          {...signalTarget('graph.totals.export-csv')}
          style={styles.exportBtn}
          onPress={onExportTotals}>
          <Text style={styles.exportBtnText}>Export resources CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          {...signalTarget('graph.totals.export-png')}
          style={[styles.exportBtn, exportingTree && styles.exportBtnDisabled]}
          disabled={exportingTree}
          onPress={onExportTree}>
          <Text style={styles.exportBtnText}>{exportingTree ? 'Rendering…' : 'Export HQ tree PNG'}</Text>
        </TouchableOpacity>
      </View>
      {exportMessage && <Text style={[styles.exportMessage, noSelect]}>{exportMessage}</Text>}
      <ScrollView style={styles.totalsScroll} contentContainerStyle={styles.totalsContent}>
        <TreeTotalsSection
          title={useByproducts ? 'Inputs still needed' : 'Inputs'}
          totals={totals.inputs}
          onPress={total => onIngredientTap(total, 'input')}
        />
        {useByproducts && (
          <TreeTotalsSection
            title="Byproducts used"
            totals={totals.byproductCredits}
            onPress={total => onIngredientTap(total, 'input')}
          />
        )}
        <TreeTotalsSection
          title={useByproducts ? 'Byproducts remaining' : 'Byproducts'}
          totals={totals.byproducts}
          onPress={total => onOpenItem(total.key)}
        />
      </ScrollView>
    </View>
  );
}

function TreeTotalsSection({
  title,
  totals,
  onPress,
}: {
  title: string;
  totals: TreeTotal[];
  onPress: (total: TreeTotal) => void;
}) {
  const data = useData();
  return (
    <View style={styles.totalsSection}>
      <Text style={[styles.totalsSectionTitle, noSelect]}>{title}</Text>
      {totals.length === 0 ? (
        <Text style={[styles.totalsEmpty, noSelect]}>None</Text>
      ) : (
        totals.map(total => {
          const item = data.itemsByKey.get(total.key);
          return (
            <TouchableOpacity
              {...signalTarget('graph.totals.item.open')}
              key={`${total.key}:${total.tag ?? ''}`}
              style={styles.totalRow}
              accessibilityRole="button"
              onPress={() => onPress(total)}>
              <ItemIcon item={item} itemKey={total.key} size={16} />
              <Text style={[styles.totalName, noSelect]} numberOfLines={1}>
                {displayIngredientName(
                  item?.n ?? total.key,
                  total.tag,
                  data.descriptor.minecraftVersion,
                )}
              </Text>
              <Text style={[styles.totalAmount, noSelect]}>
                {formatIngredientQuantity(total.key, total.amount)}
              </Text>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

function useNodeActionHandlers(
  onPress: () => void,
  onActions: (pointer?: NodeActionPointer) => void,
) {
  const longPressedRef = useRef(false);
  const press = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    onPress();
  };
  const longPress = (event: GestureResponderEvent) => {
    longPressedRef.current = true;
    onActions(nodeActionPointer(event));
  };
  const contextMenuProps =
    Platform.OS === 'web'
      ? ({
          onContextMenu: (event: NodeActionEvent) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            onActions(nodeActionPointer(event));
          },
        } as object)
      : {};
  return {press, longPress, contextMenuProps};
}

const LowDetailItemIcon = React.memo(function LowDetailItemIcon({
  itemKey,
  size,
}: {
  itemKey: string;
  size: number;
}) {
  return <ItemIcon itemKey={itemKey} size={size} />;
});

const LowDetailNodeView = React.memo(function LowDetailNodeView({
  x,
  y,
  w,
  h,
  node,
  expanded,
  onTap,
  onActions,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  node: ItemTreeNode;
  expanded: boolean;
  onTap: (node: ItemTreeNode) => void;
  onActions: (node: ItemTreeNode, pointer?: NodeActionPointer) => void;
}) {
  const handleTap = useCallback(() => onTap(node), [node, onTap]);
  const handleActions = useCallback(
    (pointer?: NodeActionPointer) => onActions(node, pointer),
    [node, onActions],
  );
  const handlers = useNodeActionHandlers(handleTap, handleActions);
  // The layout box is 172 by 58 for an item, which at this zoom is a wide empty rectangle with a
  // small icon adrift in it. A square chip on the same centre keeps the edges meeting where they
  // did, and the icon fills it rather than floating inside it.
  const chip = Math.max(16, Math.min(w, h));
  return (
    <Pressable
      {...handlers.contextMenuProps}
      accessibilityRole="button"
      accessibilityLabel="Recipe graph node; zoom in for details"
      onPress={handlers.press}
      onLongPress={handlers.longPress}
      delayLongPress={450}
      style={[
        styles.lowDetailNode,
        expanded && styles.lowDetailSourceNode,
        node.id === 'root' && styles.lowDetailRootNode,
        {
          left: x + (w - chip) / 2,
          top: y + (h - chip) / 2,
          width: chip,
          height: chip,
        },
      ]}
    >
      <LowDetailItemIcon itemKey={node.key} size={chip} />
    </Pressable>
  );
});

function ContextAmountStepper({
  amount,
  onAmountChange,
}: {
  amount: number;
  onAmountChange: (amount: number) => void;
}) {
  const [amountText, setAmountText] = useState(String(amount));
  useEffect(() => setAmountText(String(amount)), [amount]);
  const updateAmountText = (value: string) => {
    setAmountText(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) onAmountChange(parsed);
  };
  return (
    <View style={styles.nodeActionAmountSection}>
      <Text style={styles.nodeActionSectionLabel}>Requested amount</Text>
      <View style={styles.nodeActionAmountStepper}>
        <TouchableOpacity
          {...signalTarget('graph.node-menu.amount.decrease')}
          accessibilityRole="button"
          accessibilityLabel="Decrease requested amount"
          style={styles.nodeActionAmountButton}
          onPress={() => onAmountChange(amount - 1)}>
          <Text style={styles.nodeActionAmountButtonText}>−</Text>
        </TouchableOpacity>
        <TextInput
          accessibilityLabel="Amount requested"
          style={styles.nodeActionAmountInput}
          value={amountText}
          onChangeText={updateAmountText}
          onBlur={() => setAmountText(String(amount))}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
        />
        <TouchableOpacity
          {...signalTarget('graph.node-menu.amount.increase')}
          accessibilityRole="button"
          accessibilityLabel="Increase requested amount"
          style={[styles.nodeActionAmountButton, styles.nodeActionAmountButtonPrimary]}
          onPress={() => onAmountChange(amount + 1)}>
          <Text
            style={[
              styles.nodeActionAmountButtonText,
              styles.nodeActionAmountButtonPrimaryText,
            ]}>
            +
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NodeActionMenu({
  node,
  interfaceZoom,
  placement,
  canSetRecipe,
  hasRememberedSource,
  amount,
  onClose,
  onSelectAlternative,
  onSetOrChangeRecipe,
  onAddUsedBy,
  onAmountChange,
  onUnsetRecipe,
  onCollapseRecipe,
  onToggleRootControls,
  rootControlsShown,
  onFocusBranch,
  isFocused,
  onToggleReusable,
}: {
  node: ItemTreeNode;
  interfaceZoom: number;
  placement: NodeContextMenuPlacement;
  canSetRecipe: boolean;
  hasRememberedSource: boolean;
  amount?: number;
  onClose: () => void;
  onSelectAlternative: (selectedKey: string) => void;
  onSetOrChangeRecipe: () => void;
  onAddUsedBy?: () => void;
  onAmountChange?: (amount: number) => void;
  onUnsetRecipe: () => void;
  onCollapseRecipe: () => void;
  /** Root only: the amount stepper and pickers attached to the node itself. */
  onToggleRootControls?: () => void;
  rootControlsShown: boolean;
  onFocusBranch: () => void;
  /** Focusing the node that is already focused is how the user gets the whole tree back. */
  isFocused: boolean;
  onToggleReusable?: () => void;
}) {
  const data = useData();
  const alternatives = Array.from(
    new Map(
      (node.alternatives ?? []).map(itemKey => {
        const item = data.itemsByKey.get(itemKey);
        const identity = item
          ? `${item.t ?? 'item'}\u0000${item.id}\u0000${item.n}`
          : itemKey;
        return [identity, itemKey] as const;
      }),
    ).values(),
  );
  const hasSelectedRecipe = !!node.source || !!node.deferredRecipeExpansion;
  const isRoot = node.id === 'root';
  const stateLabel = node.deferredRecipeExpansion
    ? 'Recipe expanded elsewhere'
    : node.source
      ? 'Recipe expanded'
      : canSetRecipe
        ? 'No recipe selected'
        : 'No recipe available';
  const menuScaleStyle =
    Platform.OS === 'web' ? ({zoom: interfaceZoom} as unknown as object) : null;
  return (
    <View style={styles.nodeActionLayer} pointerEvents="box-none">
      <Pressable
        style={styles.nodeActionDismiss}
        accessibilityLabel="Close node menu"
        onPress={onClose}
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.nodeActionAnchor,
          {left: placement.left, top: placement.top},
        ]}>
        <Pressable
          accessibilityRole="menu"
          accessibilityLabel={`${data.itemsByKey.get(node.key)?.n ?? node.key} node menu`}
          style={[
            styles.nodeActionCard,
            {width: placement.width, maxHeight: placement.maxHeight},
            menuScaleStyle,
          ]}
          onPointerDown={event => event.stopPropagation()}
          onTouchStart={event => event.stopPropagation()}
          onPress={event => event.stopPropagation()}>
          <View style={styles.nodeActionHeader}>
            <ItemIcon itemKey={node.key} size={32} />
            <View style={styles.nodeActionHeaderCopy}>
              <Text style={styles.nodeActionTitle} numberOfLines={1}>
                {data.itemsByKey.get(node.key)?.n ?? node.key}
              </Text>
              <Text style={styles.nodeActionHint}>
                {isRoot ? `Starting node · ${stateLabel}` : stateLabel}
              </Text>
            </View>
          </View>
          {amount !== undefined && onAmountChange && (
            <ContextAmountStepper amount={amount} onAmountChange={onAmountChange} />
          )}
          {alternatives.length > 1 && (
            <View style={styles.nodeAlternativeSection}>
              <Text style={styles.nodeActionSectionLabel}>
                {node.tag ? `#${node.tag}` : 'Ingredient alternatives'}
              </Text>
              <ScrollView style={styles.nodeAlternativeScroll}>
                {alternatives.map(itemKey => (
                  <TouchableOpacity
                    key={itemKey}
                    accessibilityRole="button"
                    accessibilityState={{selected: itemKey === node.key}}
                    style={[
                      styles.nodeAlternativeRow,
                      itemKey === node.key && styles.nodeAlternativeRowSelected,
                    ]}
                    onPress={() => onSelectAlternative(itemKey)}>
                    <ItemIcon itemKey={itemKey} size={32} />
                    <Text style={styles.nodeAlternativeName} numberOfLines={2}>
                      {data.itemsByKey.get(itemKey)?.n ?? itemKey}
                    </Text>
                    {itemKey === node.key && (
                      <Text style={styles.nodeAlternativeSelected}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={styles.nodeActionButtons}>
            {canSetRecipe && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.set-recipe')}
                accessibilityRole="button"
                style={[styles.nodeActionButton, styles.nodeActionButtonPrimary]}
                onPress={onSetOrChangeRecipe}>
                <Text style={styles.nodeActionButtonPrimaryText}>
                  {hasSelectedRecipe ? 'Change recipe' : 'Set recipe'}
                </Text>
                <Text style={styles.nodeActionButtonPrimaryHint}>
                  {hasSelectedRecipe ? 'Choose a different source' : 'Choose how to make this item'}
                </Text>
              </TouchableOpacity>
            )}
            {onAddUsedBy && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.add-used-by')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onAddUsedBy}>
                <Text style={styles.nodeActionButtonText}>Add used by</Text>
                <Text style={styles.nodeActionButtonHint}>Add a recipe that consumes the starting item</Text>
              </TouchableOpacity>
            )}
            {onToggleReusable && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.toggle-reusable')}
                accessibilityRole="button"
                accessibilityLabel={
                  node.nonConsumed ? 'Treat recipe ingredient as consumed' : 'Treat recipe ingredient as reusable'
                }
                style={styles.nodeActionButton}
                onPress={onToggleReusable}>
                <Text style={styles.nodeActionButtonText}>
                  {node.nonConsumed ? 'Treat as consumed' : 'Treat as reusable'}
                </Text>
                <Text style={styles.nodeActionButtonHint}>
                  Manual override for this recipe input
                </Text>
              </TouchableOpacity>
            )}
            {onToggleRootControls && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.root-controls')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onToggleRootControls}>
                <Text style={styles.nodeActionButtonText}>
                  {rootControlsShown ? 'Hide root controls' : 'Show root controls'}
                </Text>
                <Text style={styles.nodeActionButtonHint}>
                  The amount and recipe controls attached to the root node
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              {...signalTarget('graph.node-menu.focus-branch')}
              accessibilityRole="button"
              style={styles.nodeActionButton}
              onPress={onFocusBranch}>
              <Text style={styles.nodeActionButtonText}>
                {isFocused ? 'Show whole tree' : 'Focus this branch'}
              </Text>
              <Text style={styles.nodeActionButtonHint}>
                {isFocused
                  ? 'Bring back the branches hidden by this focus'
                  : 'Hide every branch except this one and what it needs'}
              </Text>
            </TouchableOpacity>
            {hasSelectedRecipe && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.collapse-recipe')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onCollapseRecipe}>
                <Text style={styles.nodeActionButtonText}>Collapse recipe</Text>
                <Text style={styles.nodeActionButtonHint}>Keep the remembered source</Text>
              </TouchableOpacity>
            )}
            {(hasSelectedRecipe || hasRememberedSource) && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.unset-recipe')}
                accessibilityRole="button"
                style={[styles.nodeActionButton, styles.nodeActionButtonDanger]}
                onPress={onUnsetRecipe}>
                <Text style={styles.nodeActionButtonDangerText}>Unset recipe</Text>
                <Text style={styles.nodeActionButtonHint}>Clear this node and its remembered source</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Memoized: panning sets a new transform on every frame, which re-renders the graph, and without
 * this every visible node re-rendered with it -- recipe previews, item chips and all. That cost is
 * per frame rather than per tree, which is why a sixteen-node tree panned as badly as a large one.
 * Every callback prop is node-taking so the parent can pass one stable function; an inline closure
 * here is a new prop each frame and a memo cannot see past it.
 */
const CompactItemNodeView = React.memo(function CompactItemNodeView({
  x,
  y,
  node,
  radialTap,
  requiredAmount,
  byproductCoverage,
  isRoot,
  selectable,
  terminal,
  terminalLabel,
  radial = false,
  radialRoot = false,
  branchLabel = false,
  showLabel,
  showAmounts,
  collapsedBranch,
  deferredDuplicate,
  rootActions,
  onChangeRecipe,
  onTap,
  onActions,
}: {
  x: number;
  y: number;
  node: ItemTreeNode;
  requiredAmount: number | null;
  byproductCoverage?: NodeByproductCoverage;
  isRoot: boolean;
  selectable: boolean;
  terminal: boolean;
  terminalLabel: string;
  radial?: boolean;
  radialRoot?: boolean;
  branchLabel?: boolean;
  showLabel: boolean;
  showAmounts: boolean;
  /** Not expanded, but a remembered recipe means there is a tree folded under it. */
  collapsedBranch: boolean;
  deferredDuplicate: boolean;
  rootActions?: RootNodeActionProps;
  onChangeRecipe?: () => void;
  /** True for a radial collapsed ingredient, which taps straight through to expanding. */
  radialTap?: boolean;
  /** Node-taking, so the parent passes one stable function rather than a closure per render. */
  onTap: (node: ItemTreeNode, radial?: boolean) => void;
  onActions: (node: ItemTreeNode, pointer?: NodeActionPointer) => void;
}) {
  const data = useData();
  const item = data.itemsByKey.get(node.key);
  const name = displayIngredientName(
    item?.n ?? node.key,
    node.tag,
    data.descriptor.minecraftVersion,
  );
  const amount = formatIngredientQuantity(
    node.key,
    byproductCoverage?.remainingAmount ?? requiredAmount,
  );
  const countBadgeText = byproductCoverage?.remainingAmount === 0 ? '✓' : amount;
  const showCountBadge = countBadgeText === '✓' || showAmounts;
  const byproductLabel = byproductCoverage
    ? byproductCoverage.remainingAmount === 0
      ? `completed by byproduct ${formatIngredientQuantity(node.key, byproductCoverage.creditedAmount)}`
      : `${formatIngredientQuantity(node.key, byproductCoverage.creditedAmount)} supplied by byproduct, ${formatIngredientQuantity(node.key, byproductCoverage.remainingAmount)} still needed`
    : null;
  const pendingTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pendingTapRef.current) clearTimeout(pendingTapRef.current);
    },
    [],
  );
  const clearPendingTap = () => {
    if (!pendingTapRef.current) return;
    clearTimeout(pendingTapRef.current);
    pendingTapRef.current = null;
  };
  const handleTap = () => {
    if (!selectable || node.loading) return;
    if (!onChangeRecipe) {
      onTap(node, radialTap);
      return;
    }
    if (pendingTapRef.current) {
      clearPendingTap();
      onChangeRecipe();
      return;
    }
    pendingTapRef.current = setTimeout(() => {
      pendingTapRef.current = null;
      onTap(node, radialTap);
    }, 280);
  };
  const handlers = useNodeActionHandlers(handleTap, pointer => {
    clearPendingTap();
    onActions(node, pointer);
  });
  return (
    <>
      <Pressable
      {...signalTarget(`graph.node.expand.${nodeDepthBucket(node)}`)}
      {...handlers.contextMenuProps}
      accessibilityRole={selectable ? 'button' : undefined}
      accessibilityLabel={`${name}, quantity ${formatIngredientQuantity(node.key, requiredAmount)}${terminal ? `, ${terminalLabel}` : ''}${deferredDuplicate ? ', recipe expanded elsewhere, tap to move expansion here' : ''}${byproductLabel ? `, ${byproductLabel}` : ''}${node.nonConsumed ? ', not consumed' : ''}${node.consumptionProbability !== undefined ? `, ${node.consumptionProbability == null ? 'unknown' : `${String(Math.round(node.consumptionProbability * 10_000) / 100)} percent`} consume chance` : ''}${node.productionProbability !== undefined ? `, ${node.productionProbability == null ? 'unknown' : `${String(Math.round(node.productionProbability * 10_000) / 100)} percent`} produce chance` : ''}${isRoot ? ', open amount and recipe controls' : selectable && !deferredDuplicate ? byproductCoverage?.remainingAmount === 0 ? ', navigate to producing recipe' : ', choose source' : ''}${onChangeRecipe ? ', double tap to change recipe' : ''}, long press or right click for node options`}
      disabled={!selectable || node.loading}
      focusable
      onPress={handlers.press}
      onLongPress={handlers.longPress}
      delayLongPress={450}
      style={[
        radial ? styles.radialItemNode : styles.compactItemNode,
        branchLabel && styles.compactBranchNode,
        {left: x, top: y},
        node.retentionMode === 'durability'
          ? styles.nodeDurabilityTool
          : node.nonConsumed && styles.nodeReusableItem,
        isRecursiveItemNode(node) && styles.nodeCyclic,
        terminal && !isRecursiveItemNode(node) && styles.nodeTerminal,
        node.loading && styles.nodeLoading,
        byproductCoverage?.remainingAmount === 0 && styles.nodeByproductComplete,
        byproductCoverage &&
          byproductCoverage.remainingAmount > 0 &&
          styles.nodeByproductPartial,
        collapsedBranch && styles.nodeCollapsedBranch,
        deferredDuplicate && styles.nodeDeferredRecipe,
        isRoot && !radialRoot && styles.compactRootNode,
        radialRoot && styles.radialRootNode,
      ]}>
      {isRoot && (
        <View
          pointerEvents="none"
          style={[
            radialRoot ? styles.radialRootDiamond : styles.compactRootDiamond,
            rootActions && styles.rootDiamondSelected,
          ]}
        />
      )}
      <ItemIcon
        item={item}
        itemKey={node.key}
        size={radialRoot ? RADIAL_ROOT_ITEM_ICON_SIZE : 32}
      />
      {showCountBadge && (
        <View
          style={[
            styles.compactCountBadge,
            isRoot && !radialRoot && styles.compactRootCountBadge,
            radialRoot && styles.radialRootCountBadge,
            byproductCoverage && styles.compactByproductCountBadge,
          ]}>
          <Text
            style={[
              styles.compactCountText,
              byproductCoverage && styles.compactByproductCountText,
              noSelect,
            ]}>
            {countBadgeText}
          </Text>
        </View>
      )}
      {showLabel && (
        <View
          pointerEvents="none"
          style={[
            styles.compactBranchLabel,
            isRoot && !radialRoot && styles.compactRootBranchLabel,
            radialRoot && styles.radialRootBranchLabel,
          ]}>
          <Text style={[styles.compactBranchLabelText, noSelect]} numberOfLines={1}>
            {name}
          </Text>
        </View>
      )}
      </Pressable>
      {isRoot && rootActions && (
        <AttachedRootActions
          actions={rootActions}
          nodeX={x}
          nodeY={y}
          nodeWidth={radialRoot ? RADIAL_ROOT_SIZE : COMPACT_ROOT_SIZE}
          nodeHeight={radialRoot ? RADIAL_ROOT_SIZE : COMPACT_ROOT_SIZE}
          buttonWidth={ROOT_ATTACHED_ACTIONS_WIDTH}
        />
      )}
    </>
  );
});

/**
 * Memoized: panning sets a new transform on every frame, which re-renders the graph, and without
 * this every visible node re-rendered with it -- recipe previews, item chips and all. That cost is
 * per frame rather than per tree, which is why a sixteen-node tree panned as badly as a large one.
 * Every callback prop is node-taking so the parent can pass one stable function; an inline closure
 * here is a new prop each frame and a memo cannot see past it.
 */
const ItemNodeView = React.memo(function ItemNodeView({
  x,
  y,
  node,
  requiredAmount,
  byproductCoverage,
  isRoot,
  expandable,
  collapsedBranch,
  deferredDuplicate,
  terminalLabel,
  showAmounts,
  rootActions,
  onTap,
  onInfo,
  onActions,
}: {
  x: number;
  y: number;
  node: ItemTreeNode;
  requiredAmount: number | null;
  byproductCoverage?: NodeByproductCoverage;
  isRoot: boolean;
  expandable: boolean;
  /** Not expanded, but a remembered recipe means there is a tree folded under it. */
  collapsedBranch: boolean;
  deferredDuplicate: boolean;
  terminalLabel: string;
  showAmounts: boolean;
  rootActions?: RootNodeActionProps;
  /** Node-taking, so the parent passes one stable function rather than a closure per render. */
  onTap: (node: ItemTreeNode) => void;
  onInfo: (node: ItemTreeNode) => void;
  onActions: (node: ItemTreeNode, pointer?: NodeActionPointer) => void;
}) {
  const data = useData();
  const item = data.itemsByKey.get(node.key);
  const name = displayIngredientName(
    item?.n ?? node.key,
    node.tag,
    data.descriptor.minecraftVersion,
  );
  const glyph =
    node.loading
      ? '…'
      : byproductCoverage?.remainingAmount === 0
        ? '↗'
        : deferredDuplicate
          ? '⇥'
          : expandable
          ? '▸'
          : '·';
  const byproductText = byproductCoverage
    ? !showAmounts
      ? byproductCoverage.remainingAmount === 0
        ? '  ✓ byproduct'
        : '  byproduct'
      : byproductCoverage.remainingAmount === 0
        ? `  ✓ ${formatIngredientQuantity(node.key, byproductCoverage.creditedAmount)} byproduct`
        : `  ${formatIngredientQuantity(node.key, byproductCoverage.remainingAmount)} needed · ${formatIngredientQuantity(node.key, byproductCoverage.creditedAmount)} byproduct`
    : '';
  const handleTap = useCallback(() => onTap(node), [node, onTap]);
  const handleActions = useCallback(
    (pointer?: NodeActionPointer) => onActions(node, pointer),
    [node, onActions],
  );
  const handleInfo = useCallback(() => onInfo(node), [node, onInfo]);
  const handlers = useNodeActionHandlers(handleTap, handleActions);
  return (
    <>
      <Pressable
      {...signalTarget(`graph.node.expand.${nodeDepthBucket(node)}`)}
      {...handlers.contextMenuProps}
      onPress={handlers.press}
      onLongPress={handlers.longPress}
      delayLongPress={450}
      accessibilityRole="button"
      accessibilityLabel={`${name}, quantity ${formatIngredientQuantity(node.key, requiredAmount)}${!expandable ? `, ${terminalLabel}` : ''}${deferredDuplicate ? ', recipe expanded elsewhere, tap to move expansion here' : ''}${node.productionProbability !== undefined ? `, ${node.productionProbability == null ? 'unknown' : `${String(Math.round(node.productionProbability * 10_000) / 100)} percent`} produce chance` : ''}${isRoot ? ', open amount and recipe controls' : byproductCoverage ? byproductCoverage.remainingAmount === 0 ? ', completed by byproduct, navigate to producing recipe' : `, partially completed by byproduct, ${formatIngredientQuantity(node.key, byproductCoverage.remainingAmount)} still needed, choose source` : expandable && !deferredDuplicate ? ', choose source' : ''}`}
      style={[
        styles.itemNode,
        {left: x, top: y, width: ITEM_W, height: ITEM_H},
        node.retentionMode === 'durability'
          ? styles.nodeDurabilityTool
          : node.nonConsumed && styles.nodeReusableItem,
        isRecursiveItemNode(node) && styles.nodeCyclic,
        !expandable && !isRecursiveItemNode(node) && styles.nodeTerminal,
        byproductCoverage?.remainingAmount === 0 && styles.nodeByproductComplete,
        byproductCoverage &&
          byproductCoverage.remainingAmount > 0 &&
          styles.nodeByproductPartial,
        collapsedBranch && styles.nodeCollapsedBranch,
        deferredDuplicate && styles.nodeDeferredRecipe,
        isRoot && styles.nodeRoot,
        isRoot && rootActions && styles.rootNodeSelected,
      ]}>
      {isRoot ? (
        <View style={styles.rootItemIconFrame}>
          <ItemIcon item={item} itemKey={node.key} size={32} />
        </View>
      ) : (
        <ItemIcon item={item} itemKey={node.key} size={32} />
      )}
      <View style={{flex: 1, marginLeft: 7}}>
        <Text style={[styles.itemNodeName, noSelect]} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[styles.itemNodeSub, noSelect]} numberOfLines={1}>
          {glyph}
          {showAmounts && shouldShowIngredientQuantity(node.key, requiredAmount)
            ? `  ${formatIngredientQuantity(node.key, requiredAmount)}`
            : ''}
          {isRecursiveItemNode(node) ? '  ↻' : ''}
          {node.retentionMode === 'durability'
            ? `  tool · ${String(node.retentionUses ?? '?')} uses`
            : node.nonConsumed
              ? '  reusable'
              : ''}
          {node.consumptionProbability !== undefined
            ? `  ${node.consumptionProbability == null ? '?' : `${String(Math.round(node.consumptionProbability * 10_000) / 100)}%`} consume`
            : ''}
          {node.productionProbability !== undefined
            ? `  ${node.productionProbability == null ? '?' : `${String(Math.round(node.productionProbability * 10_000) / 100)}%`} produce`
            : ''}
          {byproductText}
        </Text>
      </View>
      <TouchableOpacity
        {...signalTarget(`graph.node.info.${nodeDepthBucket(node)}`)}
        onPress={handleInfo}
        style={styles.infoBtn}
        hitSlop={6}>
        <Text style={[styles.smallBtnText, noSelect]}>ⓘ</Text>
      </TouchableOpacity>
      </Pressable>
      {isRoot && rootActions && (
        <AttachedRootActions
          actions={rootActions}
          nodeX={x}
          nodeY={y}
          nodeWidth={ITEM_W}
          nodeHeight={ITEM_H}
          buttonWidth={ITEM_W}
        />
      )}
    </>
  );
});

/** Expanded item: one node with the item + amount in the header and the source below. */
/**
 * Memoized: panning sets a new transform on every frame, which re-renders the graph, and without
 * this every visible node re-rendered with it -- recipe previews, item chips and all. That cost is
 * per frame rather than per tree, which is why a sixteen-node tree panned as badly as a large one.
 * Every callback prop is node-taking so the parent can pass one stable function; an inline closure
 * here is a new prop each frame and a memo cannot see past it.
 */
const SourceNodeView = React.memo(function SourceNodeView({
  x,
  y,
  w,
  h,
  item,
  requiredAmount,
  byproductCoverage,
  source,
  isRoot,
  radialRoot,
  focused,
  animateMobs,
  showAmounts,
  rootActions,
  canSwap,
  onCollapse,
  onSwap,
  onInfo,
  onActions,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  item: ItemTreeNode;
  requiredAmount: number | null;
  byproductCoverage?: NodeByproductCoverage;
  source: SourceTreeNode;
  isRoot: boolean;
  radialRoot: boolean;
  focused: boolean;
  animateMobs: boolean;
  showAmounts: boolean;
  rootActions?: RootNodeActionProps;
  canSwap: boolean;
  /** Node-taking, so the parent passes one stable function rather than a closure per render. */
  onCollapse: (node: ItemTreeNode) => void;
  onSwap: (node: ItemTreeNode) => void;
  onInfo: (node: ItemTreeNode) => void;
  onActions: (node: ItemTreeNode, pointer?: NodeActionPointer) => void;
}) {
  const data = useData();
  const catalogItem = data.itemsByKey.get(item.key);
  const concreteName = catalogItem?.n ?? item.key;
  const logicalName = displayIngredientName(
    concreteName,
    item.tag,
    data.descriptor.minecraftVersion,
  );
  const name =
    item.tag && logicalName !== concreteName
      ? `${logicalName} · ${concreteName}`
      : concreteName;
  const amountText = formatIngredientQuantity(item.key, requiredAmount);
  const context =
    source.kind === 'recipe'
      ? source.direction === 'outputs'
        ? `Usage · ${source.catTitle ?? 'Recipe'}`
        : source.catTitle
      : source.kind === 'mob'
        ? 'Mob drop'
        : 'Mining';
  const category = source.ref ? data.categories[source.ref[0]] : undefined;
  const machineEstimate =
    source.kind === 'recipe' && source.recipe && item.productionPlan
      ? estimateParallelMachines(
          source.recipe,
          item.key,
          category?.id,
          item.productionPlan,
        )
      : null;
  const machineKey = category?.catalysts[0];
  const emcTransmutation =
    source.kind === 'recipe' && source.recipe
      ? projecteEmcTransmutation(source.recipe)
      : null;
  const machineName = machineKey
    ? data.itemsByKey.get(machineKey)?.n ?? machineKey
    : 'machine';
  const showEmcRecipe = isEmcTransmutationSource(source);
  const sourceCardWidth =
    isRoot && rootActions ? w - ROOT_SOURCE_ACTIONS_WIDTH : w;
  const headerCopy = (
    <View style={styles.sourceHeaderCopy}>
      <View style={styles.sourceHeaderPrimaryRow}>
        <Text style={[styles.sourceHeaderName, noSelect]} numberOfLines={1}>
          {name}
        </Text>
        {showAmounts && (
          <Text style={[styles.sourceHeaderAmount, noSelect]} numberOfLines={1}>
            {' '}{amountText}
          </Text>
        )}
        {byproductCoverage && (
          <Text style={[styles.sourceHeaderByproduct, noSelect]} numberOfLines={1}>
            {' · '}
            {showAmounts
              ? `${formatIngredientQuantity(item.key, byproductCoverage.creditedAmount)} byproduct`
              : 'byproduct'}
          </Text>
        )}
        {showAmounts && machineEstimate && (
          <Text style={[styles.sourceHeaderParallel, noSelect]} numberOfLines={1}>
            {' · '}
            {machineEstimate.machines}× {machineName}
          </Text>
        )}
      </View>
      {context && (
        <Text style={[styles.sourceHeaderContext, noSelect]} numberOfLines={1}>
          {context}
        </Text>
      )}
    </View>
  );
  const handleCollapse = useCallback(() => onCollapse(item), [item, onCollapse]);
  const handleActions = useCallback(
    (pointer?: NodeActionPointer) => onActions(item, pointer),
    [item, onActions],
  );
  const handleSwap = useCallback(() => onSwap(item), [item, onSwap]);
  const handleInfo = useCallback(() => onInfo(item), [item, onInfo]);
  const handlers = useNodeActionHandlers(handleCollapse, handleActions);

  return (
    <Pressable
      {...(isRoot ? signalTarget('graph.root-actions.toggle-expanded') : {})}
      {...handlers.contextMenuProps}
      accessibilityRole={isRoot ? 'button' : undefined}
      accessibilityLabel={
        isRoot
          ? `${rootActions ? 'Close' : 'Open'} amount and recipe controls for ${name}`
          : undefined
      }
      onPress={isRoot ? handlers.press : undefined}
      onLongPress={handlers.longPress}
      delayLongPress={450}
      style={[
        styles.sourceNode,
        {left: x, top: y, width: sourceCardWidth, height: h},
        item.retentionMode === 'durability'
          ? styles.nodeDurabilityTool
          : item.nonConsumed && styles.nodeReusableItem,
        isRecursiveItemNode(item) && styles.nodeCyclic,
        source.inputs.length === 0 && !isRecursiveItemNode(item) && styles.nodeTerminal,
        byproductCoverage?.remainingAmount === 0 && styles.nodeByproductComplete,
        byproductCoverage &&
          byproductCoverage.remainingAmount > 0 &&
          styles.nodeByproductPartial,
        focused && styles.nodeByproductTarget,
        isRoot && !radialRoot && styles.nodeRoot,
        radialRoot && styles.radialExpandedRootNode,
        isRoot && rootActions &&
          (radialRoot ? styles.radialRootSelected : styles.rootNodeSelected),
      ]}>
      <Pressable
        {...signalTarget(`graph.node.collapse.${nodeDepthBucket(item)}`)}
        pointerEvents={isRoot ? 'box-none' : 'auto'}
        accessibilityRole={isRoot ? undefined : 'button'}
        onPress={isRoot ? undefined : handlers.press}
        onLongPress={isRoot ? undefined : handlers.longPress}
        delayLongPress={450}
        // The strip is SOURCE_HEADER tall, well under a finger's worth, and it is the only way to
        // collapse an expanded recipe. Extending the touch area leaves the layout alone, and the
        // swap and info buttons inside it keep their own taps.
        hitSlop={Platform.OS === 'web' ? undefined : {top: 8, bottom: 10, left: 8, right: 8}}
        style={styles.sourceHeader}>
        {isRoot ? (
          <View style={styles.rootSourceIconFrame}>
            <ItemIcon item={catalogItem} itemKey={item.key} size={16} />
          </View>
        ) : (
          <ItemIcon item={catalogItem} itemKey={item.key} size={16} />
        )}
        {headerCopy}
        {canSwap && (
          <TouchableOpacity
            {...signalTarget(`graph.node.swap.${nodeDepthBucket(item)}`)}
            onPress={handleSwap}
            hitSlop={6}
            style={styles.headerBtn}>
            <Text style={[styles.smallBtnText, noSelect]}>⇄</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          {...signalTarget(`graph.node.info.${nodeDepthBucket(item)}`)}
          onPress={handleInfo}
          hitSlop={6}
          style={styles.headerBtn}>
          <Text style={[styles.smallBtnText, noSelect]}>ⓘ</Text>
        </TouchableOpacity>
        <DisclosureChevron expanded color={theme.textDim} size={14} />
      </Pressable>

      {source.kind === 'recipe' && source.recipe?.structure && (
        <MultiblockPreview
          compact
          structure={source.recipe.structure}
          availableWidth={SOURCE_STRUCTURE_PREVIEW_WIDTH}
        />
      )}
      {showEmcRecipe && source.recipe && (
        <View
          accessible
          accessibilityLabel={`${source.catTitle}: EMC converts into ${name}`}
          style={styles.emcRecipePreview}>
          <View style={styles.emcRecipeFlow}>
            {materialInputSummary(source.recipe).map(input => (
              <ItemChip
                key={`emc-input-${input.key}`}
                itemKey={input.key}
                amount={input.amount}
                variableAmount={input.variableAmount}
                variants={input.variants}
                tag={input.tag}
                probability={input.probability}
                probabilityRole="consume"
                interactive={false}
              />
            ))}
            <Text style={[styles.emcRecipeArrow, noSelect]}>→</Text>
            {slotSummary(source.recipe.out).map(output => (
              <ItemChip
                key={`emc-output-${output.key}`}
                itemKey={output.key}
                amount={output.amount}
                variableAmount={output.variableAmount}
                variants={output.variants}
                tag={output.tag}
                probability={output.probability}
                probabilityRole="produce"
                highlight
                interactive={false}
              />
            ))}
          </View>
        </View>
      )}
      {source.kind === 'recipe' &&
        !showEmcRecipe &&
        !source.recipe?.structure &&
        source.recipe?.img &&
        source.dir && (
          <RecipePreviewImage
            uri={data.imageUrl(recipeImagePath(source.dir, source.recipe.img))!}
            backgroundUri={
              source.recipe.bg
                ? data.imageUrl(recipeImagePath(source.dir, source.recipe.bg))
                : undefined
            }
            context={source.recipe.id ?? `${source.dir} graph recipe`}
            style={[
              {
                width: recipeImageDisplay(source.recipe).w,
                height: recipeImageDisplay(source.recipe).h,
                alignSelf: 'center' as const,
              },
              pixelated as object,
            ]}
            resizeMode="contain"
          />
        )}
      {source.kind === 'recipe' &&
        source.recipe &&
        !showEmcRecipe &&
        !source.recipe.structure &&
        emcTransmutation && (
          <ProjecteEmcPreview {...emcTransmutation} />
        )}
      {source.kind === 'recipe' &&
        source.recipe &&
        !source.recipe.structure &&
        !emcTransmutation &&
        (!source.recipe.img || !source.dir) && (
          <Text style={[styles.dropStat, noSelect]}>
            Structured recipe · layout preview unavailable
          </Text>
        )}
      {source.kind === 'mob' && source.mob && (
        <View style={styles.dropRow}>
          <MobSprite mob={source.mob} size={56} animate={animateMobs} />
          <View style={{flex: 1, marginLeft: 6}}>
            <Text style={[styles.dropName, noSelect]} numberOfLines={1}>
              {source.mob.n}
            </Text>
            {source.stat && (
              <Text style={[styles.dropStat, noSelect]}>{formatDropStat(source.stat)}</Text>
            )}
          </View>
        </View>
      )}
      {source.kind === 'block' && source.blockKey && (
        <View style={styles.dropRow}>
          <ItemIcon itemKey={source.blockKey} size={32} />
          <View style={{flex: 1, marginLeft: 8}}>
            <Text style={[styles.dropName, noSelect]} numberOfLines={1}>
              {data.itemsByKey.get(source.blockKey)?.n ?? source.blockKey}
            </Text>
            {source.stat && (
              <Text style={[styles.dropStat, noSelect]}>{formatDropStat(source.stat)}</Text>
            )}
          </View>
        </View>
      )}
      {isRoot && rootActions && (
        <>
          <View
            style={[
              styles.rootSourceAmountStepper,
              {top: Math.max(0, (h - ROOT_AMOUNT_STEPPER_HEIGHT) / 2)},
            ]}>
            <RootAmountStepper {...rootActions} />
          </View>
          <View style={styles.rootSourceActionButtons}>
            <RootActionButtons {...rootActions} />
          </View>
        </>
      )}
    </Pressable>
  );
});

function CtrlBtn({
  label,
  accessibilityLabel,
  metricsId,
  active = false,
  expanded,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  metricsId: string;
  active?: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      {...signalTarget(metricsId)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{selected: active}}
      style={[styles.ctrlBtn, active && styles.ctrlBtnActive]}
      onPress={onPress}>
      <View style={styles.ctrlBtnContent}>
        <Text style={[styles.ctrlBtnText, active && styles.ctrlBtnTextActive]}>{label}</Text>
        {expanded !== undefined && (
          <DisclosureChevron
            expanded={expanded}
            color={active ? theme.accent : theme.text}
            size={13}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  canvas: {flex: 1, overflow: 'hidden', backgroundColor: theme.bg},
  anchor: {position: 'absolute', left: 0, top: 0, width: 0, height: 0},
  nativeAnchor: {width: 1, height: 1},
  lowDetailNode: {
    position: 'absolute',
    minWidth: 16,
    minHeight: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.borderLight,
    borderRadius: 8,
    backgroundColor: theme.panel,
    opacity: 0.78,
  },
  lowDetailSourceNode: {
    borderColor: theme.accent,
    backgroundColor: theme.panelAlt,
  },
  lowDetailRootNode: {
    borderColor: theme.radialRoot,
    borderWidth: 4,
    opacity: 1,
  },
  nodeActionLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 90,
  },
  nodeActionDismiss: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  nodeActionAnchor: {position: 'absolute', zIndex: 91},
  nodeActionCard: {
    padding: 10,
    gap: 9,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 9,
    backgroundColor: theme.panel,
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 8},
    elevation: 20,
    overflow: 'hidden',
  },
  nodeActionHeader: {flexDirection: 'row', alignItems: 'center', gap: 10},
  nodeActionHeaderCopy: {flex: 1},
  nodeActionTitle: {color: theme.text, fontSize: 14, fontWeight: '700'},
  nodeActionHint: {color: theme.textDim, fontSize: 11, marginTop: 2},
  nodeActionAmountSection: {gap: 6},
  nodeActionAmountStepper: {flexDirection: 'row', alignItems: 'center'},
  nodeActionAmountButton: {
    width: 38,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  nodeActionAmountButtonPrimary: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  nodeActionAmountButtonText: {color: theme.text, fontSize: 18, fontWeight: '800'},
  nodeActionAmountButtonPrimaryText: {color: '#0b1610'},
  nodeActionAmountInput: {
    flex: 1,
    height: 34,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    backgroundColor: '#0f141b',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  nodeAlternativeSection: {gap: 7, minHeight: 0, flexShrink: 1},
  nodeActionSectionLabel: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  nodeAlternativeScroll: {maxHeight: 220},
  nodeAlternativeRow: {
    minHeight: 46,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 8,
  },
  nodeAlternativeRowSelected: {backgroundColor: theme.panelAlt},
  nodeAlternativeName: {flex: 1, color: theme.text, fontSize: 13},
  nodeAlternativeSelected: {color: theme.accent, fontSize: 16, fontWeight: '800'},
  nodeActionButtons: {gap: 5},
  nodeActionButton: {
    minHeight: 44,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    backgroundColor: theme.panelAlt,
  },
  nodeActionButtonPrimary: {borderColor: theme.accent, backgroundColor: '#173724'},
  nodeActionButtonDanger: {borderColor: theme.warn},
  nodeActionButtonText: {color: theme.text, fontSize: 13, fontWeight: '700'},
  nodeActionButtonHint: {color: theme.textDim, fontSize: 10, marginTop: 2},
  nodeActionButtonPrimaryText: {color: theme.accent, fontSize: 13, fontWeight: '800'},
  nodeActionButtonPrimaryHint: {color: theme.text, fontSize: 10, marginTop: 2},
  nodeActionButtonDangerText: {color: theme.warn, fontSize: 13, fontWeight: '700'},
  edge: {position: 'absolute', backgroundColor: theme.borderLight},
  byproductSupplyEdge: {
    position: 'absolute',
    borderTopWidth: 2,
    borderTopColor: theme.accentAlt,
    borderStyle: 'dotted',
    opacity: 0.9,
  },
  itemNode: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 8,
  },
  compactItemNode: {
    position: 'absolute',
    width: COMPACT_ITEM_SIZE,
    height: COMPACT_ITEM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
  },
  compactBranchNode: {
    borderColor: theme.accent,
    borderWidth: 2,
    borderRadius: COMPACT_ITEM_SIZE / 2,
  },
  compactRootNode: {
    width: COMPACT_ROOT_SIZE,
    height: COMPACT_ROOT_SIZE,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  radialRootNode: {
    width: RADIAL_ROOT_SIZE,
    height: RADIAL_ROOT_SIZE,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  radialRootDiamond: {
    position: 'absolute',
    width: RADIAL_ROOT_DIAMOND_SIZE,
    height: RADIAL_ROOT_DIAMOND_SIZE,
    borderRadius: 17,
    borderColor: theme.radialRoot,
    borderWidth: 1,
    backgroundColor: theme.radialRootPanel,
    transform: [{rotate: '45deg'}],
  },
  compactRootDiamond: {
    position: 'absolute',
    width: COMPACT_ROOT_DIAMOND_SIZE,
    height: COMPACT_ROOT_DIAMOND_SIZE,
    borderRadius: 12,
    borderColor: theme.radialRoot,
    borderWidth: 1,
    backgroundColor: theme.radialRootPanel,
    transform: [{rotate: '45deg'}],
  },
  radialRootBranchLabel: {
    top: RADIAL_ROOT_SIZE + COMPACT_ROOT_LABEL_GAP,
    left: -(COMPACT_LABEL_WIDTH - RADIAL_ROOT_SIZE) / 2,
  },
  compactRootBranchLabel: {
    top: COMPACT_ROOT_SIZE + COMPACT_ROOT_LABEL_GAP,
    left: -(COMPACT_LABEL_WIDTH - COMPACT_ROOT_SIZE) / 2,
  },
  compactBranchLabel: {
    position: 'absolute',
    top: COMPACT_ITEM_SIZE + 4,
    left: -(COMPACT_LABEL_WIDTH - COMPACT_ITEM_SIZE) / 2,
    width: COMPACT_LABEL_WIDTH,
    alignItems: 'center',
  },
  compactBranchLabelText: {
    color: theme.textDim,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  radialItemNode: {
    position: 'absolute',
    width: RADIAL_ITEM_SIZE,
    height: RADIAL_ITEM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: RADIAL_ITEM_SIZE / 2,
  },
  compactCountBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    minWidth: 19,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    backgroundColor: 'rgba(14,17,22,0.9)',
  },
  compactCountText: {color: theme.text, fontSize: 9, fontWeight: '700'},
  compactRootCountBadge: {
    right: 8,
    bottom: 8,
  },
  radialRootCountBadge: {
    right: 18,
    bottom: 18,
  },
  compactByproductCountBadge: {
    borderColor: theme.accentAlt,
    borderWidth: 1,
    backgroundColor: 'rgba(24,53,88,0.96)',
  },
  compactByproductCountText: {color: theme.accentAlt},
  nodeLoading: {opacity: 0.55},
  nodeRoot: {
    borderColor: theme.radialRoot,
    borderWidth: 1,
    backgroundColor: theme.radialRootPanel,
  },
  rootNodeSelected: {borderWidth: 2},
  radialExpandedRootNode: {
    backgroundColor: theme.radialRootPanel,
    borderColor: theme.radialRoot,
    borderWidth: 1,
    borderRadius: 22,
  },
  radialRootSelected: {borderWidth: 3},
  rootDiamondSelected: {borderWidth: 3},
  nodeReusableItem: {
    borderColor: theme.transfer,
    borderStyle: 'dashed',
    backgroundColor: '#15302f',
  },
  nodeDurabilityTool: {
    borderColor: theme.warn,
    borderStyle: 'dashed',
    backgroundColor: '#332b17',
  },
  /** Has a remembered recipe but is not expanded: something is folded away under it. */
  nodeCollapsedBranch: {
    borderColor: theme.accent,
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: theme.panelAlt,
  },
  nodeCyclic: {borderColor: theme.warn},
  nodeTerminal: {borderColor: theme.textDim, borderWidth: 2},
  nodeByproductComplete: {
    borderColor: theme.accentAlt,
    borderWidth: 2,
  },
  nodeByproductPartial: {
    borderColor: theme.accentAlt,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  nodeByproductTarget: {
    borderColor: theme.accentAlt,
    borderWidth: 3,
  },
  nodeDeferredRecipe: {
    borderColor: theme.transfer,
    borderWidth: 2,
    borderStyle: 'dotted',
  },
  rootItemIconFrame: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rootSourceIconFrame: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemNodeName: {color: theme.text, fontSize: 11, lineHeight: 14},
  itemNodeSub: {color: theme.textDim, fontSize: 10, marginTop: 2},
  infoBtn: {paddingLeft: 4},
  smallBtnText: {color: theme.textDim, fontSize: 12},
  sourceNode: {
    position: 'absolute',
    backgroundColor: theme.panelAlt,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 9,
    padding: 5,
  },
  sourceHeader: {
    height: SOURCE_HEADER - 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  sourceHeaderCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sourceHeaderPrimaryRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  sourceHeaderName: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.text,
    fontSize: 11,
    fontWeight: '600',
  },
  sourceHeaderAmount: {
    flexShrink: 0,
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  sourceHeaderContext: {
    minWidth: 0,
    color: theme.textDim,
    fontSize: 9,
    lineHeight: 10,
    fontWeight: '400',
  },
  sourceHeaderByproduct: {
    flexShrink: 1,
    color: theme.accentAlt,
    fontSize: 11,
    fontWeight: '600',
  },
  sourceHeaderParallel: {
    flexShrink: 1,
    color: theme.warn,
    fontSize: 11,
    fontWeight: '700',
  },
  emcRecipePreview: {
    width: SOURCE_EMC_PREVIEW_WIDTH,
    height: SOURCE_EMC_PREVIEW_HEIGHT,
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 7,
    backgroundColor: '#0f141b',
  },
  emcRecipeFlow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  emcRecipeArrow: {color: theme.textDim, fontSize: 16, fontWeight: '700'},
  headerBtn: {paddingHorizontal: 2},
  dropRow: {flexDirection: 'row', alignItems: 'center', flex: 1, paddingHorizontal: 4},
  dropName: {color: theme.text, fontSize: 12},
  dropStat: {color: theme.textDim, fontSize: 10, marginTop: 2},
  rootSourceAmountStepper: {
    position: 'absolute',
    right: -40,
  },
  rootSourceActionButtons: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
  },
  attachedRootActions: {
    position: 'absolute',
    zIndex: 12,
  },
  attachedRootStepper: {
    position: 'absolute',
  },
  attachedRootButtons: {
    position: 'absolute',
  },
  rootNodeAmountRail: {
    width: 34,
    alignItems: 'center',
    gap: 4,
  },
  rootNodeStepButton: {
    width: 34,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 6,
  },
  rootNodeStepText: {color: theme.radialRoot, fontSize: 17, fontWeight: '700'},
  rootNodeIncreaseButton: {
    backgroundColor: theme.radialRoot,
    borderColor: theme.radialRoot,
  },
  rootNodeIncreaseText: {color: '#0b1610'},
  rootNodeAmountInput: {
    width: 34,
    height: 26,
    backgroundColor: '#0f141b',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 7,
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlign: 'center',
  },
  rootNodeActionButtons: {flex: 1, flexDirection: 'row', gap: 6},
  rootNodeSecondaryAction: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 6,
  },
  rootNodeSecondaryActionText: {color: theme.text, fontSize: 9, fontWeight: '800'},
  rootNodePrimaryAction: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.radialRoot,
    borderRadius: 6,
  },
  rootNodePrimaryActionText: {color: '#0b1610', fontSize: 9, fontWeight: '800'},
  controls: {
    // Anchored as a genuine top bar spanning the available width, not just a top-right corner
    // box -- that width is what lets the options below wrap into extra rows instead of running
    // off the side of a narrow portrait screen.
    position: 'absolute',
    top: CONTROLS_TOP_INSET,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    // Without the inline options beside it, the gear is the row's only child and would otherwise
    // sit against the left edge rather than in the corner a settings control belongs in.
    justifyContent: Platform.OS === 'web' ? 'flex-start' : 'flex-end',
    gap: 6,
  },
  layoutFallbackNotice: {
    position: 'absolute',
    left: BOTTOM_NOTICE_LEFT_INSET,
    right: CANVAS_EDGE_INSET,
    bottom: CANVAS_EDGE_INSET,
    maxWidth: 420,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.warn,
    borderRadius: 8,
    backgroundColor: 'rgba(23,29,38,0.96)',
  },
  layoutFallbackText: {color: theme.warn, fontSize: 10, lineHeight: 14},
  recipeLookupBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,8,12,0.72)',
    padding: 20,
  },
  recipeLookupCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 22,
  },
  recipeLookupTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
  },
  recipeLookupHint: {color: theme.textDim, fontSize: 12, marginTop: 5},
  recipeLookupCancel: {
    minWidth: 120,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.panelAlt,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 18,
    paddingHorizontal: 18,
  },
  recipeLookupCancelText: {color: theme.text, fontSize: 13, fontWeight: '700'},
  controlOptions: {
    // Shrinks and wraps, but does not grow: growing pushed the buttons that follow it to the far
    // side of the canvas, so the bar read as two unrelated groups at opposite edges.
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  /** Overflow for the actions the toggles above no longer keep on the canvas permanently. */
  moreControls: {
    position: 'absolute',
    top: 54,
    left: 10,
    right: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 6,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'rgba(23,29,38,0.97)',
  },
  uniqueModeNotice: {
    position: 'absolute',
    left: BOTTOM_NOTICE_LEFT_INSET,
    right: CANVAS_EDGE_INSET,
    bottom: CANVAS_EDGE_INSET,
    zIndex: 30,
    maxWidth: 390,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: theme.warn,
    borderRadius: 8,
    backgroundColor: 'rgba(23,29,38,0.97)',
  },
  uniqueModeNoticeText: {
    flex: 1,
    color: theme.text,
    fontSize: 10,
    lineHeight: 14,
  },
  uniqueModeNoticeDismiss: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 6,
    backgroundColor: theme.panelAlt,
    borderColor: theme.borderLight,
    borderWidth: 1,
  },
  uniqueModeNoticeDismissText: {color: theme.text, fontSize: 10, fontWeight: '800'},
  treeImportNoticeStacked: {bottom: 76},
  treeImportNoticeTitle: {color: theme.warn, fontWeight: '900'},
  treeImportNoticeActions: {flexDirection: 'row', alignItems: 'center', gap: 6},
  treeImportNoticeDetails: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 6,
    borderColor: theme.warn,
    borderWidth: 1,
  },
  treeImportNoticeDetailsText: {color: theme.warn, fontSize: 10, fontWeight: '800'},
  totalsPanel: {
    position: 'absolute',
    top: 54,
    right: 10,
    width: 360,
    maxWidth: '92%',
    maxHeight: '62%',
    backgroundColor: 'rgba(23,29,38,0.97)',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  totalsTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  totalsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  totalsOption: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  totalsOptionActive: {borderColor: theme.accent, backgroundColor: '#173724'},
  totalsOptionText: {color: theme.textDim, fontSize: 10, fontWeight: '700'},
  totalsOptionTextActive: {color: theme.accent},
  exportActions: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  exportBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 30,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: theme.panelAlt,
    paddingHorizontal: 6,
  },
  exportBtnDisabled: {opacity: 0.55},
  exportBtnText: {color: theme.text, fontSize: 10, fontWeight: '700'},
  exportMessage: {color: theme.textDim, fontSize: 9, paddingHorizontal: 12, paddingTop: 6},
  totalsScroll: {flexShrink: 1},
  totalsContent: {paddingHorizontal: 12, paddingBottom: 10},
  totalsSection: {marginTop: 10},
  totalsSectionTitle: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  totalsEmpty: {color: theme.textDim, fontSize: 11, fontStyle: 'italic'},
  totalRow: {flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30},
  totalName: {color: theme.text, fontSize: 11, flex: 1},
  totalAmount: {color: theme.accent, fontSize: 11, fontWeight: '700'},
  ctrlBtn: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    // 44 on touch platforms is the documented minimum target; the web pointer keeps the denser
    // 36 so the bar does not grow on the surface that never had trouble hitting it.
    height: Platform.OS === 'web' ? 36 : 44,
    paddingHorizontal: 10,
    minWidth: Platform.OS === 'web' ? 40 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnActive: {borderColor: theme.accent, backgroundColor: '#173724'},
  ctrlBtnContent: {flexDirection: 'row', alignItems: 'center', gap: 4},
  ctrlBtnText: {color: theme.text, fontSize: 13},
  ctrlBtnTextActive: {color: theme.accent, fontWeight: '700'},
  controlMenuBtn: {
    width: 38,
    paddingHorizontal: 0,
  },
  controlMenuBtnCollapsed: {
    width: 'auto',
    minWidth: 118,
    paddingHorizontal: 10,
  },
  /** Sits under the controls, on the left, opposite the totals panel. */
  focusChip: {
    position: 'absolute',
    top: 54,
    ...(Platform.OS === 'web'
      ? {right: CANVAS_EDGE_INSET}
      : {left: CANVAS_EDGE_INSET}),
    maxWidth: '70%',
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: Platform.OS === 'web' ? 32 : 44,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: 'rgba(23,29,38,0.97)',
  },
  /** Export results used to be reported inside the totals panel, which no longer exists. */
  exportNotice: {
    position: 'absolute',
    left: BOTTOM_NOTICE_LEFT_INSET,
    right: CANVAS_EDGE_INSET,
    bottom: CANVAS_EDGE_INSET,
    zIndex: 25,
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: Platform.OS === 'web' ? 32 : 44,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: 'rgba(23,29,38,0.97)',
  },
  exportNoticeText: {color: theme.text, fontSize: 11, lineHeight: 15, flex: 1},
  exportNoticeDismiss: {color: theme.textDim, fontSize: 12, fontWeight: '700'},
  settingsGearIcon: {fontSize: 19, lineHeight: 22},
  focusChipText: {color: theme.text, fontSize: 12, fontWeight: '700', flexShrink: 1},
  focusChipClear: {color: theme.accent, fontSize: 11, fontWeight: '700'},
  /** Opposite corner from the fit control, which is the other persistent canvas affordance. */
  minimap: {
    position: 'absolute',
    right: CANVAS_EDGE_INSET,
    bottom: CANVAS_EDGE_INSET,
  },
  fitControl: {
    position: 'absolute',
    left: CANVAS_EDGE_INSET,
    bottom: CANVAS_EDGE_INSET,
    width: FIT_CONTROL_SIZE,
    paddingHorizontal: 0,
  },
  fitControlIcon: {
    fontSize: 21,
    lineHeight: 21,
  },
  emptyWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30},
  emptyTitle: {color: theme.text, fontSize: 17, fontWeight: '700'},
  emptyText: {
    color: theme.textDim,
    textAlign: 'center',
    maxWidth: 440,
    marginTop: 8,
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  emptyBtnText: {color: '#0b2613', fontWeight: '700'},
});

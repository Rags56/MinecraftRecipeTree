import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {InterfaceScaleContext, Modal} from '../ui/nativeUiScale';
import {signalTarget} from '../analytics/signal';
import {useData} from '../data/DataContext';
import {displayIngredientName} from '../data/ingredientTags';
import {formatIngredientQuantity} from '../data/ingredientQuantities';
import {useGraphTotals} from '../graph/GraphTotalsContext';
import {useCatalystItems} from '../graph/catalystItems';
import {NodeActionMenu} from '../graph/NodeActionMenu';
import {
  nodeContextMenuPlacement,
  type NodeContextAnchor,
} from '../graph/nodeContextMenu';
import {findTreeNodeById} from '../graph/treeFocus';
import {
  filterOutlineRows,
  gatherableNodeIdsUnder,
  resourceOutlineRows,
  type ResourceOutlineKind,
  type ResourceOutlineRow,
} from '../graph/resourceOutline';
import {
  loadCompletedResources,
  persistCompletedResources,
  resourceProgressKey,
  countableCompleted,
  gatheredPercentage,
  withResourcesCompleted,
} from '../graph/resourceProgress';
import type {TreeTotal} from '../graph/treeTotals';
import {theme} from '../theme';
import {useUi} from '../ui/UiContext';
import {ItemIcon} from './ItemIcon';

/**
 * The tree's raw materials as a checklist: what it needs, how far through gathering it you are,
 * and a way back into the tree for anything you would rather craft than mine. Tapping a resource
 * opens it in the tree exactly as the old totals panel did; the tick is what this adds.
 */
export function ResourcesScreen({contentZoom = 1}: {contentZoom?: number}) {
  const data = useData();
  const {setTab} = useUi();
  const {snapshot} = useGraphTotals();
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set());

  const rootKey = snapshot?.rootKey ?? null;
  const progressKey = rootKey ? resourceProgressKey(data.descriptor, rootKey) : null;
  useEffect(() => {
    setCompleted(
      rootKey && progressKey ? loadCompletedResources(data.descriptor, rootKey) : new Set(),
    );
    // progressKey is the identity of the list being tracked; the descriptor object behind it is
    // replaced on unrelated context updates and must not reload on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressKey]);

  const [listKind, setListKind] = useState<ResourceOutlineKind>('consumed');
  // Which items the user has moved to the tools list, shared with the tree so the two cannot
  // disagree. Nothing arrives there on its own: a pack saying a recipe keeps an item describes the
  // craft, not how someone wants to shop for it.
  const {catalysts, isCatalyst} = useCatalystItems(data.descriptor, snapshot?.rootKey ?? null);
  const window = useWindowDimensions();
  const interfaceScale = useContext(InterfaceScaleContext);
  const outline = useMemo(
    () =>
      snapshot
        ? resourceOutlineRows(snapshot.root, {
            requiredByNode: snapshot.totals.requiredByNode,
            byproductCoverageByNode: snapshot.totals.byproductCoverageByNode,
            visibleNodeIds: snapshot.visibleNodeIds,
            catalysts,
          })
        : [],
    // version: the tree is edited in place, so its identity alone does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalysts, snapshot, snapshot?.version],
  );
  const rows = useMemo(
    () => filterOutlineRows(outline, listKind, catalysts),
    [catalysts, listKind, outline],
  );
  /**
   * Progress is counted per list. A tool is needed once however much is being built, so counting
   * one machine as far as four hundred ingots would flatter or bury the real work; and a list that
   * ignored tools could read finished while the build still cannot start.
   */
  const gatherableIn = useCallback(
    (kind: ResourceOutlineKind) =>
      snapshot?.root
        ? gatherableNodeIdsUnder(snapshot.root, {
            byproductCoverageByNode: snapshot.totals.byproductCoverageByNode,
            kind,
            catalysts,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version tracks in-place tree edits.
    [catalysts, snapshot, snapshot?.version],
  );
  const catalystNodeIds = useMemo(() => gatherableIn('catalyst'), [gatherableIn]);
  const gatherable = useMemo(
    () => gatherableIn(listKind),
    [gatherableIn, listKind],
  );
  // A tick for something the tree no longer needs stays in storage -- collapsing a branch should
  // not forget it was gathered -- but it cannot count towards a list it is no longer on.
  const countable = useMemo(
    () => countableCompleted(gatherable, completed),
    [completed, gatherable],
  );
  // Icon size is pixel-grid aligned, and constant per render rather than recomputed per row.
  const iconSize = 32 * Math.max(1, Math.round(contentZoom));
  // A lookup can take long enough to look like nothing happened, and the spinner that covers it
  // in the tree is painted on the canvas, which this screen is not showing.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const lookupPending = snapshot?.lookupPending ?? false;
  useEffect(() => {
    if (!lookupPending) setPendingKey(null);
  }, [lookupPending]);
  // The spinner belongs to a lookup that is actually running. Tapping an item with no recipe to
  // find starts none, and a spinner keyed only on the tap would then never have anything to stop
  // it: the row span forever on the one item guaranteed never to load.
  const pendingLookupKey = lookupPending ? pendingKey : null;
  const percentage = gatheredPercentage(gatherable, countable);


  // Deliberately does not switch tabs: choosing a recipe here updates the tree in the background
  // and this list re-reads the totals that come back from it.
  // Held in refs so these keep one identity: the snapshot changes with every tree edit, and
  // handlers that changed with it would re-render every memoized row for a one-row change.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const nodeById = useCallback((nodeId: string) => {
    const current = snapshotRef.current;
    return current ? findTreeNodeById(current.root, nodeId) : null;
  }, []);
  // One collapse, shared with the tree: folding a section here is the same act as folding that
  // node on the canvas, so neither view can disagree with the other about what is open.
  const toggleRow = useCallback(
    (nodeId: string) => {
      const node = nodeById(nodeId);
      if (node) snapshotRef.current?.onToggleNode(node);
    },
    [nodeById],
  );
  // A row with no recipe yet: ask the tree to choose one, which is what the picker is for.
  /**
   * A row's tick covers everything under it: a section is ticked when its whole branch is, and
   * ticking one ticks the branch in a single write rather than a hundred.
   */
  const nodeIdsFor = useCallback(
    (row: ResourceOutlineRow) => {
      const node = nodeById(row.nodeId);
      const coverage = snapshotRef.current?.totals.byproductCoverageByNode;
      // Scoped to the list on screen: ticking a section in Items must not strike off the tools
      // inside it, which are a different list with its own progress.
      return node
        ? gatherableNodeIdsUnder(node, {
            byproductCoverageByNode: coverage,
            kind: listKind,
            catalysts,
          })
        : row.byproductCovered
          ? []
          : [row.nodeId];
    },
    [catalysts, listKind, nodeById],
  );
  const rowState = useCallback(
    (row: ResourceOutlineRow) => {
      const nodeIds = nodeIdsFor(row);
      const ticked = nodeIds.filter(nodeId => completed.has(nodeId)).length;
      return {
        done: nodeIds.length > 0 && ticked === nodeIds.length,
        partial: ticked > 0 && ticked < nodeIds.length,
      };
    },
    [completed, nodeIdsFor],
  );
  const openRow = useCallback(
    (nodeId: string) => {
      const node = nodeById(nodeId);
      if (!node) return;
      setPendingKey(nodeId);
      snapshotRef.current?.onToggleNode(node);
    },
    [nodeById],
  );
  // The tick that is in storage, so a write never depends on a state updater being called exactly
  // once: React may invoke one speculatively or twice, and a save is not something to repeat or
  // guess at.
  const completedRef = useRef(completed);
  completedRef.current = completed;
  const [menuRow, setMenuRow] = useState<{row: ResourceOutlineRow; anchor: NodeContextAnchor} | null>(
    null,
  );
  const openRowMenu = useCallback((row: ResourceOutlineRow, anchor: NodeContextAnchor) => {
    setMenuRow({row, anchor});
  }, []);
  const menuNode = menuRow ? nodeById(menuRow.row.nodeId) : null;
  // Inside a modal the layer fills the window, so the pointer's own coordinates place the card the
  // same way the canvas does. On a phone the modal carries the interface scale itself, so the
  // placement works in the scaled units the card is laid out in.
  const menuPlacement = menuRow
    ? nodeContextMenuPlacement(
        Platform.OS === 'web'
          ? menuRow.anchor
          : {x: menuRow.anchor.x / interfaceScale, y: menuRow.anchor.y / interfaceScale},
        Platform.OS === 'web'
          ? {width: window.width, height: window.height}
          : {width: window.width / interfaceScale, height: window.height / interfaceScale},
        Platform.OS === 'web' ? interfaceScale : 1,
      )
    : null;
  const tickRow = useCallback(
    (row: ResourceOutlineRow, done: boolean) => {
      if (!rootKey) return;
      const next = withResourcesCompleted(completedRef.current, nodeIdsFor(row), !done);
      completedRef.current = next;
      setCompleted(next);
      persistCompletedResources(data.descriptor, rootKey, next);
    },
    [data.descriptor, nodeIdsFor, rootKey],
  );

  const everything = useMemo(
    () => [...gatherableIn('consumed'), ...catalystNodeIds],
    [catalystNodeIds, gatherableIn],
  );
  if (!snapshot || everything.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No resources yet</Text>
        <Text style={styles.emptyText}>
          {snapshot
            ? 'This tree does not need any raw materials yet. Expand a recipe to see what it takes.'
            : 'Open an item’s recipe to start a tree, and everything it needs will be listed here.'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open the tree"
          style={styles.emptyButton}
          onPress={() => setTab('graph')}>
          <Text style={styles.emptyButtonText}>Go to the tree</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rootItem = data.itemsByKey.get(snapshot.rootKey);
  const rootName = rootItem?.n ?? snapshot.rootKey;

  return (
    <View style={styles.screen}>
      <View style={styles.listActions}>
      <TouchableOpacity
        {...signalTarget('resources.use-byproducts')}
        accessibilityRole="switch"
        accessibilityState={{checked: snapshot.useByproducts}}
        accessibilityLabel="Count byproducts against what the tree needs"
        style={[styles.byproducts, snapshot.useByproducts && styles.byproductsOn]}
        onPress={() => snapshot.onUseByproductsChange(!snapshot.useByproducts)}>
        <Text
          style={[
            styles.byproductsText,
            snapshot.useByproducts && styles.byproductsTextOn,
          ]}>
          {snapshot.useByproducts ? '✓ ' : ''}Use byproducts
        </Text>
      </TouchableOpacity>
        <TouchableOpacity
          {...signalTarget('resources.export-csv')}
          accessibilityRole="button"
          accessibilityLabel="Export this list as a spreadsheet"
          style={styles.exportCsv}
          onPress={snapshot.onExportCsv}>
          <Text style={styles.exportCsvText}>Export CSV</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <ItemIcon item={rootItem} itemKey={snapshot.rootKey} size={32} />
        <View style={styles.headerCopy}>
          <View style={styles.rootLine}>
            <Text style={styles.rootName} numberOfLines={1}>
              {rootName}
            </Text>
            {/* What every amount in the list is relative to, so it belongs beside the item. */}
            <Text style={styles.rootAmount}>
              {formatIngredientQuantity(snapshot.rootKey, snapshot.rootAmount)}
            </Text>
          </View>
          {/*
            * A tool is not gathered, it is owned: the tools list is what the build needs you to have
            * rather than a checklist to work through, so it says how many and leaves it there.
            */}
          <Text style={styles.headerDetail}>
            {listKind === 'catalyst'
              ? `${catalystNodeIds.length} needed by this build`
              : `${countable.size} of ${gatherable.length} gathered`}
          </Text>
        </View>
        {listKind === 'consumed' && (
          <Text
            style={styles.percentage}
            accessibilityLabel={`${percentage} percent of materials gathered`}>
            {percentage}%
          </Text>
        )}
      </View>
      {listKind === 'consumed' && (
        <View style={styles.progressTrack} accessibilityRole="progressbar">
          <View style={[styles.progressFill, {width: `${percentage}%`}]} />
        </View>
      )}
      <View style={styles.dashedRule} />
      <View style={styles.listTabs}>
        {(
          [
            ['consumed', 'Items'],
            ['catalyst', 'Catalysts & tools'],
          ] as const
        ).map(([kind, label]) => {
          const nodeIds = kind === 'catalyst' ? catalystNodeIds : gatherableIn('consumed');
          const ticked = nodeIds.filter(nodeId => completed.has(nodeId)).length;
          const selected = listKind === kind;
          // Materials are counted off as they are gathered; tools are counted, full stop.
          const count =
            nodeIds.length === 0
              ? 'none'
              : kind === 'catalyst'
                ? String(nodeIds.length)
                : `${ticked}/${nodeIds.length}`;
          return (
            <TouchableOpacity
              key={kind}
              {...signalTarget(`resources.list.${kind}`)}
              accessibilityRole="tab"
              accessibilityState={{selected}}
              style={[styles.listTab, selected && styles.listTabSelected]}
              onPress={() => setListKind(kind)}>
              <Text style={[styles.listTabText, selected && styles.listTabTextSelected]}>
                {label}
              </Text>
              {/* Each list carries its own count, so neither kind of work hides the other. */}
              <Text style={[styles.listTabCount, selected && styles.listTabCountSelected]}>
                {count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {rows.length === 0 ? (
          // Nothing to say on the tools list: it is empty until the user puts something there, and
          // an explanation of that is not news worth a paragraph every time.
          listKind === 'catalyst' ? null : (
            <Text style={styles.emptyText}>
              {snapshot.visibleNodeIds
                ? 'This branch needs nothing yet. Expand a recipe inside it to see what it takes.'
                : 'Nothing is expanded yet. Choose a recipe for the item above to see what it needs.'}
            </Text>
          )
        ) : (
          rows.map(row => (
            <OutlineRow
              key={row.nodeId}
              tool={catalysts.has(row.nodeId)}
              counts={!catalysts.has(row.nodeId)}
              row={row}
              name={displayIngredientName(
                data.itemsByKey.get(row.key)?.n ?? row.key,
                row.tag,
                data.descriptor.minecraftVersion,
              )}
              iconSize={iconSize}
              done={rowState(row).done}
              partial={rowState(row).partial}
              pending={pendingLookupKey === row.nodeId}
              onToggle={toggleRow}
              onOpen={openRow}
              onTick={tickRow}
              onMenu={openRowMenu}
            />
          ))
        )}
      </ScrollView>
      {menuNode && menuPlacement && (
        // The tree's own menu, not a second one: same card, same gestures, same actions where they
        // mean the same thing. The canvas-only entries are simply not passed.
        <Modal
          visible
          transparent
          animationType="none"
          onRequestClose={() => setMenuRow(null)}>
          <NodeActionMenu
            node={menuNode}
            interfaceZoom={Platform.OS === 'web' ? interfaceScale : 1}
            placement={menuPlacement}
            canSetRecipe
            onClose={() => setMenuRow(null)}
            onSelectAlternative={selectedKey => {
              setMenuRow(null);
              snapshotRef.current?.onSelectAlternative(menuNode, selectedKey);
            }}
            onSetOrChangeRecipe={() => {
              setMenuRow(null);
              setPendingKey(menuNode.id);
              snapshotRef.current?.onChangeRecipe(menuNode);
            }}
            treatAsTool={{
              isTool: isCatalyst(menuNode),
              onPress: () => {
                setMenuRow(null);
                snapshotRef.current?.onTreatAsTool(menuNode, !isCatalyst(menuNode));
              },
            }}
          />
        </Modal>
      )}
    </View>
  );
}

/**
 * Memoized per resource: editing the tree republishes the totals, and without this every row in a
 * list hundreds long re-rendered for a change that touched one of them -- which is what made the
 * icons and positions visibly settle after adding a recipe.
 */
/**
 * One line of the outline. A section carries a disclosure and folds the tree when tapped; a
 * resource carries a tick, because it is the thing someone actually has to go and get.
 */
const OutlineRow = React.memo(function OutlineRow({
  row,
  name,
  iconSize,
  done,
  partial,
  pending,
  tool,
  counts,
  onToggle,
  onOpen,
  onTick,
  onMenu,
}: {
  row: ResourceOutlineRow;
  name: string;
  iconSize: number;
  done: boolean;
  /** Part of this branch is gathered: the tick shows a dash rather than a mark or nothing. */
  partial: boolean;
  pending: boolean;
  /** The user has called this a tool: the same dashed highlight and subheading the canvas gives it. */
  tool: boolean;
  /** Tools are shown among the materials for context, but gathering one is a job on the other list. */
  counts: boolean;
  onToggle: (nodeId: string) => void;
  onOpen: (nodeId: string) => void;
  onTick: (row: ResourceOutlineRow, done: boolean) => void;
  onMenu: (row: ResourceOutlineRow, anchor: NodeContextAnchor) => void;
}) {
  const data = useData();
  const item = data.itemsByKey.get(row.key);
  const section = row.expanded || row.collapsed;
  const amount = formatIngredientQuantity(row.key, row.amount);
  const longPressedRef = useRef(false);
  const contextMenuProps =
    Platform.OS === 'web'
      ? ({
          onContextMenu: (event: {
            preventDefault?: () => void;
            clientX?: number;
            clientY?: number;
          }) => {
            event.preventDefault?.();
            onMenu(row, {x: event.clientX ?? 0, y: event.clientY ?? 0});
          },
        } as object)
      : {};
  return (
    <View
      style={[
        styles.row,
        section && styles.sectionRow,
        tool && styles.toolRow,
        done && styles.rowDone,
        // Indented by depth, which is what makes this read as the tree it came from.
        {marginLeft: row.depth * 18},
      ]}>
      <Pressable
        {...signalTarget(section ? 'resources.toggle-section' : 'resources.open-in-tree')}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${
          row.amount == null ? 'quantity unknown' : amount
        }. ${
          row.expanded
            ? 'Collapse it here and in the tree.'
            : row.collapsed
              ? 'Expand it here and in the tree.'
              : 'Choose a recipe for it.'
        }`}
        style={styles.rowMain}
        delayLongPress={450}
        onLongPress={event => {
          longPressedRef.current = true;
          const touch = event.nativeEvent;
          onMenu(row, {x: touch.pageX, y: touch.pageY});
        }}
        onPress={() => {
          // A long press has already opened the menu; the release must not also act on the row.
          if (longPressedRef.current) {
            longPressedRef.current = false;
            return;
          }
          if (section) onToggle(row.nodeId);
          else onOpen(row.nodeId);
        }}
        {...contextMenuProps}>
        {section ? (
          <Text style={[styles.disclosure, row.expanded && styles.disclosureOpen]}>
            {row.expanded ? '▾' : '▸'}
          </Text>
        ) : (
          <View style={styles.disclosureSpacer} />
        )}
        <ItemIcon item={item} itemKey={row.key} size={iconSize} />
        <View style={styles.rowNameBlock}>
          <Text
            style={[
              styles.rowName,
              section && styles.sectionName,
              done && styles.rowNameDone,
            ]}
            numberOfLines={2}>
            {name}
          </Text>
          {tool && (
            <Text style={styles.toolSub} numberOfLines={1}>
              {row.retentionMode === 'durability'
                ? `tool · ${String(row.retentionUses ?? '?')} uses`
                : 'tool/catalyst'}
            </Text>
          )}
        </View>
        {pending ? (
          <ActivityIndicator color={theme.accent} />
        ) : !counts ? null : (
          <View style={styles.rowAmounts}>
            <Text
              style={[
                styles.rowAmount,
                row.amount == null && styles.rowAmountUnknown,
                row.byproductCovered && styles.rowAmountCovered,
              ]}>
              {amount}
            </Text>
            {row.byproductCredited > 0 && (
              <Text style={styles.byproductNote}>
                {row.byproductCovered
                  ? 'from byproducts'
                  : `${formatIngredientQuantity(row.key, row.byproductCredited)} from byproducts`}
              </Text>
            )}
          </View>
        )}
      </Pressable>
      {counts && (
      <TouchableOpacity
        {...signalTarget(section ? 'resources.toggle-branch' : 'resources.toggle-gathered')}
        accessibilityRole="checkbox"
        accessibilityState={{checked: partial && !done ? 'mixed' : done}}
        accessibilityLabel={
          section
            ? `Mark everything under ${name} as gathered`
            : `Mark ${name} as gathered`
        }
        style={[styles.tick, (done || partial) && styles.tickDone]}
        onPress={() => onTick(row, done)}>
        <Text
          style={[
            styles.tickMark,
            (done || partial) && styles.tickMarkDone,
            partial && styles.tickMarkPartial,
          ]}>
          {done ? '✓' : partial ? '–' : ''}
        </Text>
      </TouchableOpacity>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // Opaque on purpose: inactive workspace panes are absolutely positioned and merely faded out
  // rather than unmounted, so a transparent screen scrolls over whatever is still painted behind
  // it and smears.
  screen: {flex: 1, paddingHorizontal: 12, paddingTop: 12, backgroundColor: theme.bg},
  /** Actions on the whole list, above the tree they belong to. */
  listActions: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10},
  /** Top left, and the same preference the tree toggles: this list is what it changes most. */
  byproducts: {
    alignSelf: 'flex-start',
    minHeight: Platform.OS === 'web' ? 30 : 40,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  exportCsv: {
    marginLeft: 'auto',
    minHeight: Platform.OS === 'web' ? 30 : 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  exportCsvText: {color: theme.accent, fontSize: 12, fontWeight: '700'},
  byproductsOn: {borderColor: theme.accent, backgroundColor: '#173724'},
  byproductsText: {color: theme.textDim, fontSize: 12, fontWeight: '700'},
  byproductsTextOn: {color: theme.accent},
  header: {flexDirection: 'row', alignItems: 'center', gap: 10},
  headerCopy: {flex: 1, minWidth: 0},
  rootLine: {flexDirection: 'row', alignItems: 'baseline', gap: 6},
  rootName: {color: theme.text, fontSize: 16, fontWeight: '700', flexShrink: 1},
  rootAmount: {color: theme.accent, fontSize: 14, fontWeight: '700'},
  headerDetail: {color: theme.textDim, fontSize: 12, marginTop: 2},
  percentage: {color: theme.accent, fontSize: 22, fontWeight: '800'},
  progressTrack: {
    height: 6,
    marginTop: 10,
    borderRadius: 3,
    backgroundColor: theme.panelAlt,
    overflow: 'hidden',
  },
  progressFill: {height: 6, borderRadius: 3, backgroundColor: theme.accent},
  /** The same dashed teal the canvas gives a node the user has called a tool. */
  toolRow: {
    borderColor: theme.transfer,
    borderStyle: 'dashed',
    backgroundColor: '#15302f',
  },
  rowNameBlock: {flex: 1, minWidth: 0},
  toolSub: {color: theme.transfer, fontSize: 10, marginTop: 1},
  listTabs: {flexDirection: 'row', gap: 6, marginBottom: 10},
  listTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: Platform.OS === 'web' ? 32 : 42,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panel,
  },
  listTabSelected: {borderColor: theme.accent, backgroundColor: theme.panelAlt},
  listTabText: {color: theme.textDim, fontSize: 12, fontWeight: '700'},
  listTabTextSelected: {color: theme.text},
  listTabCount: {color: theme.textDim, fontSize: 11},
  listTabCountSelected: {color: theme.accent, fontWeight: '700'},
  /** The divider between the tree being built and the materials it is waiting on. */
  dashedRule: {
    marginVertical: 12,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.borderLight,
  },
  list: {paddingBottom: 24, gap: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panel,
  },
  rowDone: {borderColor: theme.accent, backgroundColor: theme.panelAlt},
  sectionRow: {borderColor: theme.borderLight, backgroundColor: theme.panelAlt},
  sectionName: {color: theme.text, fontWeight: '700'},
  disclosure: {width: 14, color: theme.textDim, fontSize: 13, fontWeight: '700'},
  disclosureOpen: {color: theme.accent},
  disclosureSpacer: {width: 14},
  rowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    paddingVertical: 8,
  },
  rowName: {minWidth: 0, color: theme.text, fontSize: 13, fontWeight: '600'},
  rowNameDone: {color: theme.textDim, textDecorationLine: 'line-through'},
  rowAmount: {color: theme.accent, fontSize: 13, fontWeight: '700'},
  /** ×? means the recipe exported no usable quantity, which is not a number to read as one. */
  rowAmountUnknown: {color: theme.textDim, fontWeight: '600'},
  rowAmounts: {alignItems: 'flex-end'},
  /** Supplied by the tree itself, so it reads as accounted for rather than as still owed. */
  rowAmountCovered: {color: theme.accentAlt, textDecorationLine: 'line-through'},
  byproductNote: {color: theme.accentAlt, fontSize: 9, marginTop: 1},
  tick: {
    width: Platform.OS === 'web' ? 40 : 52,
    alignSelf: 'stretch',
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: theme.border,
  },
  tickDone: {borderLeftColor: theme.accent},
  tickMark: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.borderLight,
    color: theme.accent,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 19,
  },
  tickMarkDone: {borderColor: theme.accent, backgroundColor: '#173724'},
  /** Part gathered: a dash, so "some of this branch" cannot be mistaken for "all of it". */
  tickMarkPartial: {color: theme.textDim, backgroundColor: 'transparent'},
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.bg,
  },
  emptyTitle: {color: theme.text, fontSize: 16, fontWeight: '700'},
  emptyText: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 320,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyButton: {
    minHeight: 44,
    marginTop: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  emptyButtonText: {color: theme.accent, fontSize: 13, fontWeight: '700'},
});

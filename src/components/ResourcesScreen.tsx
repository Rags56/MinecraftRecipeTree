import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {signalTarget} from '../analytics/signal';
import {useData} from '../data/DataContext';
import {displayIngredientName} from '../data/ingredientTags';
import {formatIngredientQuantity} from '../data/ingredientQuantities';
import {useGraphTotals} from '../graph/GraphTotalsContext';
import {
  loadCompletedResources,
  persistCompletedResources,
  prunedCompletedResources,
  resourceCompletionPercentage,
  resourceIdentity,
  sortResourcesForChecklist,
  toggleCompletedResource,
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
  useEffect(() => {
    setCompleted(rootKey ? loadCompletedResources(data.descriptor, rootKey) : new Set());
  }, [data.descriptor, rootKey]);

  const resources = snapshot?.totals.inputs ?? [];
  // A resource that has left the tree keeps its tick in storage -- collapsing a branch should not
  // forget that it was gathered -- but it cannot count towards a list it is no longer on.
  const countable = useMemo(
    () => prunedCompletedResources(resources, completed),
    [completed, resources],
  );
  const sorted = useMemo(() => sortResourcesForChecklist(resources), [resources]);
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
  const percentage = resourceCompletionPercentage(resources, countable);

  const toggle = useCallback(
    (itemKey: string) => {
      if (!rootKey) return;
      setCompleted(current => {
        const next = toggleCompletedResource(current, itemKey);
        persistCompletedResources(data.descriptor, rootKey, next);
        return next;
      });
    },
    [data.descriptor, rootKey],
  );

  // Deliberately does not switch tabs: choosing a recipe here updates the tree in the background
  // and this list re-reads the totals that come back from it.
  // Held in a ref so this keeps one identity: the snapshot changes with every tree edit, and a
  // handler that changed with it would re-render every memoized row for a one-row change.
  const resourceTapRef = useRef(snapshot?.onResourceTap);
  resourceTapRef.current = snapshot?.onResourceTap;
  const openInTree = useCallback((total: TreeTotal) => {
    setPendingKey(total.key);
    resourceTapRef.current?.(total);
  }, []);

  if (!snapshot || resources.length === 0) {
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
      <View style={styles.header}>
        <ItemIcon item={rootItem} itemKey={snapshot.rootKey} size={32} />
        <View style={styles.headerCopy}>
          <Text style={styles.rootName} numberOfLines={1}>
            {rootName}
          </Text>
          <Text style={styles.headerDetail}>
            {countable.size} of {resources.length} gathered
          </Text>
        </View>
        <Text
          style={styles.percentage}
          accessibilityLabel={`${percentage} percent of resources gathered`}>
          {percentage}%
        </Text>
      </View>
      <View style={styles.progressTrack} accessibilityRole="progressbar">
        <View style={[styles.progressFill, {width: `${percentage}%`}]} />
      </View>
      <View style={styles.dashedRule} />
      <ScrollView contentContainerStyle={styles.list}>
        {sorted.map(total => (
          <ResourceRow
            key={resourceIdentity(total)}
            total={total}
            name={displayIngredientName(
              data.itemsByKey.get(total.key)?.n ?? total.key,
              total.tag,
              data.descriptor.minecraftVersion,
            )}
            iconSize={iconSize}
            done={countable.has(resourceIdentity(total))}
            pending={pendingLookupKey === resourceIdentity(total)}
            onOpen={openInTree}
            onToggle={toggle}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Memoized per resource: editing the tree republishes the totals, and without this every row in a
 * list hundreds long re-rendered for a change that touched one of them -- which is what made the
 * icons and positions visibly settle after adding a recipe.
 */
const ResourceRow = React.memo(function ResourceRow({
  total,
  name,
  iconSize,
  done,
  pending,
  onOpen,
  onToggle,
}: {
  total: TreeTotal;
  name: string;
  iconSize: number;
  done: boolean;
  pending: boolean;
  onOpen: (total: TreeTotal) => void;
  onToggle: (itemKey: string) => void;
}) {
  const data = useData();
  const item = data.itemsByKey.get(total.key);
  return (
    <View style={[styles.row, done && styles.rowDone]}>
      <TouchableOpacity
        {...signalTarget('resources.open-in-tree')}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${
          total.amount == null
            ? 'quantity unknown'
            : formatIngredientQuantity(total.key, total.amount)
        }. Open in the tree.`}
        style={styles.rowMain}
        onPress={() => onOpen(total)}>
        <ItemIcon item={item} itemKey={total.key} size={iconSize} />
        <Text style={[styles.rowName, done && styles.rowNameDone]} numberOfLines={2}>
          {name}
        </Text>
        {pending ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Text style={[styles.rowAmount, total.amount == null && styles.rowAmountUnknown]}>
            {formatIngredientQuantity(total.key, total.amount)}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        {...signalTarget('resources.toggle-gathered')}
        accessibilityRole="checkbox"
        accessibilityState={{checked: done}}
        accessibilityLabel={`Mark ${name} as gathered`}
        style={[styles.tick, done && styles.tickDone]}
        onPress={() => onToggle(resourceIdentity(total))}>
        <Text style={[styles.tickMark, done && styles.tickMarkDone]}>{done ? '✓' : ''}</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  // Opaque on purpose: inactive workspace panes are absolutely positioned and merely faded out
  // rather than unmounted, so a transparent screen scrolls over whatever is still painted behind
  // it and smears.
  screen: {flex: 1, paddingHorizontal: 12, paddingTop: 12, backgroundColor: theme.bg},
  /** Top left, and the same preference the tree toggles: this list is what it changes most. */
  byproducts: {
    alignSelf: 'flex-start',
    minHeight: Platform.OS === 'web' ? 30 : 40,
    justifyContent: 'center',
    marginBottom: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  byproductsOn: {borderColor: theme.accent, backgroundColor: '#173724'},
  byproductsText: {color: theme.textDim, fontSize: 12, fontWeight: '700'},
  byproductsTextOn: {color: theme.accent},
  header: {flexDirection: 'row', alignItems: 'center', gap: 10},
  headerCopy: {flex: 1, minWidth: 0},
  rootName: {color: theme.text, fontSize: 16, fontWeight: '700'},
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
  rowName: {flex: 1, minWidth: 0, color: theme.text, fontSize: 13, fontWeight: '600'},
  rowNameDone: {color: theme.textDim, textDecorationLine: 'line-through'},
  rowAmount: {color: theme.accent, fontSize: 13, fontWeight: '700'},
  /** ×? means the recipe exported no usable quantity, which is not a number to read as one. */
  rowAmountUnknown: {color: theme.textDim, fontWeight: '600'},
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

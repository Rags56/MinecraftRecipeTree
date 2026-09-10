import {Modal} from '../ui/nativeUiScale';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from '../ui/safeArea';
import {useData} from '../data/DataContext';
import {
  AUTOMATED_SHAPED_CATEGORY_ID,
  compareRecipeCategories,
  GTNH_BETTERQUESTING_INFORMATION_CATEGORY_ID,
  isDefaultDisabledRecipeCategory,
} from '../data/recipeCategories';
import {
  loadCollapsedRecipeCategories,
  persistCollapsedRecipeCategories,
  toggleCollapsedRecipeCategory,
} from '../data/recipeCategoryPreferences';
import {useRecipeStages} from '../data/RecipeStageContext';
import {isRecipeVisibleForStages, recipeStageLabel} from '../data/recipeStages';
import {
  isFluidContainerTransferRecipe,
  isRedundantFluidContainerRecipe,
} from '../data/recipeVisibility';
import {
  PROJECTE_EMC_CATEGORY_ID,
  projecteEmcValue,
} from '../data/projecteEmc';
import {formatIngredientQuantity} from '../data/ingredientQuantities';
import {
  recipeProducesItem,
  recipeUsesItem,
  usageGraphStart,
} from '../graph/direction';
import type {GraphDirection} from '../graph/direction';
import {theme} from '../theme';
import {Recipe, RecipeRef} from '../types';
import {useUi} from '../ui/UiContext';
import {signalTarget, useSignalSurface} from '../analytics/signal';
import {DropList, DropRow, formatDropStat} from './DropList';
import {ItemIcon} from './ItemIcon';
import {MobSprite} from './MobSprite';
import {ItemChip, RecipeCard} from './RecipeCard';
import {VisibilityIcon} from './VisibilityIcon';
import {DisclosureChevron} from './DisclosureChevron';
import {ContentZoomControl} from './ContentZoomControl';

const PAGE = 15;
const MAX_DEFAULT_FILTER_SCAN = 400;
const INITIAL_VISIBLE_CATEGORY_TYPES = 8;

function recipeRefKey([categoryIndex, recipeIndex]: RecipeRef): string {
  return `${categoryIndex}:${recipeIndex}`;
}

function toolLabel(tool: string): string {
  return tool === 'hand' ? 'bare hand' : tool.split(':').pop()!.replace(/_/g, ' ');
}

export function ItemDetailModal({
  interfaceZoom = 1,
  contentZoom = 1,
  onContentZoomChange,
  onContentZoomComplete,
}: {
  interfaceZoom?: number;
  contentZoom?: number;
  onContentZoomChange?: (value: number) => void;
  onContentZoomComplete?: (value: number) => void;
}) {
  const data = useData();
  const {itemStack, popItem, closeItems, tab} = useUi();
  const safeAreaInsets = useSafeAreaInsets();
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: 760 / interfaceZoom,
          maxHeight: `${88 / interfaceZoom}%`,
        } as unknown as object)
      : null;
  const key = itemStack[itemStack.length - 1];
  const itemDetailVisible = Boolean(key) && (Platform.OS === 'web' || tab === 'items');
  const canGoBack = itemStack.length > 1 || tab === 'graph';
  /** 'p' | 'u' | 'i' | 'd' | a secondary category index */
  const [side, setSide] = useState<'p' | 'u' | 'i' | 'd' | number>('p');
  const sideName =
    side === 'p'
      ? 'recipes'
      : side === 'u'
        ? 'usages'
        : side === 'i'
          ? 'information'
          : side === 'd'
            ? 'drops'
            : 'secondary';
  useSignalSurface(
    itemDetailVisible ? `item-detail/${sideName}` : tab,
    itemDetailVisible ? 'modal' : 'screen',
  );

  useEffect(() => setSide('p'), [key]);
  useEffect(() => {
    if (!key || data.indexStatus === 'ready' || data.indexStatus === 'loading') return;
    void data.ensureIndex().catch(() => {
      // DataContext logs transport and validation detail and exposes the error below.
    });
  }, [data, key]);

  if (!key) return null;
  if (data.indexStatus !== 'ready') {
    return (
      <Modal
        visible={itemDetailVisible}
        transparent
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        onRequestClose={popItem}>
        <Pressable
          style={[styles.backdrop, Platform.OS !== 'web' && styles.backdropNative]}
          onPress={closeItems}>
          <Pressable
            style={[
              styles.card,
              scaledCardStyle,
              Platform.OS !== 'web' && styles.cardNative,
              Platform.OS !== 'web' && {paddingBottom: Math.max(14, safeAreaInsets.bottom)},
              {alignItems: 'center', justifyContent: 'center'},
            ]}
            onPress={() => {}}>
            {data.indexStatus !== 'error' && <ActivityIndicator color={theme.accent} size="large" />}
            <Text style={data.indexStatus === 'error' ? styles.indexError : styles.emptyText}>
              {data.indexStatus === 'error'
                ? `Recipe index unavailable: ${data.indexError ?? 'unknown error'}`
                : 'Loading recipe index…'}
            </Text>
            <View style={styles.lookupActions}>
              {data.indexStatus === 'error' && (
                <TouchableOpacity
                  {...signalTarget('item-detail.retry-index')}
                  style={styles.lookupSecondaryButton}
                  onPress={() => void data.ensureIndex().catch(() => {})}>
                  <Text style={styles.lookupSecondaryButtonText}>Retry</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                {...signalTarget('item-detail.cancel-index')}
                accessibilityRole="button"
                accessibilityLabel="Cancel recipe lookup"
                style={styles.lookupCancelButton}
                onPress={popItem}>
                <Text style={styles.lookupCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }
  const item = data.itemsByKey.get(key);
  const entry = data.index[key];
  const visible = (refs?: RecipeRef[]) =>
    (refs ?? []).filter(r => !data.metaCategories.has(r[0]));
  const produced = visible(entry?.p).filter(r => !data.secondaryCategories.has(r[0]));
  const used = visible(entry?.u).filter(r => !data.secondaryCategories.has(r[0]));
  const informationalByKey = new Map<string, RecipeRef>();
  for (const ref of [...(entry?.p ?? []), ...(entry?.u ?? [])]) {
    if (data.metaCategories.has(ref[0])) informationalByKey.set(recipeRefKey(ref), ref);
  }
  const informational = [...informationalByKey.values()];
  // Secondary categories (anvil, smithing, trading): a repair/trade both "produces"
  // and "uses" the item — merge produced+used per category and dedupe.
  const secondarySeen = new Set<string>();
  const secondaryByCat = new Map<number, RecipeRef[]>();
  for (const r of [...visible(entry?.p), ...visible(entry?.u)]) {
    if (!data.secondaryCategories.has(r[0])) continue;
    const k = `${r[0]}:${r[1]}`;
    if (secondarySeen.has(k)) continue;
    secondarySeen.add(k);
    const list = secondaryByCat.get(r[0]) ?? [];
    list.push(r);
    secondaryByCat.set(r[0], list);
  }
  const secondaryGroups = [...secondaryByCat.entries()]
    .map(([catIdx, groupRefs]) => ({
      catIdx,
      title: data.categories[catIdx]?.title ?? 'Other',
      refs: groupRefs,
    }))
    .sort((a, b) => a.catIdx - b.catIdx);
  const refs =
    side === 'p'
      ? produced
      : side === 'u'
        ? used
        : side === 'i'
          ? informational
          : typeof side === 'number'
            ? secondaryGroups.find(g => g.catIdx === side)?.refs ?? []
            : [];

  const blockDrop = data.blockDrops[key];
  const droppedBy = data.droppedByMobs.get(key) ?? [];
  const minedFrom = data.minedFrom.get(key) ?? [];
  const dropsCount = (blockDrop ? blockDrop.drops.length + (blockDrop.silk?.length ?? 0) : 0)
    + droppedBy.length + minedFrom.length;

  return (
    <Modal
      visible={itemDetailVisible}
      transparent
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      onRequestClose={popItem}>
      <Pressable
        style={[styles.backdrop, Platform.OS !== 'web' && styles.backdropNative]}
        onPress={closeItems}>
        <Pressable
          style={[
            styles.card,
            scaledCardStyle,
            Platform.OS !== 'web' && styles.cardNative,
            Platform.OS !== 'web' && {paddingBottom: Math.max(14, safeAreaInsets.bottom)},
          ]}
          onPress={() => {}}>
          <View style={styles.header}>
            {canGoBack && (
              <TouchableOpacity
                {...signalTarget('item-detail.back')}
                accessibilityRole="button"
                accessibilityLabel="Back to recipe viewer"
                onPress={popItem}
                style={styles.headerBtn}>
                <Text style={styles.headerBtnText}>‹ Back</Text>
              </TouchableOpacity>
            )}
            <View style={{flex: 1}} />
            <TouchableOpacity
              {...signalTarget('item-detail.close')}
              onPress={closeItems}
              style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.titleRow}>
            <ItemIcon item={item} itemKey={key} size={48} />
            <View style={{flex: 1, marginLeft: 12}}>
              <Text style={styles.title}>{item?.n ?? key}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {item?.id ?? key} · {data.manifest.mods?.[item?.m ?? ''] ?? item?.m ?? '?'}
                {item?.t ? ` · ${item.t}` : ''}
              </Text>
            </View>
          </View>

          <ItemEmcValue itemKey={key} producedRefs={entry?.p ?? []} />

          {Platform.OS === 'web' && onContentZoomChange ? (
            <ContentZoomControl
              value={contentZoom}
              onValueChange={onContentZoomChange}
              onSlidingComplete={onContentZoomComplete}
              testID="item-detail-content-zoom-slider"
              style={styles.contentZoomControl}
            />
          ) : null}

          <View style={styles.tabsRow}>
            <SideTab metricsId="item-detail.tab.recipes" label={`Recipes (${produced.length})`} active={side === 'p'} onPress={() => setSide('p')} />
            <SideTab metricsId="item-detail.tab.usages" label={`Usages (${used.length})`} active={side === 'u'} onPress={() => setSide('u')} />
            {informational.length > 0 && (
              <SideTab
                metricsId="item-detail.tab.information"
                label={`Info (${informational.length})`}
                active={side === 'i'}
                onPress={() => setSide('i')}
              />
            )}
            {secondaryGroups.map(g => (
              <SideTab
                key={g.catIdx}
                metricsId="item-detail.tab.secondary"
                label={`${g.title} (${g.refs.length})`}
                active={side === g.catIdx}
                onPress={() => setSide(g.catIdx)}
              />
            ))}
            {dropsCount > 0 && (
              <SideTab metricsId="item-detail.tab.drops" label={`Drops (${dropsCount})`} active={side === 'd'} onPress={() => setSide('d')} />
            )}
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{paddingBottom: 16}}>
            {side === 'd' ? (
              <View>
                {blockDrop && (
                  <DropList
                    title={`Breaking this block drops (${toolLabel(blockDrop.tool)})`}
                    drops={blockDrop.drops}
                  />
                )}
                {blockDrop?.silk && <DropList title="With silk touch" drops={blockDrop.silk} />}
                {droppedBy.length > 0 && (
                  <View style={styles.dropSection}>
                    <Text style={styles.dropTitle}>Dropped by mobs</Text>
                    {droppedBy.map(({mob, stat}) => (
                      <View key={mob.id} style={styles.mobRow}>
                        <View style={styles.mobChip}>
                          <MobSprite mob={mob} size={26} animate={false} />
                          <Text style={styles.mobName} numberOfLines={1}>
                            {mob.n}
                          </Text>
                        </View>
                        <Text style={styles.mobStat}>{formatDropStat(stat)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {minedFrom.length > 0 && (
                  <View style={styles.dropSection}>
                    <Text style={styles.dropTitle}>Mined from</Text>
                    {minedFrom.slice(0, 40).map(({blockKey, stat}) => (
                      <View key={blockKey} style={styles.mobRow}>
                        <ItemChip itemKey={blockKey} />
                        <Text style={styles.mobStat}>{formatDropStat(stat)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : refs.length === 0 ? (
              <Text style={styles.emptyText}>
                {side === 'p' ? 'Nothing crafts this item.' : side === 'u' ? 'Not used in any recipe.' : 'Nothing here.'}
              </Text>
            ) : (
              <RefsList
                key={`${key}:${side}`}
                itemKey={key}
                refs={refs}
                informational={side === 'i'}
                graphDirection={side === 'u' ? 'outputs' : 'inputs'}
                interfaceZoom={interfaceZoom}
                contentZoom={contentZoom}
              />
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ItemEmcValue({
  itemKey,
  producedRefs,
}: {
  itemKey: string;
  producedRefs: RecipeRef[];
}) {
  const data = useData();
  const emcRef = producedRefs.find(
    ([categoryIndex]) =>
      data.categories[categoryIndex]?.id === PROJECTE_EMC_CATEGORY_ID,
  );
  const cachedRecipe = emcRef ? data.getCachedRecipe(emcRef) : undefined;
  const [emcValue, setEmcValue] = useState<number | null>(() =>
    cachedRecipe ? projecteEmcValue(cachedRecipe, itemKey) : null,
  );

  useEffect(() => {
    let alive = true;
    setEmcValue(cachedRecipe ? projecteEmcValue(cachedRecipe, itemKey) : null);
    if (!emcRef || cachedRecipe) return () => { alive = false; };
    void data.getRecipes([emcRef]).then(
      ([recipe]) => {
        if (!alive) return;
        const value = projecteEmcValue(recipe, itemKey);
        if (value == null) {
          console.error('The ProjectE EMC recipe does not contain its expected value.', {
            itemKey,
            recipeRef: emcRef,
            recipeId: recipe.id,
          });
          return;
        }
        setEmcValue(value);
      },
      error => {
        console.error('The ProjectE EMC value could not be loaded for the item header.', {
          itemKey,
          recipeRef: emcRef,
          error,
        });
      },
    );
    return () => { alive = false; };
  }, [cachedRecipe, data, itemKey, emcRef?.[0], emcRef?.[1]]);

  if (emcValue == null) return null;
  return (
    <View style={styles.emcRow} accessibilityLabel={`EMC value ${emcValue}`}>
      <Text style={styles.emcLabel}>EMC VALUE</Text>
      <Text style={styles.emcValue}>
        {formatIngredientQuantity('emc|projecte:emc', emcValue)}
      </Text>
    </View>
  );
}

function SideTab({
  label,
  active,
  onPress,
  metricsId,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  metricsId: string;
}) {
  return (
    <TouchableOpacity
      {...signalTarget(metricsId)}
      onPress={onPress}
      style={[styles.sideTab, active && styles.sideTabActive]}>
      <Text style={[styles.sideTabText, active && styles.sideTabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Loads only the bounded recipe shards containing the currently visible references. */
function RefsList({
  itemKey,
  refs,
  informational = false,
  graphDirection,
  interfaceZoom,
  contentZoom,
}: {
  itemKey: string;
  refs: RecipeRef[];
  informational?: boolean;
  graphDirection: GraphDirection;
  interfaceZoom: number;
  contentZoom: number;
}) {
  const data = useData();
  const {
    hiddenStages: hiddenRecipeStages,
    toggleStage: toggleRecipeStage,
  } = useRecipeStages();
  const {openRecipeInGraph} = useUi();
  const [visibleTarget, setVisibleTarget] = useState(PAGE);
  const [scanLimit, setScanLimit] = useState(PAGE);
  const [showAllCollapsedCategoryTypes, setShowAllCollapsedCategoryTypes] = useState(false);
  const [showAutomatedShaped, setShowAutomatedShaped] = useState(false);
  const [showFluidTransfers, setShowFluidTransfers] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState(
    loadCollapsedRecipeCategories,
  );
  const [recipesByRef, setRecipesByRef] = useState<Map<string, Recipe>>(() => new Map());
  const [availableCardWidth, setAvailableCardWidth] = useState<number | null>(null);
  const isolatedRecipeStyle =
    Platform.OS === 'web'
      ? ({zoom: 1 / interfaceZoom} as unknown as object)
      : null;
  const recipeForRef = useCallback(
    (ref: RecipeRef) =>
      recipesByRef.get(recipeRefKey(ref)) ?? data.getCachedRecipe(ref),
    [data, recipesByRef],
  );

  const categoryGroups = useMemo(() => {
    const counts = new Map<number, number>();
    refs.forEach(([catIdx]) => {
      const current = counts.get(catIdx);
      counts.set(catIdx, (current ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([catIdx, count]) => ({
        catIdx,
        count,
        category: data.categories[catIdx],
      }))
      .filter(group => Boolean(group.category))
      .sort((a, b) => compareRecipeCategories(a.category!, b.category!));
  }, [refs, data.categories]);
  const automatedShapedCount =
    categoryGroups.find(group => group.category?.id === AUTOMATED_SHAPED_CATEGORY_ID)?.count ?? 0;
  const hasBetterQuestingPages = categoryGroups.some(
    group => group.category?.id === GTNH_BETTERQUESTING_INFORMATION_CATEGORY_ID,
  );
  const visibleCategoryGroups = categoryGroups.filter(
    group => showAutomatedShaped || !isDefaultDisabledRecipeCategory(group.category),
  );
  const collapsedCategoryGroups = visibleCategoryGroups.filter(group =>
    collapsedCategoryIds.has(group.category!.id),
  );
  const displayedCollapsedCategoryGroups = useMemo(() => {
    if (
      showAllCollapsedCategoryTypes ||
      collapsedCategoryGroups.length <= INITIAL_VISIBLE_CATEGORY_TYPES
    ) {
      return collapsedCategoryGroups;
    }
    return collapsedCategoryGroups.slice(0, INITIAL_VISIBLE_CATEGORY_TYPES);
  }, [collapsedCategoryGroups, showAllCollapsedCategoryTypes]);
  const undisplayedCollapsedCategoryCount =
    collapsedCategoryGroups.length - displayedCollapsedCategoryGroups.length;
  const eligibleRefs = useMemo(
    () =>
      refs.filter(([catIdx]) => {
        const category = data.categories[catIdx];
        if (!showAutomatedShaped && isDefaultDisabledRecipeCategory(category)) return false;
        return true;
      }),
    [refs, data.categories, showAutomatedShaped],
  );
  const filteredRefs = useMemo(() => {
    const expanded = eligibleRefs.filter(([catIdx]) => {
      const category = data.categories[catIdx];
      return category ? !collapsedCategoryIds.has(category.id) : false;
    });
    return [...expanded].sort(([aCat, aRecipe], [bCat, bRecipe]) => {
      const a = data.categories[aCat];
      const b = data.categories[bCat];
      if (!a || !b) return aCat - bCat || aRecipe - bRecipe;
      return compareRecipeCategories(a, b) || aRecipe - bRecipe;
    });
  }, [eligibleRefs, data.categories, collapsedCategoryIds]);
  const refsToLoad = useMemo(
    () =>
      filteredRefs.slice(
        0,
        informational || showFluidTransfers
          ? visibleTarget
          : Math.min(scanLimit, MAX_DEFAULT_FILTER_SCAN),
      ),
    [filteredRefs, informational, showFluidTransfers, visibleTarget, scanLimit],
  );
  const loadedScan = refsToLoad.every(ref => Boolean(recipeForRef(ref)));
  const recipeStageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ref of refsToLoad) {
      const stage = recipeForRef(ref)?.stage;
      if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [refsToLoad, recipeForRef]);
  const visibleCandidates = useMemo(
    () =>
      refsToLoad.filter(ref => {
        const recipe = recipeForRef(ref);
        return (
          isRecipeVisibleForStages(recipe, hiddenRecipeStages) &&
          !isRedundantFluidContainerRecipe(recipe, data.itemsByKey) &&
          (informational ||
            showFluidTransfers ||
            !isFluidContainerTransferRecipe(
              recipe,
              data.itemsByKey,
              data.categories[ref[0]],
            ))
        );
      }),
    [
      refsToLoad,
      recipeForRef,
      hiddenRecipeStages,
      informational,
      showFluidTransfers,
      data.itemsByKey,
      data.categories,
    ],
  );
  const shown = visibleCandidates.slice(0, visibleTarget);
  const shownByCategory = useMemo(() => {
    const grouped = new Map<number, RecipeRef[]>();
    for (const ref of shown) {
      const categoryRefs = grouped.get(ref[0]) ?? [];
      categoryRefs.push(ref);
      grouped.set(ref[0], categoryRefs);
    }
    return grouped;
  }, [shown]);
  const sectionGroups = useMemo(
    () =>
      visibleCategoryGroups.filter(
        group =>
          !collapsedCategoryIds.has(group.category!.id) &&
          shownByCategory.has(group.catIdx),
      ),
    [visibleCategoryGroups, collapsedCategoryIds, shownByCategory],
  );
  const hiddenFluidTransferCount = refsToLoad.reduce((count, ref) => {
    const recipe = recipeForRef(ref);
    return count +
      (!informational &&
        recipe &&
        !isRedundantFluidContainerRecipe(recipe, data.itemsByKey) &&
        isFluidContainerTransferRecipe(recipe, data.itemsByKey, data.categories[ref[0]])
        ? 1
        : 0);
  }, 0);
  const hiddenRecipeStageCount = refsToLoad.reduce((count, ref) => {
    const stage = recipeForRef(ref)?.stage;
    return count + (stage && hiddenRecipeStages.has(stage) ? 1 : 0);
  }, 0);
  const defaultScanMaximum = Math.min(filteredRefs.length, MAX_DEFAULT_FILTER_SCAN);
  const scannedAll = scanLimit >= defaultScanMaximum;
  const scanCapped =
    !informational &&
    !showFluidTransfers &&
    filteredRefs.length > MAX_DEFAULT_FILTER_SCAN &&
    scanLimit >= MAX_DEFAULT_FILTER_SCAN;
  const fillingVisiblePage =
    !informational &&
    !showFluidTransfers &&
    !scannedAll &&
    visibleCandidates.length < visibleTarget;
  const loadingVisiblePage =
    (refsToLoad.length > 0 && !loadedScan) || fillingVisiblePage;

  useEffect(() => {
    setVisibleTarget(PAGE);
    setScanLimit(PAGE);
  }, [
    showAutomatedShaped,
    showFluidTransfers,
    collapsedCategoryIds,
    hiddenRecipeStages,
  ]);

  const toggleCategory = useCallback((categoryId: string) => {
    setCollapsedCategoryIds(current => {
      const next = toggleCollapsedRecipeCategory(current, categoryId);
      persistCollapsedRecipeCategories(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (
      showFluidTransfers ||
      informational ||
      !loadedScan ||
      visibleCandidates.length >= visibleTarget ||
      scanLimit >= defaultScanMaximum
    ) {
      return;
    }
    setScanLimit(limit => Math.min(defaultScanMaximum, limit + PAGE));
  }, [
    defaultScanMaximum,
    loadedScan,
    scanLimit,
    showFluidTransfers,
    informational,
    visibleCandidates.length,
    visibleTarget,
  ]);

  useEffect(() => {
    if (!scanCapped || !loadedScan) return;
    console.warn('Item recipe filtering reached its bounded scan limit.', {
      scannedRecipeCount: MAX_DEFAULT_FILTER_SCAN,
      totalRecipeReferences: filteredRefs.length,
    });
  }, [filteredRefs.length, loadedScan, scanCapped]);

  // Retain resolved cards across pagination/filter changes, while the data layer keeps the
  // underlying parsed-shard cache bounded.
  useEffect(() => {
    const missing = refsToLoad.filter(ref => !recipeForRef(ref));
    if (missing.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const loaded = await data.getRecipes(missing);
        if (!alive) return;
        setRecipesByRef(prev => {
          const next = new Map(prev);
          missing.forEach((ref, index) => next.set(recipeRefKey(ref), loaded[index]));
          return next;
        });
      } catch (error) {
        console.error('The visible recipe references could not be displayed.', error);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refsToLoad, recipeForRef, data]);

  const showRecipeFilters =
    informational ||
    graphDirection === 'outputs' ||
    collapsedCategoryGroups.length > 0 ||
    automatedShapedCount > 0 ||
    recipeStageCounts.length > 0 ||
    showFluidTransfers ||
    hiddenFluidTransferCount > 0;

  return (
    <View
      style={styles.recipeList}
      onLayout={event => {
        const measuredWidth = Math.floor(event.nativeEvent.layout.width);
        if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
          console.error('Recipe list reported an invalid available width.', {measuredWidth});
          return;
        }
        setAvailableCardWidth(current =>
          current === measuredWidth ? current : measuredWidth,
        );
      }}>
      {showRecipeFilters && <View style={styles.recipeFilters}>
        {!informational && graphDirection === 'outputs' && (
          <Text style={styles.usageTreeNotice}>
            Tap a usage to trace what {data.itemsByKey.get(itemKey)?.n ?? itemKey} can produce.
          </Text>
        )}
        {informational && (
          <Text style={styles.informationNotice}>
            {hasBetterQuestingPages
              ? 'Quest pages preserve flattened item associations for browsing. They do not model task AND/OR logic, optional tasks, possession-versus-consumption rules, or which choice reward a player selects. They are excluded from crafting graphs and material totals.'
              : 'Informational item associations are excluded from crafting graphs and material totals.'}
          </Text>
        )}
        {collapsedCategoryGroups.length > 0 && (
          <>
            <View style={styles.collapsedTypesHeader}>
              <Text style={styles.filterTitle}>
                {informational ? 'Information types' : 'Crafting types'}
              </Text>
              {collapsedCategoryGroups.length > INITIAL_VISIBLE_CATEGORY_TYPES && (
                <TouchableOpacity
                  {...signalTarget('item-detail.collapsed-types.show-more')}
                  accessibilityRole="button"
                  accessibilityState={{expanded: showAllCollapsedCategoryTypes}}
                  accessibilityLabel={
                    showAllCollapsedCategoryTypes
                      ? 'Show fewer collapsed crafting types'
                      : `Show ${undisplayedCollapsedCategoryCount} more collapsed crafting types`
                  }
                  hitSlop={{top: 7, right: 7, bottom: 7, left: 7}}
                  onPress={() => setShowAllCollapsedCategoryTypes(show => !show)}
                  style={styles.showMoreTypesButton}>
                  <DisclosureChevron
                    expanded={showAllCollapsedCategoryTypes}
                    color={theme.accent}
                    size={18}
                    strokeWidth={2.3}
                  />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.collapsedTypeChips}>
              {displayedCollapsedCategoryGroups.map(group => (
                <TouchableOpacity
                  {...signalTarget('item-detail.recipe-category.expand-collapsed')}
                  key={group.catIdx}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${group.category!.title} recipes`}
                  accessibilityState={{expanded: false}}
                  onPress={() => toggleCategory(group.category!.id)}
                  style={styles.collapsedTypeChip}>
                  <VisibilityIcon visible={false} size={12} />
                  <Text style={styles.collapsedTypeChipText}>
                    {group.category!.title} ({group.count})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        {automatedShapedCount > 0 && (
          <View style={styles.disabledTypeRow}>
            <View style={styles.disabledTypeCopy}>
              <Text style={styles.disabledTypeTitle}>Automated Shaped Crafting</Text>
              <Text style={styles.disabledTypeHint}>
                Hidden by default · {automatedShapedCount} duplicate recipes
              </Text>
            </View>
            <Switch
              accessibilityLabel="Show Automated Shaped Crafting recipes"
              value={showAutomatedShaped}
              onValueChange={setShowAutomatedShaped}
              trackColor={{false: theme.border, true: theme.accent}}
              thumbColor={theme.text}
            />
          </View>
        )}
        {!informational && recipeStageCounts.length > 0 && (
          <View style={styles.recipeStageFilters}>
            <View style={styles.recipeStageHeading}>
              <Text style={styles.disabledTypeTitle}>Recipe stages</Text>
              <Text style={styles.disabledTypeHint}>
                Hide recipes gated by MeatballCraft progression
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={styles.recipeStageChips}>
              {recipeStageCounts.map(([stage, count]) => {
                const visible = !hiddenRecipeStages.has(stage);
                return (
                  <TouchableOpacity
                    {...signalTarget('item-detail.recipe-stage.visibility')}
                    key={stage}
                    accessibilityRole="button"
                    accessibilityState={{selected: visible}}
                    accessibilityLabel={`${visible ? 'Hide' : 'Show'} recipes requiring stage ${stage}`}
                    style={[
                      styles.recipeStageChip,
                      visible && styles.recipeStageChipVisible,
                    ]}
                    onPress={() => toggleRecipeStage(stage)}>
                    <VisibilityIcon visible={visible} size={13} />
                    <Text
                      style={[
                        styles.recipeStageName,
                        visible && styles.recipeStageNameVisible,
                      ]}>
                      {recipeStageLabel(stage)} · {count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
        {!informational && (showFluidTransfers || hiddenFluidTransferCount > 0) && (
          <View style={styles.disabledTypeRow}>
            <View style={styles.disabledTypeCopy}>
              <Text style={styles.disabledTypeTitle}>Fluid container transfers</Text>
              <Text style={styles.disabledTypeHint}>
                Hidden by default
                {hiddenFluidTransferCount > 0
                  ? ` · ${hiddenFluidTransferCount} identified in loaded recipes`
                  : ''}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Show fluid container-transfer recipes"
              value={showFluidTransfers}
              onValueChange={setShowFluidTransfers}
              trackColor={{false: theme.border, true: theme.accent}}
              thumbColor={theme.text}
            />
          </View>
        )}
      </View>}
      {eligibleRefs.length === 0 ? (
        <Text style={styles.emptyText}>
          {informational ? 'No informational pages are available.' : 'No recipe types are available.'}
        </Text>
      ) : null}
      {loadingVisiblePage ? (
        <Text style={styles.loadingText}>
          {informational ? 'loading informational pages…' : 'classifying recipe variants…'}
        </Text>
      ) : null}
      {!loadingVisiblePage && shown.length === 0 && filteredRefs.length > 0 ? (
        <Text style={styles.emptyText}>
          {informational
            ? 'No informational pages could be displayed.'
            : hiddenRecipeStageCount > 0
              ? 'All loaded recipes are hidden by the selected recipe-stage visibility toggles.'
              : hiddenFluidTransferCount > 0
                ? 'No standard recipes match. Enable fluid container transfers to view hidden conversions.'
                : 'No recipes are available for this item.'}
        </Text>
      ) : null}
      {scanCapped ? (
        <Text style={styles.loadingText}>
          Filter scan stopped after {MAX_DEFAULT_FILTER_SCAN} candidates. Expand a collapsed
          crafting type or enable container transfers to browse directly.
        </Text>
      ) : null}
      {sectionGroups.map(group => {
        const category = group.category!;
        const categoryRefs = shownByCategory.get(group.catIdx) ?? [];
        const machineKey = category.catalysts[0];
        const machineLabel = machineKey
          ? data.itemsByKey.get(machineKey)?.n ?? machineKey
          : undefined;
        return (
          <View
            key={category.id}
            style={[styles.categorySection, styles.categorySectionExpanded]}>
            <TouchableOpacity
              {...signalTarget('item-detail.recipe-category.toggle')}
              accessibilityRole="button"
              accessibilityLabel={`Collapse ${category.title} recipes`}
              accessibilityState={{expanded: true}}
              style={[styles.categoryHeader, styles.categoryHeaderExpanded]}
              onPress={() => toggleCategory(category.id)}>
              <View accessibilityElementsHidden style={styles.categoryVisibilityIcon}>
                <VisibilityIcon visible size={14} />
              </View>
              <Text style={styles.categoryTitle} numberOfLines={1}>
                {category.title}
              </Text>
              <Text style={styles.categoryCount}>
                {group.count} {group.count === 1 ? 'recipe' : 'recipes'}
              </Text>
            </TouchableOpacity>
            {categoryRefs.length > 0 ? (
              <View style={styles.categoryRecipes}>
                {categoryRefs.map(([catIdx, recipeIdx], recipePosition) => {
                  const recipe = recipeForRef([catIdx, recipeIdx]);
                  const usageStart =
                    graphDirection === 'outputs' && recipe
                      ? usageGraphStart(recipe)
                      : null;
                  const canStartTree =
                    recipe &&
                    (graphDirection === 'outputs'
                      ? recipeUsesItem(recipe, itemKey) && usageStart !== null
                      : recipeProducesItem(recipe, itemKey));
                  const actionSubject = data.itemsByKey.get(itemKey)?.n ?? itemKey;
                  const usageOutputSubject = usageStart
                    ? data.itemsByKey.get(usageStart.rootKey)?.n ?? usageStart.rootKey
                    : undefined;
                  return (
                    <View
                      key={`${catIdx}-${recipeIdx}`}
                      style={[
                        styles.categoryRecipe,
                        isolatedRecipeStyle,
                        recipePosition > 0 && styles.categoryRecipeSeparated,
                      ]}>
                      {recipe && availableCardWidth !== null ? (
                        <RecipeCard
                          recipe={recipe}
                          dir={category.dir}
                          catTitle={category.title}
                          availableCardWidth={availableCardWidth}
                          contentZoom={contentZoom}
                          machineKey={machineKey}
                          machineLabel={machineLabel}
                          graphDirection={graphDirection}
                          actionSubject={actionSubject}
                          usageOutputSubject={usageOutputSubject}
                          grouped
                          onPress={
                            canStartTree && !informational
                              ? () =>
                                  openRecipeInGraph(
                                    usageStart?.rootKey ?? itemKey,
                                    [catIdx, recipeIdx],
                                    usageStart?.direction ?? graphDirection,
                                  )
                              : undefined
                          }
                        />
                      ) : recipe ? (
                        <Text style={styles.loadingText}>
                          measuring {category.title} layout…
                        </Text>
                      ) : (
                        <Text style={styles.loadingText}>loading {category.title}…</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
      {(informational
        ? filteredRefs.length > visibleTarget
        : showFluidTransfers
          ? filteredRefs.length > visibleTarget
          : !scannedAll || visibleCandidates.length > visibleTarget) && (
        <TouchableOpacity
          {...signalTarget('item-detail.show-more')}
          style={styles.moreBtn}
          onPress={() => {
            setVisibleTarget(value => value + PAGE);
            setScanLimit(limit => Math.min(filteredRefs.length, limit + PAGE));
          }}>
          <Text style={styles.moreBtnText}>
            {informational ? 'Show more information' : 'Show more recipes'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  backdropNative: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  card: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    width: '100%',
    maxWidth: 760,
    maxHeight: '88%' as never,
    padding: 14,
  },
  cardNative: {
    maxWidth: '100%',
    height: '92%',
    maxHeight: '92%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  header: {flexDirection: 'row', alignItems: 'center'},
  headerBtn: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  headerBtnText: {color: theme.textDim, fontSize: 14},
  lookupActions: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4},
  lookupSecondaryButton: {
    minHeight: 40,
    justifyContent: 'center',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  lookupSecondaryButtonText: {color: theme.text, fontSize: 13, fontWeight: '700'},
  lookupCancelButton: {
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: theme.panelAlt,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 18,
  },
  lookupCancelButtonText: {color: theme.text, fontSize: 13, fontWeight: '700'},
  titleRow: {flexDirection: 'row', alignItems: 'center', marginTop: 2},
  title: {color: theme.text, fontSize: 18, fontWeight: '700'},
  subtitle: {color: theme.textDim, fontSize: 12, marginTop: 2},
  emcRow: {
    alignSelf: 'flex-start',
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 7,
    backgroundColor: theme.panelAlt,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  emcLabel: {color: theme.textDim, fontSize: 9, fontWeight: '800'},
  emcValue: {color: theme.accent, fontSize: 12, fontWeight: '800'},
  contentZoomControl: {marginTop: 12},
  tabsRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 8},
  sideTab: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: theme.panelAlt,
  },
  sideTabActive: {borderColor: theme.accent, backgroundColor: '#1c2b22'},
  sideTabText: {color: theme.textDim, fontSize: 13},
  recipeFilters: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    gap: 9,
  },
  recipeList: {width: '100%'},
  categorySection: {marginBottom: 10},
  categorySectionExpanded: {
    overflow: 'hidden',
    backgroundColor: theme.panelAlt,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 8,
  },
  categoryHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.panelAlt,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  categoryHeaderExpanded: {
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    borderRadius: 0,
  },
  categoryVisibilityIcon: {width: 18},
  categoryTitle: {color: theme.text, fontSize: 12, fontWeight: '700', flex: 1},
  categoryCount: {color: theme.textDim, fontSize: 9},
  categoryRecipes: {paddingTop: 0},
  categoryRecipe: {width: '100%'},
  categoryRecipeSeparated: {borderTopColor: theme.border, borderTopWidth: 1},
  informationNotice: {color: theme.textDim, fontSize: 12, lineHeight: 17},
  usageTreeNotice: {color: theme.accent, fontSize: 12, lineHeight: 17, fontWeight: '700'},
  collapsedTypesHeader: {flexDirection: 'row', alignItems: 'center', gap: 2},
  filterTitle: {color: theme.text, fontSize: 12, fontWeight: '700'},
  collapsedTypeChips: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  collapsedTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 7,
    backgroundColor: theme.panel,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  collapsedTypeChipText: {color: theme.textDim, fontSize: 10},
  showMoreTypesButton: {
    width: 30,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 10,
  },
  disabledTypeCopy: {flex: 1},
  disabledTypeTitle: {color: theme.text, fontSize: 11, fontWeight: '600'},
  disabledTypeHint: {color: theme.textDim, fontSize: 9, marginTop: 2},
  recipeStageFilters: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 6,
  },
  recipeStageHeading: {marginBottom: 2},
  recipeStageChips: {gap: 6, paddingBottom: 3},
  recipeStageChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 7,
    backgroundColor: theme.panel,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  recipeStageChipVisible: {borderColor: theme.accent, backgroundColor: '#1c2b22'},
  recipeStageName: {color: theme.text, fontSize: 10, fontWeight: '600'},
  recipeStageNameVisible: {color: theme.accent},
  sideTabTextActive: {color: theme.accent, fontWeight: '700'},
  body: {marginTop: 12},
  emptyText: {color: theme.textDim, padding: 10},
  indexError: {color: theme.danger, padding: 10, textAlign: 'center'},
  dropSection: {marginTop: 14},
  dropTitle: {color: theme.textDim, fontSize: 11, textTransform: 'uppercase', marginBottom: 6},
  mobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  mobChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  mobName: {color: theme.text, fontSize: 11, maxWidth: 180},
  mobStat: {color: theme.textDim, fontSize: 11},
  loadingText: {color: theme.textDim, fontSize: 12, marginBottom: 10},
  moreBtn: {
    alignSelf: 'flex-start',
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  moreBtnText: {color: theme.text, fontSize: 12},
});

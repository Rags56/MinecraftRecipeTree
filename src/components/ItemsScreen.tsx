import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {useData} from '../data/DataContext';
import {
  catalogTypePresentation,
  isItemCatalogBrowseVisible,
  isItemCatalogEligible,
} from '../data/catalogPresentation';
import {useRecipeStages} from '../data/RecipeStageContext';
import {
  buildFuzzyCandidateIndex,
  directSearchScore,
  fuzzyCandidateIndices,
  fuzzySearchScore,
  normalizeSearchText,
} from '../data/fuzzySearch';
import {signalTarget} from '../analytics/signal';
import {theme} from '../theme';
import {CatalogItem} from '../types';
import {useUi} from '../ui/UiContext';
import {ItemIcon} from './ItemIcon';
import {ModFilter, SearchBar} from './SearchBar';

const MAX_RESULTS = 800;
const CELL_W = 104;

export function ItemsScreen({
  interfaceZoom,
  contentZoom,
}: {
  interfaceZoom: number;
  contentZoom: number;
}) {
  const data = useData();
  const recipeStages = useRecipeStages();
  const {openItem} = useUi();
  const [query, setQuery] = useState('');
  const [mod, setMod] = useState<string | null>(null);
  const {width} = useWindowDimensions();

  const catalogItems = useMemo(
    () => data.items.filter(isItemCatalogEligible),
    [data.items],
  );
  const searchableItems = useMemo(
    () =>
      catalogItems.map(item => {
        const fields = [
          normalizeSearchText(item.n),
          normalizeSearchText(item.id),
          normalizeSearchText(catalogTypePresentation(item.t)?.label ?? ''),
        ];
        return {
          item,
          fields,
          words: fields.flatMap(field => field.split(' ').filter(Boolean)),
        };
      }),
    [catalogItems],
  );
  const fuzzyIndexCache = useRef<{
    source: typeof searchableItems;
    index: ReturnType<typeof buildFuzzyCandidateIndex>;
  } | null>(null);
  const fuzzyEnabled = normalizeSearchText(query).length >= 3;
  const fuzzyIndex = useMemo(() => {
    if (!fuzzyEnabled) return null;
    if (fuzzyIndexCache.current?.source === searchableItems) {
      return fuzzyIndexCache.current.index;
    }
    const index = buildFuzzyCandidateIndex(
      searchableItems.map(searchable => searchable.words),
    );
    fuzzyIndexCache.current = {source: searchableItems, index};
    return index;
  }, [fuzzyEnabled, searchableItems]);
  const unknownCatalogTypes = useMemo(() => {
    const unknown = new Set<string>();
    for (const item of catalogItems) {
      const presentation = catalogTypePresentation(item.t);
      if (presentation && !presentation.recognized) unknown.add(item.t!);
    }
    return [...unknown].sort();
  }, [catalogItems]);

  useEffect(() => {
    if (unknownCatalogTypes.length === 0) return;
    console.warn(
      '[ItemsScreen] Some exporter ingredient types have no specific presentation label; ' +
        'rendering them as generic custom ingredients.',
      {dataset: data.descriptor.slug, types: unknownCatalogTypes},
    );
  }, [data.descriptor.slug, unknownCatalogTypes]);

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query);
    const queryWords = q.split(' ').filter(Boolean);
    const out: CatalogItem[] = [];
    const ranked = new Map<number, CatalogItem[]>();
    const eligible = (item: CatalogItem) => {
      const gatedStages = recipeStages.catalog.stagesByItemKey.get(item.k);
      if (
        recipeStages.selectedStage &&
        !gatedStages?.includes(recipeStages.selectedStage)
      ) {
        return false;
      }
      return !mod || item.m === mod;
    };
    const addRanked = (score: number, item: CatalogItem) => {
      const bucket = ranked.get(score);
      if (bucket) {
        if (bucket.length < MAX_RESULTS + 1) bucket.push(item);
      } else {
        ranked.set(score, [item]);
      }
    };

    if (!q) {
      for (const {item} of searchableItems) {
        if (!isItemCatalogBrowseVisible(item)) continue;
        if (!eligible(item)) continue;
        out.push(item);
        if (out.length >= MAX_RESULTS + 1) break;
      }
      return out;
    }

    let directMatches = 0;
    const directlyMatchedIndices = new Set<number>();
    searchableItems.forEach((searchable, itemIndex) => {
      if (!eligible(searchable.item)) return;
      const score = directSearchScore(q, searchable.fields);
      if (score != null) {
        directMatches += 1;
        directlyMatchedIndices.add(itemIndex);
        addRanked(score, searchable.item);
      }
    });

    if (directMatches < MAX_RESULTS + 1 && fuzzyIndex) {
      for (const itemIndex of fuzzyCandidateIndices(
        queryWords,
        fuzzyIndex,
        itemIndex => {
          const searchable = searchableItems[itemIndex];
          return Boolean(searchable && eligible(searchable.item));
        },
      )) {
        if (directlyMatchedIndices.has(itemIndex)) continue;
        const searchable = searchableItems[itemIndex];
        if (!searchable || !eligible(searchable.item)) continue;
        const score = fuzzySearchScore(q, searchable.fields, queryWords, searchable.words);
        if (score != null) addRanked(score, searchable.item);
      }
    }

    for (const score of [...ranked.keys()].sort((a, b) => a - b)) {
      out.push(...ranked.get(score)!);
      if (out.length >= MAX_RESULTS + 1) break;
    }
    return out;
  }, [
    searchableItems,
    fuzzyIndex,
    query,
    mod,
    recipeStages.catalog.stagesByItemKey,
    recipeStages.selectedStage,
  ]);

  const truncated = filtered.length > MAX_RESULTS;
  const shown = truncated ? filtered.slice(0, MAX_RESULTS) : filtered;
  const columns = Math.max(
    1,
    Math.min(12, Math.floor(width / (CELL_W * contentZoom))),
  );
  const compactControls = width < 640;
  const scaledInterfaceStyle =
    Platform.OS === 'web'
      ? ({zoom: interfaceZoom} as unknown as object)
      : null;
  const scaledGridStyle =
    Platform.OS === 'web'
      ? ({
          zoom: contentZoom / interfaceZoom,
        } as unknown as object)
      : null;

  return (
    <View style={[styles.root, scaledInterfaceStyle]}>
      <View style={styles.stickyControls}>
        <View style={styles.controlsRow}>
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder={`Search ${catalogItems.length} items…`}
            style={styles.searchControl}
          />
          <ModFilter
            mods={data.mods}
            selected={mod}
            onSelect={setMod}
            style={[styles.modControl, compactControls && styles.modControlCompact]}
          />
        </View>
        {recipeStages.selectedStage && (
          <View style={styles.stageFilterRow}>
            <View style={styles.stageFilterCopy}>
              <Text style={styles.stageFilterTitle}>
                ⚑ Stage: {recipeStages.selectedStage}
              </Text>
              <Text style={styles.stageFilterMeta}>
                Showing items with at least one recipe gated by this stage
              </Text>
            </View>
            <TouchableOpacity
              {...signalTarget('items.recipe-stage.clear')}
              style={styles.clearStageButton}
              onPress={() => recipeStages.selectStage(null)}
              accessibilityRole="button"
              accessibilityLabel={`Clear recipe stage filter ${recipeStages.selectedStage}`}>
              <Text style={styles.clearStageButtonText}>Show all items</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <FlatList
        style={[styles.grid, scaledGridStyle]}
        key={`grid-${columns}-${contentZoom}`}
        data={shown}
        numColumns={columns}
        keyExtractor={i => i.k}
        windowSize={7}
        initialNumToRender={60}
        maxToRenderPerBatch={60}
        contentContainerStyle={styles.gridContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No matching staged items</Text>
            <Text style={styles.emptyText}>
              Clear the search, mod filter, or recipe-stage filter.
            </Text>
          </View>
        }
        renderItem={({item}) => {
          const typeLabel = catalogTypePresentation(item.t)?.label;
          const gatedStages = recipeStages.catalog.stagesByItemKey.get(item.k) ?? [];
          const allGatedRecipesHidden =
            gatedStages.length > 0 &&
            gatedStages.every(stage => recipeStages.hiddenStages.has(stage));
          const stageLabel =
            gatedStages.length === 1
              ? gatedStages[0]
              : `${gatedStages.length} stages`;
          return (
            <TouchableOpacity
              {...signalTarget('items.item.open')}
              style={[
                styles.cell,
                gatedStages.length > 0 && styles.gatedCell,
                {width: `${100 / columns}%` as never},
              ]}
              onPress={() => openItem(item.k)}
              accessibilityRole="button"
              accessibilityLabel={`${item.n}${gatedStages.length > 0 ? `, has recipes gated by ${gatedStages.join(', ')}` : ''}`}>
              <ItemIcon item={item} size={48} />
              <Text style={styles.cellName} numberOfLines={2}>
                {item.n}
              </Text>
              {typeLabel && (
                <Text style={styles.typeBadge} numberOfLines={1}>
                  {typeLabel}
                </Text>
              )}
              {gatedStages.length > 0 && (
                <Text
                  style={[
                    styles.stageBadge,
                    allGatedRecipesHidden && styles.stageBadgeHidden,
                  ]}
                  numberOfLines={1}>
                  ⚑ {stageLabel}
                  {allGatedRecipesHidden ? ' · hidden' : ''}
                </Text>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, minHeight: 0},
  stickyControls: {
    flexShrink: 0,
    backgroundColor: theme.bg,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingBottom: 6,
    paddingHorizontal: 6,
    paddingTop: 6,
    zIndex: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stageFilterRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.accentAlt,
    borderRadius: 8,
    backgroundColor: 'rgba(90, 167, 250, 0.08)',
  },
  stageFilterCopy: {flex: 1, minWidth: 0},
  stageFilterTitle: {color: theme.accentAlt, fontSize: 11, fontWeight: '800'},
  stageFilterMeta: {color: theme.textDim, fontSize: 9, marginTop: 2},
  clearStageButton: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  clearStageButtonText: {color: theme.text, fontSize: 10, fontWeight: '700'},
  searchControl: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  modControl: {
    width: 220,
    marginHorizontal: 0,
    marginTop: 0,
  },
  modControlCompact: {width: 132},
  grid: {flex: 1, minHeight: 0},
  gridContent: {paddingHorizontal: 6, paddingTop: 4, paddingBottom: 24},
  cell: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  gatedCell: {borderColor: 'rgba(224, 179, 65, 0.42)', backgroundColor: 'rgba(224, 179, 65, 0.04)'},
  cellName: {
    color: theme.textDim,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 5,
  },
  typeBadge: {
    color: theme.accentAlt,
    fontSize: 9,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  stageBadge: {
    maxWidth: '96%',
    color: theme.warn,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
    textTransform: 'none',
  },
  stageBadgeHidden: {color: theme.textDim},
  emptyState: {alignItems: 'center', padding: 28},
  emptyTitle: {color: theme.text, fontSize: 14, fontWeight: '700'},
  emptyText: {color: theme.textDim, fontSize: 11, marginTop: 5},
});

import {Modal} from '../ui/nativeUiScale';
import React, {useMemo, useState} from 'react';
import {
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
import type {SlotSummary} from '../data/slotSummary';
import {signalTarget} from '../analytics/signal';
import {theme} from '../theme';
import {uniformPickerRecipePreviewSize} from '../ui/interfaceZoom';
import type {GraphDirection} from '../graph/direction';
import {pixelated} from './ItemIcon';
import {ItemChip, RecipeImageViewport} from './RecipeCard';
import {RecipePreviewImage} from './RecipePreviewImage';
import {VisibilityIcon} from './VisibilityIcon';
import {groupPickerOptions} from './pickerGroups';
import {MultiblockPreview} from './MultiblockPreview';
import type {RecipeStructure} from '../types';
import {ContentZoomControl} from './ContentZoomControl';

export interface PickerOption {
  label: string;
  /** Stable category identity used by the source picker collapse controls. */
  groupKey?: string;
  /** Human-readable recipe or physical-source category. */
  groupLabel?: string;
  sublabel?: string;
  imageUri?: string;
  imageBackgroundUri?: string;
  imageW?: number;
  imageH?: number;
  /** Exported placed-block geometry for structure-preview recipes. */
  structure?: RecipeStructure;
  inputs?: SlotSummary[];
  outputs?: SlotSummary[];
  machineKey?: string;
  machineLabel?: string;
}

export interface PickerGroupProgress {
  loaded: number;
  total: number;
  loading?: boolean;
}

/** Generic chooser used to pick between recipes and drop sources for an item. */
export function PickerModal({
  visible,
  title,
  options,
  direction,
  onDirectionChange,
  rememberSource,
  onRememberSourceChange,
  filterLabel,
  filterHint,
  filterValue,
  onFilterValueChange,
  recipeStageCounts,
  hiddenRecipeStages,
  onToggleRecipeStage,
  collapsedGroupKeys,
  onToggleGroup,
  groupProgress,
  onLoadGroup,
  onSelectAlternative,
  onOpenMachine,
  onSelect,
  onClose,
  interfaceZoom = 1,
  contentZoom = 1,
  onContentZoomChange,
  onContentZoomComplete,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  direction?: GraphDirection;
  onDirectionChange?: (direction: GraphDirection) => void;
  rememberSource?: boolean;
  onRememberSourceChange?: (remember: boolean) => void;
  filterLabel?: string;
  filterHint?: string;
  filterValue?: boolean;
  onFilterValueChange?: (show: boolean) => void;
  recipeStageCounts?: readonly {stage: string; count: number}[];
  hiddenRecipeStages?: ReadonlySet<string>;
  onToggleRecipeStage?: (stage: string) => void;
  collapsedGroupKeys?: ReadonlySet<string>;
  onToggleGroup?: (groupKey: string) => void;
  groupProgress?: Readonly<Record<string, PickerGroupProgress>>;
  onLoadGroup?: (groupKey: string) => void;
  onSelectAlternative?: (
    optionIndex: number,
    selectionKey: string,
    selectedKey: string,
  ) => void;
  onOpenMachine?: (itemKey: string) => void;
  onSelect: (index: number) => void;
  onClose: () => void;
  /** Scale for picker controls and surrounding interface chrome. */
  interfaceZoom?: number;
  /** Independent scale for recipe previews and item ingredients. */
  contentZoom?: number;
  onContentZoomChange?: (value: number) => void;
  onContentZoomComplete?: (value: number) => void;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const [alternativePicker, setAlternativePicker] = useState<{
    optionIndex: number;
    slot: SlotSummary;
  } | null>(null);
  const groups = useMemo(() => groupPickerOptions(options), [options]);
  const collapsedGroups = groups.filter(group => collapsedGroupKeys?.has(group.key));
  const expandedGroups = groups.filter(group => !collapsedGroupKeys?.has(group.key));
  const allCollapsed = groups.length > 0 && collapsedGroups.length === groups.length;
  const toggleGroup = (key: string) => onToggleGroup?.(key);
  const stagedProgress = Object.values(groupProgress ?? {});
  const immediateGroups = groups.filter(group => !groupProgress?.[group.key]);
  const sourceTypeCount = stagedProgress.length + immediateGroups.length;
  const loadedOptionCount =
    stagedProgress.reduce((sum, progress) => sum + progress.loaded, 0) +
    immediateGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const totalOptionCount =
    stagedProgress.reduce((sum, progress) => sum + progress.total, 0) +
    immediateGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: 920 / interfaceZoom,
          height: `${92 / interfaceZoom}%`,
          maxHeight: `${92 / interfaceZoom}%`,
        } as unknown as object)
      : null;
  const isolatedContentStyle =
    Platform.OS === 'web'
      ? ({zoom: 1 / interfaceZoom} as unknown as object)
      : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, Platform.OS !== 'web' && styles.backdropNative]}
        onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            scaledCardStyle,
            Platform.OS !== 'web' && styles.cardNative,
            Platform.OS !== 'web' && {paddingBottom: Math.max(14, safeAreaInsets.bottom)},
          ]}
          onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          {Platform.OS === 'web' && onContentZoomChange ? (
            <ContentZoomControl
              value={contentZoom}
              onValueChange={onContentZoomChange}
              onSlidingComplete={onContentZoomComplete}
              testID="picker-content-zoom-slider"
            />
          ) : null}
          {direction && onDirectionChange ? (
            <View
              accessibilityLabel="Tree direction"
              style={styles.directionTabs}>
              {([
                ['inputs', 'Recipes'],
                ['outputs', 'Usages'],
              ] as const).map(([value, label]) => {
                const selected = direction === value;
                return (
                  <TouchableOpacity
                    {...signalTarget(`graph.source-picker.direction.${value}`)}
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}, build tree ${value === 'inputs' ? 'toward ingredients' : 'toward products'}`}
                    accessibilityState={{selected}}
                    style={[
                      styles.directionTab,
                      selected && styles.directionTabSelected,
                    ]}
                    onPress={() => onDirectionChange(value)}>
                    <Text
                      style={[
                        styles.directionTabText,
                        selected && styles.directionTabTextSelected,
                      ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {onRememberSourceChange && (
            <View style={styles.rememberRow}>
              <View style={styles.rememberCopy}>
                <Text style={styles.rememberTitle}>★ Use automatically in future trees</Text>
              </View>
              <Switch
                {...signalTarget('graph.source-picker.remember-source')}
                accessibilityLabel="Use automatically in future trees"
                value={rememberSource ?? true}
                onValueChange={onRememberSourceChange}
                trackColor={{false: theme.border, true: theme.accent}}
                thumbColor={theme.text}
              />
            </View>
          )}
          {filterLabel && onFilterValueChange && (
            <View style={styles.rememberRow}>
              <View style={styles.rememberCopy}>
                <Text style={styles.filterTitle}>{filterLabel}</Text>
                {filterHint ? <Text style={styles.rememberHint}>{filterHint}</Text> : null}
              </View>
              <Switch
                {...signalTarget('graph.source-picker.filter-fluid-transfers')}
                accessibilityLabel={filterLabel}
                value={filterValue ?? false}
                onValueChange={onFilterValueChange}
                trackColor={{false: theme.border, true: theme.accent}}
                thumbColor={theme.text}
              />
            </View>
          )}
          {recipeStageCounts && recipeStageCounts.length > 0 && onToggleRecipeStage ? (
            <View style={styles.recipeStageFilters}>
              <View style={styles.recipeStageHeading}>
                <Text style={styles.filterTitle}>Recipe stages</Text>
                <Text style={styles.rememberHint}>
                  Hide MeatballCraft recipes gated by selected progression stages
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                contentContainerStyle={styles.recipeStageGrid}>
                {recipeStageCounts.map(({stage, count}) => {
                  const shown = !hiddenRecipeStages?.has(stage);
                  return (
                    <TouchableOpacity
                      {...signalTarget('graph.source-picker.recipe-stage.visibility')}
                      key={stage}
                      accessibilityRole="button"
                      accessibilityState={{selected: shown}}
                      accessibilityLabel={`${shown ? 'Hide' : 'Show'} recipes requiring stage ${stage}`}
                      style={[
                        styles.recipeStageChip,
                        shown && styles.recipeStageChipVisible,
                      ]}
                      onPress={() => onToggleRecipeStage(stage)}>
                      <VisibilityIcon visible={shown} size={13} />
                      <Text
                        style={[
                          styles.recipeStageName,
                          shown && styles.recipeStageNameVisible,
                        ]}>
                        {stage} · {count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          {groups.length > 1 ? (
            <View style={styles.groupActions}>
              <Text style={styles.groupSummary}>
                {sourceTypeCount} source types · {loadedOptionCount}/{totalOptionCount} loaded
              </Text>
              <TouchableOpacity
                {...signalTarget('graph.source-picker.groups.toggle-all')}
                accessibilityRole="button"
                style={styles.groupAction}
                onPress={() => {
                  const shouldExpand = allCollapsed;
                  for (const group of groups) {
                    if (shouldExpand === Boolean(collapsedGroupKeys?.has(group.key))) {
                      toggleGroup(group.key);
                    }
                  }
                }}>
                <Text style={styles.groupActionText}>
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <ScrollView
            style={styles.optionsScroll}
            contentContainerStyle={styles.groupList}
            showsVerticalScrollIndicator>
            {options.length === 0 ? (
              <Text style={styles.emptyText}>No standard sources are available.</Text>
            ) : null}
            {collapsedGroups.length > 0 ? (
              <View style={styles.collapsedBubbles}>
                {collapsedGroups.map(group => {
                  const progress = groupProgress?.[group.key];
                  return (
                    <TouchableOpacity
                      {...signalTarget('graph.source-picker.group.expand')}
                      key={group.key}
                      accessibilityRole="button"
                      accessibilityState={{expanded: false}}
                      accessibilityLabel={`Expand ${group.label}`}
                      style={styles.collapsedBubble}
                      onPress={() => toggleGroup(group.key)}>
                      <Text style={styles.collapsedBubbleCaret}>▸</Text>
                      <Text style={styles.collapsedBubbleText}>{group.label}</Text>
                      <Text style={styles.collapsedBubbleCount}>
                        {progress ? `${progress.loaded}/${progress.total}` : group.entries.length}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            {expandedGroups.map(group => {
              const progress = groupProgress?.[group.key];
              const hasMore = Boolean(progress && progress.loaded < progress.total);
              return (
                <View key={group.key} style={styles.group}>
                  <TouchableOpacity
                    {...signalTarget('graph.source-picker.group.collapse')}
                    accessibilityRole="button"
                    accessibilityState={{expanded: true}}
                    accessibilityLabel={`${group.label}, ${group.entries.length} option${group.entries.length === 1 ? '' : 's'}`}
                    style={styles.groupHeader}
                    onPress={() => toggleGroup(group.key)}>
                    <View accessibilityElementsHidden style={styles.groupVisibilityIcon}>
                      <VisibilityIcon visible size={14} />
                    </View>
                    <Text style={styles.groupTitle}>{group.label}</Text>
                    <Text style={styles.groupCount}>
                      {progress ? `${progress.loaded}/${progress.total}` : group.entries.length}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.optionGrid}>
                    {group.entries.map(({option: opt, index: i}) => {
                      const imageSize = opt.imageUri
                        ? Platform.OS !== 'web'
                          ? {width: (opt.imageW ?? 160) * contentZoom / interfaceZoom, height: (opt.imageH ?? 60) * contentZoom / interfaceZoom}
                          : uniformPickerRecipePreviewSize(
                            opt.imageW ?? 160,
                            opt.imageH ?? 60,
                            contentZoom,
                          )
                        : null;
                      return (
                        <TouchableOpacity
                          {...signalTarget('graph.source-picker.source.select')}
                          key={i}
                          style={[styles.option, isolatedContentStyle]}
                          onPress={() => onSelect(i)}>
                          <Text style={styles.optionLabel}>{opt.label}</Text>
                          {opt.sublabel ? <Text style={styles.optionSub}>{opt.sublabel}</Text> : null}
                          {opt.structure ? (
                            <MultiblockPreview
                              structure={opt.structure}
                              availableWidth={Math.min(860, 398 * contentZoom)}
                              contentScale={contentZoom}
                            />
                          ) : opt.imageUri && imageSize ? (
                            <RecipeImageViewport>
                            <RecipePreviewImage
                              uri={opt.imageUri}
                              backgroundUri={opt.imageBackgroundUri}
                              context={opt.label}
                              style={[imageSize, styles.optionImage, pixelated as object]}
                              resizeMode="contain"
                            />
                            </RecipeImageViewport>
                          ) : null}
                          {!opt.structure && opt.inputs && opt.inputs.length > 0 ? (
                            <View style={styles.ingredientGroup}>
                              <Text style={styles.ingredientLabel}>Inputs</Text>
                              <View style={styles.ingredientChips}>
                                {opt.inputs.map(input => (
                                  <ItemChip
                                    key={`input-${input.tag ?? input.key}`}
                                    itemKey={input.key}
                                    amount={input.amount}
                                    variableAmount={input.variableAmount}
                                    variants={input.variants}
                                    tag={input.tag}
                                    probability={input.probability}
                                    probabilityRole="consume"
                                    contentScale={contentZoom}
                                    interactive={
                                      Boolean(onSelectAlternative) &&
                                      input.alternatives.length > 1
                                    }
                                    onPress={
                                      onSelectAlternative && input.alternatives.length > 1
                                        ? () =>
                                            setAlternativePicker({
                                              optionIndex: i,
                                              slot: input,
                                            })
                                        : undefined
                                    }
                                    accessibilityLabel={
                                      input.alternatives.length > 1
                                        ? `Choose from ${input.alternatives.length} ingredient alternatives`
                                        : undefined
                                    }
                                  />
                                ))}
                              </View>
                            </View>
                          ) : null}
                          {!opt.structure && opt.outputs && opt.outputs.length > 0 ? (
                            <View style={styles.ingredientGroup}>
                              <Text style={styles.ingredientLabel}>Outputs</Text>
                              <View style={styles.ingredientChips}>
                                {opt.outputs.map(output => (
                                  <ItemChip
                                    key={`output-${output.tag ?? output.key}`}
                                    itemKey={output.key}
                                    amount={output.amount}
                                    variableAmount={output.variableAmount}
                                    variants={output.variants}
                                    tag={output.tag}
                                    probability={output.probability}
                                    probabilityRole="produce"
                                    contentScale={contentZoom}
                                    interactive={false}
                                  />
                                ))}
                              </View>
                            </View>
                          ) : null}
                          {opt.machineKey && opt.machineLabel && onOpenMachine ? (
                            <View style={styles.machineRow}>
                              <View style={styles.machineCopy}>
                                <Text style={styles.machineLabel}>CRAFTING MACHINE</Text>
                                <Text style={styles.machineName} numberOfLines={1}>
                                  {opt.machineLabel}
                                </Text>
                              </View>
                              <TouchableOpacity
                                {...signalTarget('graph.source-picker.machine.open')}
                                accessibilityRole="button"
                                accessibilityLabel={`View recipe for ${opt.machineLabel}`}
                                style={styles.machineButton}
                                onPress={event => {
                                  event.stopPropagation();
                                  onOpenMachine(opt.machineKey!);
                                }}>
                                <Text style={styles.machineButtonText}>View machine recipe</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {hasMore && onLoadGroup ? (
                    <TouchableOpacity
                      {...signalTarget('graph.source-picker.group.load-more')}
                      accessibilityRole="button"
                      accessibilityLabel={`Load more ${group.label} recipes`}
                      disabled={progress?.loading}
                      style={[
                        styles.loadMoreGroup,
                        progress?.loading && styles.loadMoreGroupDisabled,
                      ]}
                      onPress={() => onLoadGroup(group.key)}>
                      <Text style={styles.loadMoreGroupText}>
                        {progress?.loading
                          ? `Loading ${group.label}…`
                          : `Load more · ${progress!.total - progress!.loaded} remaining`}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
        {alternativePicker ? (
          <Pressable
            style={styles.alternativeBackdrop}
            onPress={() => setAlternativePicker(null)}>
            <Pressable
              accessibilityViewIsModal
              style={styles.alternativeCard}
              onPress={() => {}}>
              <View style={styles.alternativeHeader}>
                <View style={styles.alternativeTitleGroup}>
                  <Text style={styles.alternativeTitle}>Choose an ingredient</Text>
                  <Text style={styles.alternativeCount}>
                    {alternativePicker.slot.alternatives.length} valid alternatives
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close ingredient alternatives"
                  style={styles.alternativeClose}
                  onPress={() => setAlternativePicker(null)}>
                  <Text style={styles.alternativeCloseText}>×</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.alternativeScroll}
                contentContainerStyle={styles.alternativeList}>
                {alternativePicker.slot.alternatives.map(itemKey => (
                  <ItemChip
                    key={itemKey}
                    itemKey={itemKey}
                    highlight={itemKey === alternativePicker.slot.key}
                    accessibilityLabel={`Use ${itemKey.split('|').pop() ?? itemKey}`}
                    onPress={() => {
                      onSelectAlternative?.(
                        alternativePicker.optionIndex,
                        alternativePicker.slot.selectionKey ??
                          alternativePicker.slot.key,
                        itemKey,
                      );
                      setAlternativePicker(null);
                    }}
                    contentScale={contentZoom}
                  />
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
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
    maxWidth: 920,
    height: '92%' as never,
    maxHeight: '92%' as never,
    minHeight: 0,
    padding: 14,
  },
  cardNative: {
    maxWidth: '100%',
    height: '94%',
    maxHeight: '94%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  title: {color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 10},
  directionTabs: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 6,
    marginBottom: 10,
    padding: 3,
    borderRadius: 9,
    backgroundColor: theme.panelAlt,
  },
  directionTab: {
    minWidth: 94,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 7,
    alignItems: 'center',
  },
  directionTabSelected: {
    backgroundColor: theme.radialRootPanel,
    borderColor: theme.radialRoot,
    borderWidth: 1,
  },
  directionTabText: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: '700',
  },
  directionTabTextSelected: {color: theme.radialRoot},
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  recipeStageFilters: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingTop: 8,
    marginBottom: 8,
    gap: 6,
  },
  recipeStageHeading: {gap: 2},
  recipeStageGrid: {gap: 6, paddingBottom: 3},
  recipeStageChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 7,
    backgroundColor: theme.panelAlt,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  recipeStageChipVisible: {borderColor: theme.accent, backgroundColor: '#1c2b22'},
  recipeStageName: {color: theme.text, fontSize: 10, fontWeight: '600'},
  recipeStageNameVisible: {color: theme.accent},
  rememberCopy: {flex: 1},
  rememberTitle: {color: theme.accent, fontSize: 12, fontWeight: '700'},
  filterTitle: {color: theme.text, fontSize: 12, fontWeight: '700'},
  rememberHint: {color: theme.textDim, fontSize: 10, marginTop: 2, lineHeight: 14},
  optionsScroll: {flex: 1, minHeight: 0},
  groupList: {gap: 8, paddingBottom: 2},
  collapsedBubbles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  collapsedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: theme.panelAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  collapsedBubbleCaret: {color: theme.accent, fontSize: 11},
  collapsedBubbleText: {color: theme.text, fontSize: 11, fontWeight: '700'},
  collapsedBubbleCount: {color: theme.textDim, fontSize: 9, fontWeight: '700'},
  groupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  groupSummary: {color: theme.textDim, fontSize: 11, flex: 1},
  groupAction: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  groupActionText: {color: theme.accent, fontSize: 10, fontWeight: '700'},
  group: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    backgroundColor: theme.panelAlt,
    overflow: 'hidden',
  },
  groupHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  groupVisibilityIcon: {width: 18},
  groupTitle: {color: theme.text, fontSize: 12, fontWeight: '700', flex: 1},
  groupCount: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'right',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 8,
    padding: 8,
  },
  loadMoreGroup: {
    alignSelf: 'center',
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 7,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  loadMoreGroupDisabled: {opacity: 0.55},
  loadMoreGroupText: {color: theme.accent, fontSize: 10, fontWeight: '700'},
  emptyText: {
    color: theme.textDim,
    fontSize: 12,
    paddingVertical: 14,
    textAlign: 'center',
    width: '100%',
  },
  option: {
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: theme.panel,
    padding: 10,
    flexBasis: 420,
    flexGrow: 1,
    maxWidth: 820,
  },
  optionLabel: {color: theme.text, fontSize: 13, fontWeight: '600'},
  optionSub: {color: theme.textDim, fontSize: 11, marginTop: 2},
  optionImage: {marginTop: 8, borderRadius: 4},
  ingredientGroup: {marginTop: 9, gap: 5},
  ingredientLabel: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  ingredientChips: {flexDirection: 'row', flexWrap: 'wrap', gap: 5},
  machineRow: {
    marginTop: 10,
    paddingTop: 9,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  machineCopy: {flex: 1, minWidth: 0},
  machineLabel: {color: theme.textDim, fontSize: 8, fontWeight: '800'},
  machineName: {color: theme.text, fontSize: 10, fontWeight: '700', marginTop: 2},
  machineButton: {
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#1c2b22',
  },
  machineButtonText: {color: theme.accent, fontSize: 9, fontWeight: '800'},
  alternativeBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  alternativeCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '78%' as never,
    backgroundColor: theme.panel,
    borderColor: theme.borderLight,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  alternativeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  alternativeTitleGroup: {flex: 1},
  alternativeTitle: {color: theme.text, fontSize: 15, fontWeight: '700'},
  alternativeCount: {color: theme.textDim, fontSize: 10, marginTop: 2},
  alternativeClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
  },
  alternativeCloseText: {color: theme.textDim, fontSize: 22, lineHeight: 24},
  alternativeScroll: {maxHeight: 460},
  alternativeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
  },
});

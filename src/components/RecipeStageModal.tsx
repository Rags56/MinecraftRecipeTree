import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useMemo, useState} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {signalTarget} from '../analytics/signal';
import {useData} from '../data/DataContext';
import {useRecipeStages} from '../data/RecipeStageContext';
import {theme} from '../theme';
import {useUi} from '../ui/UiContext';
import {VisibilityIcon} from './VisibilityIcon';

export function RecipeStageModal({
  visible,
  onClose,
  interfaceZoom = 1,
}: {
  visible: boolean;
  onClose(): void;
  interfaceZoom?: number;
}) {
  const data = useData();
  const ui = useUi();
  const {
    catalog,
    hiddenStages,
    selectedStage,
    toggleStage,
    showAllStages,
    hideAllStages,
    selectStage,
  } = useRecipeStages();
  const [query, setQuery] = useState('');
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: 720 / interfaceZoom,
          maxHeight: `${88 / interfaceZoom}%`,
          minHeight: 360 / interfaceZoom,
        } as unknown as object)
      : null;

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const itemCount = catalog.stagesByItemKey.size;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredStages = useMemo(
    () =>
      catalog.stages.filter(summary => {
        if (!normalizedQuery) return true;
        if (summary.stage.toLocaleLowerCase().includes(normalizedQuery)) return true;
        return summary.itemKeys.some(itemKey => {
          const item = data.itemsByKey.get(itemKey);
          return (
            item?.n.toLocaleLowerCase().includes(normalizedQuery) ||
            item?.id.toLocaleLowerCase().includes(normalizedQuery)
          );
        });
      }),
    [catalog.stages, data.itemsByKey, normalizedQuery],
  );

  const browseStage = (stage: string) => {
    selectStage(stage);
    ui.setTab('items');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable
          style={[styles.card, scaledCardStyle]}
          onPress={() => {}}
          accessible={false}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title} accessibilityRole="header">
                Recipe stages
              </Text>
              <Text style={styles.subtitle}>
                {catalog.recipes.length} gated recipes · {itemCount} output items ·{' '}
                {catalog.stages.length} stages
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close recipe stage controls"
              focusable>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.explanation}>
            <Text style={styles.explanationText}>
              The eye controls whether recipes from a stage appear. Browse filters the item
              catalog to outputs with at least one recipe gated by that stage.
            </Text>
          </View>

          <View style={styles.toolbar}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search stages or output items"
              placeholderTextColor={theme.textDim}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search recipe stages"
            />
            <TouchableOpacity
              {...signalTarget('recipe-stages.show-all')}
              style={styles.bulkButton}
              onPress={showAllStages}
              accessibilityRole="button"
              accessibilityLabel="Show recipes from all stages">
              <VisibilityIcon visible size={14} />
              <Text style={styles.bulkButtonText}>Show all</Text>
            </TouchableOpacity>
            <TouchableOpacity
              {...signalTarget('recipe-stages.hide-all')}
              style={styles.bulkButton}
              onPress={hideAllStages}
              accessibilityRole="button"
              accessibilityLabel="Hide recipes from all stages">
              <VisibilityIcon visible={false} size={14} />
              <Text style={styles.bulkButtonText}>Hide all</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.resultCount} accessibilityLiveRegion="polite">
            {filteredStages.length} of {catalog.stages.length} stages
          </Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            accessibilityRole="list"
            accessibilityLabel="Recipe stage controls">
            {filteredStages.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No matching recipe stages</Text>
                <Text style={styles.emptyText}>Try a stage ID or an output item name.</Text>
              </View>
            ) : (
              filteredStages.map(summary => {
                const shown = !hiddenStages.has(summary.stage);
                const selected = selectedStage === summary.stage;
                return (
                  <View
                    key={summary.stage}
                    style={[styles.stageRow, selected && styles.stageRowSelected]}>
                    <View style={styles.stageCopy}>
                      <Text style={[styles.stageName, selected && styles.stageNameSelected]}>
                        {summary.stage}
                      </Text>
                      <Text style={styles.stageMeta}>
                        {summary.recipeCount}{' '}
                        {summary.recipeCount === 1 ? 'recipe' : 'recipes'} ·{' '}
                        {summary.itemCount} output {summary.itemCount === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      {...signalTarget('recipe-stages.visibility')}
                      style={[styles.visibilityButton, shown && styles.visibilityButtonShown]}
                      onPress={() => toggleStage(summary.stage)}
                      accessibilityRole="button"
                      accessibilityState={{selected: shown}}
                      accessibilityLabel={`${shown ? 'Hide' : 'Show'} recipes requiring stage ${summary.stage}`}>
                      <VisibilityIcon visible={shown} size={16} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      {...signalTarget('recipe-stages.browse')}
                      style={[styles.browseButton, selected && styles.browseButtonSelected]}
                      onPress={() => browseStage(summary.stage)}
                      accessibilityRole="button"
                      accessibilityState={{selected}}
                      accessibilityLabel={`Browse items and recipes gated by stage ${summary.stage}`}>
                      <Text
                        style={[
                          styles.browseButtonText,
                          selected && styles.browseButtonTextSelected,
                        ]}>
                        Browse
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.76)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  card: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '88%',
    minHeight: 360,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panel,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 19, fontWeight: '800'},
  subtitle: {color: theme.textDim, fontSize: 11, marginTop: 4},
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  closeText: {color: theme.textDim, fontSize: 16},
  explanation: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: 'rgba(90, 167, 250, 0.06)',
  },
  explanationText: {color: theme.textDim, fontSize: 11, lineHeight: 16},
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  searchInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 280,
    minWidth: 0,
    minHeight: 42,
    fontSize: 15,
    color: theme.text,
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    outlineStyle: 'none',
  } as object,
  bulkButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  bulkButtonText: {color: theme.text, fontSize: 11, fontWeight: '700'},
  resultCount: {
    color: theme.textDim,
    fontSize: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  list: {minHeight: 0},
  listContent: {paddingHorizontal: 12, paddingBottom: 12, gap: 7},
  stageRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  stageRowSelected: {
    borderColor: theme.accentAlt,
    backgroundColor: 'rgba(90, 167, 250, 0.08)',
  },
  stageCopy: {flex: 1, minWidth: 0},
  stageName: {color: theme.text, fontSize: 12, fontWeight: '700'},
  stageNameSelected: {color: theme.accentAlt},
  stageMeta: {color: theme.textDim, fontSize: 10, marginTop: 3},
  visibilityButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  visibilityButtonShown: {borderColor: theme.accent},
  browseButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  browseButtonSelected: {borderColor: theme.accentAlt},
  browseButtonText: {color: theme.textDim, fontSize: 11, fontWeight: '700'},
  browseButtonTextSelected: {color: theme.accentAlt},
  emptyState: {alignItems: 'center', padding: 28},
  emptyTitle: {color: theme.text, fontSize: 14, fontWeight: '700'},
  emptyText: {color: theme.textDim, fontSize: 11, marginTop: 5},
});

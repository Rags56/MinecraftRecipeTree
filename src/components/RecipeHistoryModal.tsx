import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useState} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useData} from '../data/DataContext';
import {loadRecipeHistory, type RecipeHistoryEntry} from '../graph/recipeHistory';
import {theme} from '../theme';
import {useUi} from '../ui/UiContext';
import {ItemIcon} from './ItemIcon';
import {RECIPE_HISTORY_ITEM_ICON_SIZE} from './itemIconSizing';

export function RecipeHistoryModal({
  visible,
  onClose,
  interfaceZoom = 1,
}: {
  visible: boolean;
  onClose: () => void;
  interfaceZoom?: number;
}) {
  const data = useData();
  const {openRecipeInGraph} = useUi();
  const [entries, setEntries] = useState<RecipeHistoryEntry[]>([]);
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: 680 / interfaceZoom,
          maxHeight: `${82 / interfaceZoom}%`,
        } as unknown as object)
      : null;

  useEffect(() => {
    if (!visible) return;
    const loaded = loadRecipeHistory(data.descriptor);
    const valid = loaded.filter(entry => {
      const category = data.categories[entry.ref[0]];
      return Boolean(category) && entry.ref[1] < category.count;
    });
    if (valid.length !== loaded.length) {
      console.error('Recipe history contained references outside the active pack publication.', {
        pack: data.descriptor.slug,
        rejectedEntries: loaded.length - valid.length,
      });
    }
    setEntries(valid);
  }, [visible, data.descriptor, data.categories]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, scaledCardStyle]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Recipe history</Text>
              <Text style={styles.subtitle}>
                {data.descriptor.displayName} · newest first · last 50 · stored on this device
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close recipe history"
              onPress={onClose}
              style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {entries.length === 0 ? (
              <Text style={styles.empty}>No recipe trees opened for this pack yet.</Text>
            ) : (
              entries.map(entry => {
                const item = data.itemsByKey.get(entry.itemKey);
                const itemName = item?.n ?? entry.itemKey;
                return (
                  <TouchableOpacity
                    key={`${entry.itemKey}:${entry.ref[0]}:${entry.ref[1]}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Reopen ${entry.title} ${entry.direction === 'outputs' ? 'output' : 'ingredient'} tree for ${itemName}`}
                    style={styles.row}
                    onPress={() => {
                      onClose();
                      openRecipeInGraph(
                        entry.itemKey,
                        entry.ref,
                        entry.direction ?? 'inputs',
                      );
                    }}>
                    <ItemIcon
                      item={item}
                      itemKey={entry.itemKey}
                      size={RECIPE_HISTORY_ITEM_ICON_SIZE}
                    />
                    <View style={styles.rowCopy}>
                      <Text style={styles.recipeTitle} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {itemName}
                        {entry.direction === 'outputs' ? ' · output tree' : ''}
                        {entry.recipeId ? ` · ${entry.recipeId}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.time}>{new Date(entry.openedAt).toLocaleString()}</Text>
                  </TouchableOpacity>
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '82%' as never,
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 17, fontWeight: '700'},
  subtitle: {color: theme.textDim, fontSize: 11, marginTop: 3},
  closeButton: {padding: 6},
  closeText: {color: theme.textDim, fontSize: 15},
  list: {marginTop: 12},
  listContent: {gap: 7, paddingBottom: 2},
  empty: {color: theme.textDim, textAlign: 'center', paddingVertical: 28},
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowCopy: {flex: 1, minWidth: 0},
  recipeTitle: {color: theme.text, fontSize: 13, fontWeight: '700'},
  itemName: {color: theme.textDim, fontSize: 10, marginTop: 3},
  time: {color: theme.textDim, fontSize: 9, textAlign: 'right', maxWidth: 120},
});

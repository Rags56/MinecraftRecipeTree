import {Modal} from '../ui/nativeUiScale';
import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {theme} from '../theme';

export interface AutoExpandSummaryEntry {
  id: string;
  itemName: string;
  recipeTitle: string;
  count: number;
}

export function AutoExpandSummaryModal({
  entries,
  interfaceZoom = 1,
  onClose,
}: {
  entries: AutoExpandSummaryEntry[] | null;
  interfaceZoom?: number;
  onClose(): void;
}) {
  const expandedCount = entries?.reduce((total, entry) => total + entry.count, 0) ?? 0;
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: 560 / interfaceZoom,
          maxHeight: `${86 / interfaceZoom}%`,
        } as unknown as object)
      : null;

  return (
    <Modal visible={entries !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel="Auto expand summary"
          style={[styles.card, scaledCardStyle]}
          onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Auto expand complete</Text>
              <Text style={styles.subtitle}>
                {expandedCount === 0
                  ? 'No new recipes were expanded.'
                  : `${expandedCount} recipe${expandedCount === 1 ? '' : 's'} expanded.`}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close auto expand summary"
              style={styles.closeButton}
              onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.sectionTitle}>How Auto Expand works</Text>
            <Text style={styles.explanation}>
              Existing branches stay unchanged. For each unexpanded ingredient, Recipe Tree uses
              your saved source first; otherwise it uses this pack version’s most-used community
              recipe. Newly revealed ingredients are checked the same way. Cyclic, unavailable,
              currently loading, and Unique-deferred nodes are skipped.
            </Text>

            <Text style={[styles.sectionTitle, styles.recipeSectionTitle]}>
              Recipes expanded this time
            </Text>
            {entries?.length ? (
              <View style={styles.recipeList}>
                {entries.map(entry => (
                  <View key={entry.id} style={styles.recipeRow}>
                    <View style={styles.recipeCopy}>
                      <Text style={styles.itemName}>{entry.itemName}</Text>
                      <Text style={styles.recipeTitle}>{entry.recipeTitle}</Text>
                    </View>
                    {entry.count > 1 && <Text style={styles.count}>×{entry.count}</Text>}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>
                Every eligible node was already expanded or had no saved/community recipe.
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity
            accessibilityRole="button"
            style={styles.doneButton}
            onPress={onClose}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panel,
  },
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 18, fontWeight: '800'},
  subtitle: {color: theme.accent, fontSize: 11, marginTop: 3},
  closeButton: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 16},
  scroll: {marginTop: 14},
  content: {paddingBottom: 4},
  sectionTitle: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  explanation: {color: theme.text, fontSize: 12, lineHeight: 18, marginTop: 7},
  recipeSectionTitle: {marginTop: 20},
  recipeList: {marginTop: 7},
  recipeRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  recipeCopy: {flex: 1},
  itemName: {color: theme.text, fontSize: 12, fontWeight: '700'},
  recipeTitle: {color: theme.textDim, fontSize: 11, lineHeight: 15, marginTop: 2},
  count: {color: theme.accent, fontSize: 12, fontWeight: '800'},
  emptyText: {color: theme.textDim, fontSize: 11, fontStyle: 'italic', marginTop: 8},
  doneButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  doneButtonText: {color: '#07120a', fontSize: 12, fontWeight: '800'},
});

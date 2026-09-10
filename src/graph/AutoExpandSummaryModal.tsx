import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ModalCard} from '../components/ModalCard';
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

  return (
    <ModalCard
      visible={entries !== null}
      onClose={onClose}
      title="Auto expand complete"
      subtitle={
        expandedCount === 0
          ? 'No new recipes were expanded.'
          : `${expandedCount} recipe${expandedCount === 1 ? '' : 's'} expanded.`
      }
      closeAccessibilityLabel="Close auto expand summary"
      interfaceZoom={interfaceZoom}
      maxWidth={560}
      accessibilityLabel="Auto expand summary"
      footer={
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.doneButton}
          onPress={onClose}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      }>
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
    </ModalCard>
  );
}

const styles = StyleSheet.create({
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

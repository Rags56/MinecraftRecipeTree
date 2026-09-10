import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ModalCard} from './ModalCard';
import {theme} from '../theme';

const highlights = [
  {
    title: 'Search the full catalog',
    description: 'Find any item by name, id, or mod, then jump straight to its recipes.',
  },
  {
    title: 'Build an ingredient tree',
    description: 'Tap a recipe to expand it into everything it needs, as deep as you want to go.',
  },
  {
    title: 'Switch layouts',
    description: 'Standard, radial, or compact — pick whichever reads best for the tree you built.',
  },
  {
    title: 'Calculate totals and export',
    description: 'See required resource totals, then export them as CSV or the tree itself as a PNG.',
  },
] as const;

export function WelcomeModal({
  visible,
  onClose,
  interfaceZoom = 1,
}: {
  visible: boolean;
  onClose: () => void;
  interfaceZoom?: number;
}) {

  return (
    <ModalCard
      visible={visible}
      onClose={onClose}
      title="Welcome to Recipe Tree"
      subtitle="A quick look at what you can do"
      closeAccessibilityLabel="Close welcome guide"
      interfaceZoom={interfaceZoom}
      maxWidth={560}
      footer={
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.getStartedButton}
          onPress={onClose}>
          <Text style={styles.getStartedText}>Get started</Text>
        </TouchableOpacity>
      }>
            <View style={styles.highlightList}>
              {highlights.map(highlight => (
                <View key={highlight.title} style={styles.highlightRow}>
                  <Text style={styles.highlightTitle}>{highlight.title}</Text>
                  <Text style={styles.description}>{highlight.description}</Text>
                </View>
              ))}
            </View>
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  highlightList: {gap: 12},
  highlightRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  highlightTitle: {color: theme.text, fontSize: 13, fontWeight: '700'},
  description: {color: theme.textDim, fontSize: 11, lineHeight: 16, marginTop: 3},
  getStartedButton: {
    marginTop: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  getStartedText: {color: theme.bg, fontSize: 13, fontWeight: '700'},
});

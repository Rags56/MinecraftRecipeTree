import React from 'react';
import {Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, scaledCardStyle]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Welcome to Recipe Tree</Text>
              <Text style={styles.subtitle}>A quick look at what you can do</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close welcome guide"
              onPress={onClose}
              style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.highlightList}>
              {highlights.map(highlight => (
                <View key={highlight.title} style={styles.highlightRow}>
                  <Text style={styles.highlightTitle}>{highlight.title}</Text>
                  <Text style={styles.description}>{highlight.description}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity
            accessibilityRole="button"
            style={styles.getStartedButton}
            onPress={onClose}>
            <Text style={styles.getStartedText}>Get started</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%' as never,
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
  scroll: {marginTop: 14},
  content: {paddingBottom: 2},
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

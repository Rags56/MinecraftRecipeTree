import React from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Modal} from '../ui/nativeUiScale';
import {theme} from '../theme';

/**
 * The backdrop-and-card shell every guide-style modal here was hand-rolling. Five of them had
 * independently grown the same defect -- a card capped by maxHeight around a ScrollView that was
 * still sized by its content, so the overflow was clipped with no way to scroll to it -- because
 * each one repeated the layout rather than sharing it. Owning the sizing in one place is what
 * stops the next modal from earning that bug again.
 */
export function ModalCard({
  visible,
  onClose,
  title,
  subtitle,
  closeAccessibilityLabel,
  interfaceZoom = 1,
  maxWidth = 620,
  maxHeightPercent = 86,
  contentContainerStyle,
  accessibilityLabel,
  footer,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  closeAccessibilityLabel: string;
  interfaceZoom?: number;
  maxWidth?: number;
  maxHeightPercent?: number;
  contentContainerStyle?: object;
  accessibilityLabel?: string;
  /** Pinned below the scroll region, so a primary action stays reachable however long the body. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: maxWidth / interfaceZoom,
          maxHeight: `${maxHeightPercent / interfaceZoom}%`,
        } as unknown as object)
      : null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel ?? title}
          style={[styles.card, {maxWidth, maxHeight: `${maxHeightPercent}%`} as object, scaledCardStyle]}
          onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={closeAccessibilityLabel}
              onPress={onClose}
              style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, contentContainerStyle]}>
            {children}
          </ScrollView>
          {footer}
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
  // 44 is the platform's minimum touch target; the padded glyph alone is well under it.
  closeButton: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 15},
  /**
   * The card is capped by maxHeight but sized by its content, so the scroller has to be allowed
   * to shrink; without this it reports that everything fits and the overflow is simply clipped.
   */
  scroll: {flexShrink: 1, minHeight: 0, marginTop: 14},
  content: {paddingBottom: 2},
});

import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Modal} from '../ui/nativeUiScale';
import {signalTarget} from '../analytics/signal';
import {theme} from '../theme';

export interface GraphSettingOption {
  key: string;
  label: string;
  description?: string;
  /** Toggles show their state; actions run and close the sheet. */
  kind: 'toggle' | 'action';
  active?: boolean;
  destructive?: boolean;
  metricsId: string;
  onPress(): void;
}

/**
 * The graph options as an overlay rather than a bar across the canvas. On a phone those buttons
 * cost several rows of the tree permanently, to be reached a few times a session; here they cost
 * nothing until asked for. The overlay stays translucent so the tree is still visible behind the
 * choices being made about it.
 */
export function GraphSettingsSheet({
  visible,
  options,
  onClose,
}: {
  visible: boolean;
  options: readonly GraphSettingOption[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel="Graph settings"
          style={styles.panel}
          onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Graph settings</Text>
            <TouchableOpacity
              {...signalTarget('graph.settings.close')}
              accessibilityRole="button"
              accessibilityLabel="Close graph settings"
              style={styles.closeButton}
              onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {options.map(option => (
              <TouchableOpacity
                key={option.key}
                {...signalTarget(option.metricsId)}
                accessibilityRole={option.kind === 'toggle' ? 'switch' : 'button'}
                accessibilityState={
                  option.kind === 'toggle' ? {checked: option.active === true} : undefined
                }
                style={[styles.row, option.active && styles.rowActive]}
                onPress={option.onPress}>
                <View style={styles.rowCopy}>
                  <Text
                    style={[
                      styles.rowLabel,
                      option.active && styles.rowLabelActive,
                      option.destructive && styles.rowLabelDestructive,
                    ]}>
                    {option.label}
                  </Text>
                  {option.description ? (
                    <Text style={styles.rowDescription}>{option.description}</Text>
                  ) : null}
                </View>
                {option.kind === 'toggle' && (
                  <View style={[styles.pill, option.active && styles.pillActive]}>
                    <Text style={[styles.pillText, option.active && styles.pillTextActive]}>
                      {option.active ? 'On' : 'Off'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Deliberately light: the tree stays legible behind the options that reshape it.
    backgroundColor: 'rgba(5,8,12,0.45)',
    justifyContent: 'flex-end',
  },
  panel: {
    maxHeight: '82%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: theme.borderLight,
    backgroundColor: 'rgba(23,29,38,0.93)',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 22,
  },
  header: {flexDirection: 'row', alignItems: 'center', gap: 12},
  title: {flex: 1, color: theme.text, fontSize: 16, fontWeight: '700'},
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {color: theme.textDim, fontSize: 17},
  /** Capped by the panel's maxHeight, so the list has to be allowed to shrink to scroll. */
  scroll: {flexShrink: 1, minHeight: 0, marginTop: 6},
  content: {paddingBottom: 4, gap: 8},
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  rowActive: {borderColor: theme.accent, backgroundColor: '#173724'},
  rowCopy: {flex: 1, minWidth: 0},
  rowLabel: {color: theme.text, fontSize: 14, fontWeight: '700'},
  rowLabelActive: {color: theme.accent},
  rowLabelDestructive: {color: theme.warn},
  rowDescription: {color: theme.textDim, fontSize: 11, lineHeight: 15, marginTop: 2},
  pill: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  pillActive: {borderColor: theme.accent},
  pillText: {color: theme.textDim, fontSize: 11, fontWeight: '700'},
  pillTextActive: {color: theme.accent},
});

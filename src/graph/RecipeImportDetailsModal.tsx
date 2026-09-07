import {Modal} from '../ui/nativeUiScale';
import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {theme} from '../theme.ts';

export interface RecipeImportDetail {
  path: number[];
  itemKey: string;
  itemName: string;
  recipeKey?: string;
  reason: 'unavailable' | 'dependent' | 'duplicate';
  message: string;
}

export interface RecipeImportReport {
  restoredCount: number;
  details: RecipeImportDetail[];
}

function reasonLabel(reason: RecipeImportDetail['reason']): string {
  if (reason === 'unavailable') return 'Recipe unavailable';
  if (reason === 'duplicate') return 'Duplicate path';
  return 'Parent not restored';
}

export function RecipeImportDetailsModal({
  report,
  interfaceZoom,
  onClose,
}: {
  report: RecipeImportReport | null;
  interfaceZoom: number;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={report !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            Platform.OS === 'web'
              ? ({
                  zoom: interfaceZoom,
                  width: `${100 / interfaceZoom}%`,
                  maxWidth: 620 / interfaceZoom,
                  maxHeight: `${88 / interfaceZoom}%`,
                } as unknown as object)
              : null,
          ]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Partial import details</Text>
              <Text style={styles.subtitle}>
                {report
                  ? `${report.restoredCount} restored · ${report.details.length} skipped`
                  : ''}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close partial import details"
              style={styles.close}
              onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {report?.details.map((detail, index) => (
              <View key={`${detail.path.join('.')}:${detail.itemKey}:${index}`} style={styles.row}>
                <View style={styles.rowHeading}>
                  <Text style={styles.itemName}>{detail.itemName}</Text>
                  <Text style={styles.reason}>{reasonLabel(detail.reason)}</Text>
                </View>
                <Text style={styles.path}>
                  Tree path: {detail.path.length === 0 ? 'starting item' : detail.path.join(' → ')}
                </Text>
                <Text selectable style={styles.message}>{detail.message}</Text>
                {detail.recipeKey ? (
                  <Text selectable style={styles.recipeKey}>{detail.recipeKey}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity accessibilityRole="button" style={styles.done} onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    maxWidth: 620,
    maxHeight: '88%',
    padding: 16,
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panel,
  },
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 18, fontWeight: '800'},
  subtitle: {color: theme.textDim, fontSize: 11, marginTop: 3},
  close: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 24, lineHeight: 26},
  scroll: {flexShrink: 1},
  content: {gap: 9},
  row: {
    padding: 11,
    gap: 4,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  rowHeading: {flexDirection: 'row', alignItems: 'center', gap: 8},
  itemName: {flex: 1, color: theme.text, fontSize: 12, fontWeight: '800'},
  reason: {color: theme.warn, fontSize: 9, fontWeight: '900', textTransform: 'uppercase'},
  path: {color: theme.textDim, fontSize: 9},
  message: {color: theme.text, fontSize: 10, lineHeight: 14},
  recipeKey: {color: theme.textDim, fontSize: 9, lineHeight: 12},
  done: {
    alignSelf: 'flex-end',
    minWidth: 104,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  doneText: {color: '#07120a', fontSize: 12, fontWeight: '800'},
});

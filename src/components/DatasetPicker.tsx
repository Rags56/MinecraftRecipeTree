import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useMemo, useState} from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ImageErrorEvent,
} from 'react-native';
import {useSafeAreaInsets} from '../ui/safeArea';
import type {DatasetDescriptor} from '../data/datasetCatalog';
import {datasetPackIconPath} from '../data/datasetPresentation';
import {isLocalPackDescriptor} from '../data/localPackStorage';
import {fuzzySearchScore, normalizeSearchText} from '../data/fuzzySearch';
import {theme} from '../theme';

const PRODUCTION_ORIGIN = 'https://minecraftrecipetree.craftsmannsoftware.com';

function PackIcon({dataset}: {dataset: DatasetDescriptor}) {
  const [failed, setFailed] = useState(false);
  const path = datasetPackIconPath(dataset.slug);

  useEffect(() => {
    if (path !== null || isLocalPackDescriptor(dataset)) return;
    console.error('Published modpack has no configured picker icon.', {
      slug: dataset.slug,
      displayName: dataset.displayName,
    });
  }, [dataset.displayName, dataset.slug, path]);

  if (path === null || failed) {
    return (
      <View
        style={styles.packIconFallback}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${dataset.displayName} pack icon unavailable`}>
        <Text style={styles.packIconFallbackText}>
          {dataset.displayName.trim().charAt(0).toUpperCase() || '?'}
        </Text>
      </View>
    );
  }

  const uri = Platform.OS === 'web' ? path : `${PRODUCTION_ORIGIN}${path}`;
  const onError = (event: ImageErrorEvent) => {
    console.error('Published modpack picker icon failed to load.', {
      slug: dataset.slug,
      uri,
      detail: event.nativeEvent.error,
    });
    setFailed(true);
  };
  return (
    <Image
      source={{uri}}
      style={styles.packIcon}
      resizeMode="cover"
      onError={onError}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${dataset.displayName} pack icon`}
    />
  );
}

export function DatasetPicker({
  visible,
  datasets,
  selectedSlug,
  onSelect,
  onDeleteLocal,
  onClose,
}: {
  visible: boolean;
  datasets: readonly DatasetDescriptor[];
  selectedSlug: string | null;
  onSelect(slug: string): void;
  onDeleteLocal(slug: string): Promise<void>;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const safeAreaInsets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setDeletingSlug(null);
      setDeleteError(null);
    }
  }, [visible]);

  const confirmDelete = (dataset: DatasetDescriptor): Promise<boolean> => {
    const message =
      'This removes the saved pack and its recipe files from this browser. Your original ZIP is not affected.';
    if (Platform.OS === 'web') {
      return Promise.resolve(window.confirm(`Delete ${dataset.displayName}?\n\n${message}`));
    }
    return new Promise(resolve => {
      Alert.alert(`Delete ${dataset.displayName}?`, message, [
        {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
        {text: 'Delete', style: 'destructive', onPress: () => resolve(true)},
      ], {cancelable: true, onDismiss: () => resolve(false)});
    });
  };

  const deleteDataset = async (dataset: DatasetDescriptor) => {
    if (deletingSlug !== null || !(await confirmDelete(dataset))) return;
    setDeletingSlug(dataset.slug);
    setDeleteError(null);
    try {
      await onDeleteLocal(dataset.slug);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingSlug(null);
    }
  };

  const filteredDatasets = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    const matches = datasets
      .map(dataset => ({
        dataset,
        score: normalizedQuery
          ? fuzzySearchScore(
              normalizedQuery,
              [
                dataset.displayName,
                dataset.slug,
                dataset.minecraftVersion,
                dataset.packVersion,
              ].map(normalizeSearchText),
            )
          : 0,
      }))
      .filter(match => match.score != null);
    return matches.sort((left, right) => {
      if (left.dataset.slug === selectedSlug) return -1;
      if (right.dataset.slug === selectedSlug) return 1;
      if (left.score !== right.score) return left.score! - right.score!;
      return left.dataset.displayName.localeCompare(right.dataset.displayName, undefined, {
        sensitivity: 'base',
      });
    }).map(match => match.dataset);
  }, [datasets, query, selectedSlug]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      onRequestClose={onClose}
      accessibilityViewIsModal>
      <Pressable
        style={[styles.backdrop, Platform.OS !== 'web' && styles.backdropNative]}
        onPress={onClose}
        accessible={false}>
        <Pressable
          style={[
            styles.card,
            Platform.OS !== 'web' && styles.cardNative,
            Platform.OS !== 'web' && {paddingBottom: safeAreaInsets.bottom},
          ]}
          onPress={() => {}}
          accessible={false}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Choose a modpack
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close modpack picker"
              focusable>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchRegion}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, Minecraft version, or pack version"
              placeholderTextColor={theme.textDim}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search modpacks"
              accessibilityHint="Filters by pack name, identifier, Minecraft version, or pack version"
              onSubmitEditing={() => {
                if (filteredDatasets.length === 1) onSelect(filteredDatasets[0].slug);
              }}
            />
            {query.length > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear modpack search"
                focusable>
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.resultCount} accessibilityLiveRegion="polite">
              {filteredDatasets.length} of {datasets.length}{' '}
              {datasets.length === 1 ? 'pack' : 'packs'}
            </Text>
            {deleteError !== null && (
              <Text style={styles.deleteError} accessibilityRole="alert">
                {deleteError}
              </Text>
            )}
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            accessibilityRole="list"
            accessibilityLabel="Modpacks">
            {filteredDatasets.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No matching modpacks</Text>
                <Text style={styles.emptyText}>
                  Try a pack name, Minecraft version, or pack release number.
                </Text>
              </View>
            ) : filteredDatasets.map(dataset => {
              const selected = dataset.slug === selectedSlug;
              const local = isLocalPackDescriptor(dataset);
              const deleting = deletingSlug === dataset.slug;
              return (
                <View
                  key={dataset.slug}
                  style={[styles.option, selected && styles.optionSelected]}>
                  <TouchableOpacity
                    style={styles.optionSelect}
                    onPress={() => onSelect(dataset.slug)}
                    accessibilityRole="button"
                    accessibilityState={{selected}}
                    accessibilityLabel={`${dataset.displayName}, Minecraft ${dataset.minecraftVersion}, pack version ${dataset.packVersion}${selected ? ', selected' : ''}`}
                    accessibilityHint="Loads this modpack's recipe dataset"
                    focusable>
                    <PackIcon dataset={dataset} />
                    <View style={styles.optionCopy}>
                      <Text style={[styles.optionName, selected && styles.optionNameSelected]}>
                        {dataset.displayName}
                      </Text>
                      <Text style={styles.optionMeta}>
                        {local ? 'On this device · ' : ''}
                        Minecraft {dataset.minecraftVersion} · pack {dataset.packVersion}
                      </Text>
                    </View>
                    <Text style={[styles.selection, selected && styles.selectionActive]}>
                      {selected ? 'Active' : 'Open'}
                    </Text>
                  </TouchableOpacity>
                  {local && (
                    <TouchableOpacity
                      style={[styles.deleteButton, deleting && styles.deleteButtonDisabled]}
                      onPress={() => void deleteDataset(dataset)}
                      disabled={deletingSlug !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete local pack ${dataset.displayName}`}
                      accessibilityHint="Removes this pack and its recipe files from this browser"
                      accessibilityState={{disabled: deletingSlug !== null, busy: deleting}}
                      focusable>
                      <Text style={styles.deleteButtonText}>{deleting ? 'Deleting…' : 'Delete'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
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
    padding: 18,
  },
  backdropNative: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  card: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '82%',
    minHeight: 240,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panel,
    overflow: 'hidden',
  },
  cardNative: {
    maxWidth: '100%',
    maxHeight: '92%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: {flex: 1, color: theme.text, fontSize: 19, fontWeight: '800'},
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  closeText: {color: theme.textDim, fontSize: 16},
  searchRegion: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  searchInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 260,
    minWidth: 0,
    minHeight: 44,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    outlineStyle: 'none',
  } as object,
  clearButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  clearButtonText: {color: theme.accent, fontSize: 12, fontWeight: '700'},
  resultCount: {color: theme.textDim, fontSize: 10, paddingHorizontal: 2},
  deleteError: {width: '100%', color: '#fb7185', fontSize: 12, lineHeight: 17},
  list: {minHeight: 0},
  listContent: {padding: 12, gap: 10},
  option: {
    minHeight: 68,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  optionSelect: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionSelected: {
    borderColor: theme.accent,
    backgroundColor: 'rgba(74, 222, 128, 0.08)',
  },
  packIcon: {
    width: 48,
    height: 48,
    flexShrink: 0,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.bg,
  },
  packIconFallback: {
    width: 48,
    height: 48,
    flexShrink: 0,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packIconFallbackText: {color: theme.textDim, fontSize: 20, fontWeight: '800'},
  optionCopy: {flex: 1, minWidth: 0},
  optionName: {color: theme.text, fontSize: 15, fontWeight: '700'},
  optionNameSelected: {color: theme.accent},
  optionMeta: {color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 3},
  selection: {color: theme.textDim, fontSize: 12, fontWeight: '700'},
  selectionActive: {color: theme.accent},
  deleteButton: {
    minWidth: 64,
    minHeight: 44,
    marginRight: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#be123c',
    backgroundColor: 'rgba(190, 18, 60, 0.12)',
  },
  deleteButtonDisabled: {opacity: 0.55},
  deleteButtonText: {color: '#fb7185', fontSize: 12, fontWeight: '800'},
  emptyState: {alignItems: 'center', paddingHorizontal: 18, paddingVertical: 38},
  emptyTitle: {color: theme.text, fontSize: 15, fontWeight: '700'},
  emptyText: {color: theme.textDim, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center'},
});

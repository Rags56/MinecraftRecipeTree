import {Modal} from '../ui/nativeUiScale';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useData} from '../data/DataContext';
import {theme} from '../theme';

interface ModpackSnapshot {
  minecraftVersion: string;
  mods: {id: string; name: string; itemCount: number}[];
  counts: {items: number; recipes: number; mobs: number};
}

interface SavedModpack {
  id: string;
  name: string;
  minecraftVersion: string;
  snapshot: ModpackSnapshot;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {'Content-Type': 'application/json', ...(init?.headers ?? {})},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {error?: string} | null;
    throw new Error(body?.error ?? `Request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function ModpackManager({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose(): void;
}) {
  const data = useData();
  const [packs, setPacks] = useState<SavedModpack[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentSnapshot = useMemo<ModpackSnapshot>(
    () => ({
      minecraftVersion: data.manifest.minecraft ?? 'Unknown',
      mods: data.mods.map(mod => ({
        id: mod.id,
        name: mod.name,
        itemCount: mod.itemCount,
      })),
      counts: {
        items: data.items.length,
        recipes: data.manifest.counts?.recipes ?? 0,
        mobs: data.mobs.length,
      },
    }),
    [data],
  );

  const loadPacks = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{modpacks: SavedModpack[]}>('/api/modpacks');
      setPacks(result.modpacks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void loadPacks();
  }, [visible, loadPacks]);

  const saveCurrent = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name for this snapshot.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/modpacks', {
        method: 'POST',
        body: JSON.stringify({name: trimmed, snapshot: currentSnapshot}),
      });
      setName('');
      await loadPacks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const updatePack = async (pack: SavedModpack) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/modpacks/${encodeURIComponent(pack.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({snapshot: currentSnapshot}),
      });
      await loadPacks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const deletePack = async (pack: SavedModpack) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/modpacks/${encodeURIComponent(pack.id)}`, {method: 'DELETE'});
      await loadPacks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <View style={{flex: 1}}>
              <Text style={styles.title}>Saved snapshots</Text>
              <Text style={styles.subtitle}>
                Save or refresh a named snapshot of the active recipe export.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.saveRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Snapshot name"
              placeholderTextColor={theme.textDim}
              style={styles.input}
              maxLength={80}
              editable={!busy}
              onSubmitEditing={() => void saveCurrent()}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void saveCurrent()}>
              <Text style={styles.primaryText}>Save current</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.currentSummary}>
            <Text style={styles.currentLabel}>ACTIVE EXPORT</Text>
            <Text style={styles.currentText}>
              Minecraft {currentSnapshot.minecraftVersion} · {currentSnapshot.mods.length} mods ·{' '}
              {currentSnapshot.counts.items} items · {currentSnapshot.counts.recipes} recipes
            </Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {busy && packs.length === 0 ? (
              <ActivityIndicator color={theme.accent} style={{margin: 24}} />
            ) : packs.length === 0 ? (
              <Text style={styles.empty}>No snapshots saved yet.</Text>
            ) : (
              packs.map(pack => (
                <View key={pack.id} style={styles.pack}>
                  <View style={{flex: 1, minWidth: 180}}>
                    <Text style={styles.packName}>{pack.name}</Text>
                    <Text style={styles.packMeta}>
                      Minecraft {pack.minecraftVersion} · {pack.snapshot.mods.length} mods ·{' '}
                      {pack.snapshot.counts.items} items
                    </Text>
                    <Text style={styles.packDate}>
                      Revision {pack.revision} · updated {formatDate(pack.updatedAt)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => void updatePack(pack)}>
                    <Text style={styles.secondaryText}>Update from current</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.deleteBtn, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => void deletePack(pack)}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))
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
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '86%',
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: 18,
  },
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  title: {color: theme.text, fontSize: 20, fontWeight: '800'},
  subtitle: {color: theme.textDim, fontSize: 12, marginTop: 4},
  closeBtn: {padding: 6},
  closeText: {color: theme.textDim, fontSize: 16},
  saveRow: {flexDirection: 'row', gap: 8, marginTop: 18, flexWrap: 'wrap'},
  input: {
    flex: 1,
    minWidth: 220,
    color: theme.text,
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  } as object,
  primaryBtn: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryText: {color: '#0b2613', fontWeight: '800'},
  currentSummary: {
    backgroundColor: theme.panelAlt,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  currentLabel: {color: theme.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1},
  currentText: {color: theme.text, fontSize: 12, marginTop: 4},
  error: {color: theme.warn, marginTop: 10, fontSize: 12},
  list: {marginTop: 12},
  listContent: {gap: 8, paddingBottom: 4},
  empty: {color: theme.textDim, textAlign: 'center', padding: 28},
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 9,
    padding: 12,
  },
  packName: {color: theme.text, fontSize: 14, fontWeight: '700'},
  packMeta: {color: theme.textDim, fontSize: 11, marginTop: 3},
  packDate: {color: theme.textDim, fontSize: 10, marginTop: 3},
  secondaryBtn: {
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryText: {color: theme.accent, fontSize: 11, fontWeight: '700'},
  deleteBtn: {paddingHorizontal: 8, paddingVertical: 8},
  deleteText: {color: theme.warn, fontSize: 11},
  disabled: {opacity: 0.5},
});

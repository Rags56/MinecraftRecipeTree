import {Modal} from '../ui/nativeUiScale';
import React, {useMemo, useState} from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {ModInfo, useData} from '../data/DataContext';
import {fuzzySearchScore, normalizeSearchText} from '../data/fuzzySearch';
import {theme} from '../theme';
import {Mob} from '../types';
import {useUi} from '../ui/UiContext';
import {DropList} from './DropList';
import {MobSprite} from './MobSprite';
import {ModFilter, SearchBar} from './SearchBar';

const CELL_W = 150;

export function MobsScreen() {
  const data = useData();
  const {animateMobs, toggleAnimateMobs} = useUi();
  const [query, setQuery] = useState('');
  const [mod, setMod] = useState<string | null>(null);
  const [selected, setSelected] = useState<Mob | null>(null);
  const {width} = useWindowDimensions();

  const mobMods = useMemo<ModInfo[]>(() => {
    const counts = new Map<string, number>();
    for (const m of data.mobs) counts.set(m.m, (counts.get(m.m) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, itemCount]) => ({id, name: data.manifest.mods?.[id] ?? id, itemCount}))
      .sort((a, b) => b.itemCount - a.itemCount);
  }, [data.mobs, data.manifest.mods]);

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query);
    return data.mobs
      .map(m => ({
        m,
        score: q
          ? fuzzySearchScore(q, [normalizeSearchText(m.n), normalizeSearchText(m.id)])
          : 0,
      }))
      .filter(match => (!mod || match.m.m === mod) && match.score != null)
      .sort((left, right) => left.score! - right.score!)
      .map(match => match.m);
  }, [data.mobs, query, mod]);

  const columns = Math.max(2, Math.min(8, Math.floor(width / CELL_W)));

  if (data.mobs.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>
          This export does not include a mob catalog. Item and recipe browsing remain available.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SearchBar value={query} onChange={setQuery} placeholder={`Search ${data.mobs.length} mobs…`} />
      <View style={styles.filterRow}>
        <View style={{flex: 1}}>
          <ModFilter mods={mobMods} selected={mod} onSelect={setMod} />
        </View>
        <TouchableOpacity style={styles.animToggle} onPress={toggleAnimateMobs}>
          <Text style={styles.animToggleText}>{animateMobs ? '⏸ animation' : '▶ animation'}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        key={`mobgrid-${columns}`}
        data={filtered}
        numColumns={columns}
        keyExtractor={m => m.id}
        windowSize={7}
        contentContainerStyle={styles.gridContent}
        renderItem={({item}) => (
          <TouchableOpacity
            style={[styles.cell, {width: `${100 / columns}%` as never}]}
            onPress={() => setSelected(item)}>
            <MobSprite mob={item} size={110} animate={animateMobs} />
            <Text style={styles.cellName} numberOfLines={1}>
              {item.n}
            </Text>
            <Text style={styles.cellSub} numberOfLines={1}>
              {item.hp != null ? `♥ ${item.hp}` : ''} {item.m}
            </Text>
          </TouchableOpacity>
        )}
      />
      {selected && (
      <Modal visible transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          {selected && (
            <Pressable style={styles.card} onPress={() => {}}>
              <MobSprite mob={selected} size={220} animate={animateMobs} />
              <Text style={styles.bigName}>{selected.n}</Text>
              <Text style={styles.statLine}>{selected.id}</Text>
              <View style={styles.statsRow}>
                <Stat label="Mod" value={data.manifest.mods?.[selected.m] ?? selected.m} />
                {selected.hp != null && <Stat label="Health" value={`${selected.hp} ♥`} />}
                <Stat label="Size" value={`${selected.w.toFixed(2)} × ${selected.h.toFixed(2)}`} />
                <Stat label="Category" value={selected.cat} />
              </View>
              {selected.drops?.length ? (
                <ScrollView style={styles.dropsScroll}>
                  <DropList title="Drops (per player kill)" drops={selected.drops} />
                </ScrollView>
              ) : (
                <Text style={styles.noDrops}>no loot-table drops recorded</Text>
              )}
              <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </Pressable>
          )}
        </Pressable>
      </Modal>
      )}
    </View>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, minHeight: 0},
  emptyWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30},
  emptyText: {color: theme.textDim, textAlign: 'center', maxWidth: 420, lineHeight: 20},
  gridContent: {paddingHorizontal: 6, paddingTop: 8, paddingBottom: 24},
  cell: {alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4},
  filterRow: {flexDirection: 'row', alignItems: 'center', paddingRight: 10},
  animToggle: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
    marginLeft: 6,
  },
  animToggleText: {color: theme.textDim, fontSize: 12},
  cellName: {color: theme.text, fontSize: 12, marginTop: 4},
  cellSub: {color: theme.textDim, fontSize: 10, marginTop: 2},
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
  },
  bigName: {color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 8},
  dropsScroll: {alignSelf: 'stretch', maxHeight: 240, marginTop: 4},
  noDrops: {color: theme.textDim, fontSize: 11, marginTop: 12},
  statLine: {color: theme.textDim, fontSize: 11, marginTop: 2},
  statsRow: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12, gap: 14},
  stat: {alignItems: 'center', minWidth: 70},
  statLabel: {color: theme.textDim, fontSize: 10, textTransform: 'uppercase'},
  statValue: {color: theme.text, fontSize: 13, marginTop: 2},
  closeBtn: {
    marginTop: 16,
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  closeBtnText: {color: theme.text},
});

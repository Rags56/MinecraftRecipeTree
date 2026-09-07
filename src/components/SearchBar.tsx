import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useMemo, useState} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ModInfo} from '../data/DataContext';
import {signalTarget} from '../analytics/signal';
import {theme} from '../theme';
import {DisclosureChevron} from './DisclosureChevron';
import {fuzzySearchScore, normalizeSearchText} from '../data/fuzzySearch';

export function SearchBar({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.searchWrap, style]}>
      <Text style={styles.searchIcon}>⌕</Text>
      <TextInput
        accessibilityLabel={placeholder}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textDim}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {value.length > 0 && (
        <TouchableOpacity
          {...signalTarget('search.clear')}
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onChange('')}>
          <Text style={styles.clear}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Searchable, virtualized mod selector suitable for modpacks with hundreds of mods. */
export function ModFilter({
  mods,
  selected,
  onSelect,
  style,
}: {
  mods: ModInfo[];
  selected: string | null;
  onSelect: (modId: string | null) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedMod = useMemo(() => mods.find(mod => mod.id === selected), [mods, selected]);
  const filteredMods = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return mods;

    return mods
      .map(mod => ({
        mod,
        score: fuzzySearchScore(normalizedQuery, [
          normalizeSearchText(mod.name),
          normalizeSearchText(mod.id),
        ]),
      }))
      .filter(match => match.score != null)
      .sort((left, right) => left.score! - right.score!)
      .map(match => match.mod);
  }, [mods, query]);

  useEffect(() => {
    if (selected !== null && selectedMod == null) {
      console.error(`[ModFilter] Selected mod "${selected}" is not present in the supplied mod list.`);
    }
  }, [selected, selectedMod]);

  const close = () => setOpen(false);
  const choose = (modId: string | null) => {
    onSelect(modId !== null && modId === selected ? null : modId);
    close();
  };
  const openSelector = () => {
    setQuery('');
    setOpen(true);
  };
  const triggerLabel = selected === null
    ? 'All mods'
    : `${selectedMod?.name ?? selected}${selectedMod ? ` (${selectedMod.itemCount})` : ''}`;

  return (
    <View style={[styles.filterWrap, style]}>
      <TouchableOpacity
        {...signalTarget('filter.mod.open')}
        accessibilityHint="Opens a searchable list of mods"
        accessibilityLabel={`Mod filter, ${triggerLabel}`}
        accessibilityRole="combobox"
        accessibilityState={{expanded: open}}
        onPress={openSelector}
        style={[styles.filterButton, selected !== null && styles.filterButtonActive]}>
        <View style={styles.filterButtonCopy}>
          <Text style={styles.filterButtonLabel}>MOD FILTER</Text>
          <Text style={[styles.filterButtonText, selected !== null && styles.filterButtonTextActive]} numberOfLines={1}>
            {triggerLabel}
          </Text>
        </View>
        <View style={styles.filterChevron}>
          <DisclosureChevron expanded={false} color={theme.textDim} size={16} />
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            accessibilityLabel="Mod filter"
            accessibilityRole="radiogroup"
            accessibilityViewIsModal
            style={styles.selectorCard}
            onPress={() => {}}>
            <View style={styles.selectorHeader}>
              <View style={styles.selectorHeadingCopy}>
                <Text style={styles.selectorTitle}>Filter by mod</Text>
                <Text style={styles.selectorSubtitle}>{mods.length} mods available</Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close mod filter"
                accessibilityRole="button"
                hitSlop={8}
                onPress={close}
                style={styles.selectorClose}>
                <Text style={styles.selectorCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.selectorSearch}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput
                accessibilityLabel="Search mods"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={setQuery}
                placeholder="Search by mod name or ID…"
                placeholderTextColor={theme.textDim}
                returnKeyType="search"
                style={styles.selectorInput}
                value={query}
              />
              {query.length > 0 && (
                <TouchableOpacity
                  accessibilityLabel="Clear mod search"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setQuery('')}>
                  <Text style={styles.clear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text accessibilityLiveRegion="polite" style={styles.resultCount}>
              {query.trim() ? `${filteredMods.length} matching mods` : 'Sorted by item count'}
            </Text>

            <ModOption
              active={selected === null}
              itemCount={null}
              label="All mods"
              modId="Show the complete catalog"
              onPress={() => choose(null)}
            />
            <FlatList
              data={filteredMods}
              initialNumToRender={12}
              keyboardShouldPersistTaps="handled"
              keyExtractor={mod => mod.id}
              ListEmptyComponent={
                <View style={styles.emptyResults}>
                  <Text style={styles.emptyResultsTitle}>No matching mods</Text>
                  <Text style={styles.emptyResultsText}>Try another mod name or namespace.</Text>
                </View>
              }
              maxToRenderPerBatch={16}
              renderItem={({item}) => (
                <ModOption
                  active={selected === item.id}
                  itemCount={item.itemCount}
                  label={item.name}
                  modId={item.id}
                  onPress={() => choose(item.id)}
                />
              )}
              style={styles.modList}
              updateCellsBatchingPeriod={40}
              windowSize={7}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ModOption({
  active,
  itemCount,
  label,
  modId,
  onPress,
}: {
  active: boolean;
  itemCount: number | null;
  label: string;
  modId: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={`${label}${itemCount == null ? '' : `, ${itemCount} items`}`}
      accessibilityRole="radio"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={[styles.modOption, active && styles.modOptionActive]}>
      <View style={styles.modOptionCopy}>
        <Text style={[styles.modOptionName, active && styles.modOptionNameActive]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.modOptionId} numberOfLines={1}>{modId}</Text>
      </View>
      {itemCount != null && <Text style={styles.modOptionCount}>{itemCount.toLocaleString()}</Text>}
      <View style={[styles.radio, active && styles.radioActive]}>
        {active && <View style={styles.radioDot} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginHorizontal: 10,
    marginTop: 8,
  },
  searchIcon: {color: theme.textDim, fontSize: 16, marginRight: 6},
  input: {
    flex: 1,
    color: theme.text,
    paddingVertical: 8,
    fontSize: 16,
    outlineWidth: 0,
  },
  clear: {color: theme.textDim, fontSize: 14, padding: 4},
  filterWrap: {minWidth: 0, marginHorizontal: 10, marginTop: 8},
  filterButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  filterButtonActive: {borderColor: theme.accent},
  filterButtonCopy: {flex: 1, minWidth: 0},
  filterButtonLabel: {color: theme.textDim, fontSize: 8, fontWeight: '700', letterSpacing: 0.6},
  filterButtonText: {color: theme.text, fontSize: 12, marginTop: 1},
  filterButtonTextActive: {color: theme.accent, fontWeight: '700'},
  filterChevron: {marginLeft: 8},
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    padding: 16,
  },
  selectorCard: {
    width: '100%',
    maxWidth: 560,
    height: '82%',
    maxHeight: 680,
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  selectorHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: 12},
  selectorHeadingCopy: {flex: 1, minWidth: 0},
  selectorTitle: {color: theme.text, fontSize: 18, fontWeight: '700'},
  selectorSubtitle: {color: theme.textDim, fontSize: 11, marginTop: 2},
  selectorClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
  },
  selectorCloseText: {color: theme.textDim, fontSize: 14},
  selectorSearch: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  selectorInput: {flex: 1, color: theme.text, fontSize: 16, paddingVertical: 8, outlineWidth: 0},
  resultCount: {color: theme.textDim, fontSize: 10, minHeight: 26, paddingHorizontal: 2, paddingTop: 7},
  modList: {flex: 1, minHeight: 0},
  modOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  modOptionActive: {backgroundColor: '#1c2b22'},
  modOptionCopy: {flex: 1, minWidth: 0},
  modOptionName: {color: theme.text, fontSize: 13},
  modOptionNameActive: {color: theme.accent, fontWeight: '700'},
  modOptionId: {color: theme.textDim, fontSize: 10, marginTop: 2},
  modOptionCount: {color: theme.textDim, fontSize: 11, marginHorizontal: 10},
  radio: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderColor: theme.textDim,
    borderWidth: 1,
  },
  radioActive: {borderColor: theme.accent},
  radioDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent},
  emptyResults: {alignItems: 'center', justifyContent: 'center', paddingVertical: 34, paddingHorizontal: 16},
  emptyResultsTitle: {color: theme.text, fontSize: 13, fontWeight: '700'},
  emptyResultsText: {color: theme.textDim, fontSize: 11, marginTop: 4, textAlign: 'center'},
});

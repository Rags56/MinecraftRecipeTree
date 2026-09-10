import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {DisclosureChevron} from '../components/DisclosureChevron';
import {PickerModal, type PickerOption} from '../components/PickerModal';
import {RecipeCard} from '../components/RecipeCard';
import {recipeImagePath, useData} from '../data/DataContext';
import {isDefaultDisabledRecipeCategory} from '../data/recipeCategories';
import {
  type PersonalRecipeFavorite,
  type RecipeFavoriteLeaderboardEntry,
  claimAnonymousRecipeFavorites,
  cleanupInvalidPersonalRecipeFavorites,
  loadPersonalRecipeFavorites,
  loadRecipeFavoriteLeaderboard,
  updateCommunityRecipeFavorite,
} from '../data/recipeFavorites';
import {recipeDisplayTitle} from '../data/recipeTitles';
import {slotSummary} from '../data/slotSummary';
import {materialInputSummary} from '../graph/direction';
import {
  type PreferredSource,
  loadPreferredSources,
  persistPreferredSources,
} from '../graph/preferredSources';
import {theme} from '../theme';
import type {Recipe, RecipeRef} from '../types';
import {useUser} from './UserContext';

interface FavoriteRecipeChoice {
  ref: RecipeRef;
  recipe: Recipe;
  title: string;
  option: PickerOption;
}

type FavoriteChoiceState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'ready'; choices: FavoriteRecipeChoice[]}
  | {status: 'error'; message: string};

function recipeRefKey(ref: RecipeRef): string {
  return `${ref[0]}:${ref[1]}`;
}

export function FavoritesModal({
  visible,
  interfaceZoom = 1,
  contentZoom = 1,
  onContentZoomChange,
  onContentZoomComplete,
  onClose,
}: {
  visible: boolean;
  interfaceZoom?: number;
  contentZoom?: number;
  onContentZoomChange?: (value: number) => void;
  onContentZoomComplete?: (value: number) => void;
  onClose(): void;
}) {
  const data = useData();
  const account = useUser();
  const {width: viewportWidth} = useWindowDimensions();
  const [leaderboard, setLeaderboard] = useState<RecipeFavoriteLeaderboardEntry[]>([]);
  const [personal, setPersonal] = useState<PersonalRecipeFavorite[]>([]);
  const [selectedTab, setSelectedTab] = useState<'mine' | 'leaderboard'>(
    account.user ? 'mine' : 'leaderboard',
  );
  const [loading, setLoading] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [favoriteSearch, setFavoriteSearch] = useState('');
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const [choiceState, setChoiceState] = useState<FavoriteChoiceState>({status: 'idle'});
  const [pendingItemKey, setPendingItemKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerItemKey, setPickerItemKey] = useState<string | null>(null);
  const [collapsedPickerGroupKeys, setCollapsedPickerGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const closeRecipePicker = () => {
    setPickerItemKey(null);
    setCollapsedPickerGroupKeys(new Set());
  };

  const toggleRecipePickerGroup = (groupKey: string) => {
    setCollapsedPickerGroupKeys(current => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setPersonalError(null);
    setLeaderboardError(null);
    setCleanupError(null);
    if (data.indexStatus !== 'ready') {
      if (data.indexStatus === 'error') {
        setPersonalError('Favorites could not load the recipe index.');
        setLeaderboardError(account.user ? 'Favorites could not load the recipe index.' : null);
        setLoading(false);
      } else if (data.indexStatus === 'idle') {
        void data.ensureIndex().catch(cause => {
          console.error('Favorites could not load the recipe index.', cause);
        });
      }
      return () => {
        alive = false;
      };
    }
    const browserSyncRequest = account.user
      ? (async () => {
          const currentSource = (itemKey: string, source: PreferredSource) => {
            const indexed = data.index[itemKey];
            if (!indexed) return false;
            if (source.t !== 'recipe') return true;
            const sourceKey = recipeRefKey(source.ref);
            return (indexed.p ?? []).some(ref => recipeRefKey(ref) === sourceKey);
          };
          const browserFavorites = Object.entries(
            loadPreferredSources(data.descriptor, currentSource),
          ).flatMap(
            ([itemKey, source]) => {
              if (source.t !== 'recipe') return [];
              return [{itemKey, recipeRef: source.ref}];
            },
          );
          try {
            await claimAnonymousRecipeFavorites(data.descriptor, browserFavorites);
          } catch (cause) {
            console.error('Browser favorites could not be imported before loading the account.', cause);
          }
        })()
      : Promise.resolve();
    const personalRequest = account.user
      ? browserSyncRequest
          .then(() => loadPersonalRecipeFavorites(data.descriptor))
          .then(async entries => {
            const staleEntries = entries.filter(entry => {
              const favoriteKey = recipeRefKey(entry.recipeRef);
              return !(data.index[entry.itemKey]?.p ?? [])
                .some(ref => recipeRefKey(ref) === favoriteKey);
            });
            if (staleEntries.length === 0) {
              if (alive) setPersonal(entries);
              return;
            }
            try {
              const removed = await cleanupInvalidPersonalRecipeFavorites(
                data.descriptor,
                staleEntries,
              );
              if (removed !== staleEntries.length) {
                console.warn('Some stale favorites changed before cleanup completed.', {
                  requested: staleEntries.length,
                  removed,
                });
              }
              const refreshed = await loadPersonalRecipeFavorites(data.descriptor);
              if (alive) setPersonal(refreshed);
            } catch (cause) {
              console.error('Unavailable personal favorites could not be cleaned up.', {
                count: staleEntries.length,
                cause,
              });
              if (!alive) return;
              setPersonal(entries);
              setCleanupError('Some unavailable favorites could not be removed. Try reopening this list.');
            }
          })
          .catch(cause => {
            console.error('Personal favorites could not be loaded.', cause);
            if (!alive) return;
            setPersonal([]);
            setPersonalError('Favorites could not be loaded.');
          })
      : Promise.resolve().then(() => {
          if (alive) setPersonal([]);
        });
    const leaderboardRequest = Promise.all([browserSyncRequest, personalRequest])
      .then(() => loadRecipeFavoriteLeaderboard(data.descriptor))
      .then(entries => {
        if (alive) setLeaderboard(entries);
      })
      .catch(cause => {
        console.error('Favorite leaderboard could not be loaded.', cause);
        if (!alive) return;
        setLeaderboard([]);
        setLeaderboardError(account.user ? 'Leaderboard could not be loaded.' : null);
      });
    Promise.allSettled([leaderboardRequest, personalRequest])
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [account.revision, account.user, data.descriptor, data.indexStatus, visible]);

  useEffect(() => {
    if (!account.user && selectedTab === 'mine') setSelectedTab('leaderboard');
  }, [account.user, selectedTab]);

  const availablePersonal = useMemo(() => personal.filter(entry => {
    const favoriteKey = recipeRefKey(entry.recipeRef);
    return (data.index[entry.itemKey]?.p ?? [])
      .some(ref => recipeRefKey(ref) === favoriteKey);
  }), [data.index, personal]);

  const filteredPersonal = useMemo(() => {
    const query = favoriteSearch.trim().toLocaleLowerCase();
    if (!query) return availablePersonal;
    return availablePersonal.filter(entry => {
      const itemName = data.itemsByKey.get(entry.itemKey)?.n ?? entry.itemKey;
      const categoryName = data.categories[entry.recipeRef[0]]?.title ?? '';
      const recipeId = data.getCachedRecipe(entry.recipeRef)?.id ?? '';
      return [itemName, entry.itemKey, categoryName, recipeId]
        .some(value => value.toLocaleLowerCase().includes(query));
    });
  }, [availablePersonal, data, favoriteSearch]);

  useEffect(() => {
    if (
      expandedItemKey &&
      !filteredPersonal.some(entry => entry.itemKey === expandedItemKey)
    ) {
      setExpandedItemKey(null);
    }
  }, [expandedItemKey, filteredPersonal]);

  useEffect(() => {
    if (!expandedItemKey) {
      setChoiceState({status: 'idle'});
      return;
    }
    const favorite = personal.find(entry => entry.itemKey === expandedItemKey);
    if (!favorite) {
      setChoiceState({status: 'idle'});
      return;
    }

    const currentKey = recipeRefKey(favorite.recipeRef);
    const refs = [...new Map(
      [favorite.recipeRef, ...(data.index[expandedItemKey]?.p ?? [])]
        .filter(ref => {
          const category = data.categories[ref[0]];
          if (!category || ref[1] >= category.count) return false;
          return (
            recipeRefKey(ref) === currentKey ||
            (!data.metaCategories.has(ref[0]) && !isDefaultDisabledRecipeCategory(category))
          );
        })
        .map(ref => [recipeRefKey(ref), ref] as const),
    ).values()];

    let alive = true;
    setChoiceState({status: 'loading'});
    void data.getRecipes(refs)
      .then(recipes => {
        if (!alive) return;
        const choices = refs.map((ref, index) => {
          const category = data.categories[ref[0]];
          const recipe = recipes[index];
          const title = recipeDisplayTitle(category?.title ?? `Recipe ${recipeRefKey(ref)}`, recipe);
          return {
            ref,
            recipe,
            title,
            option: {
              label: title,
              groupKey: category?.id ?? `recipe-category:${ref[0]}`,
              groupLabel: category?.title ?? `Recipe category ${ref[0]}`,
              sublabel: [
                recipe.id,
                recipe.stage ? `Requires stage ${recipe.stage}` : undefined,
              ].filter((value): value is string => !!value).join(' · ') || undefined,
              imageUri:
                recipe.img && category
                  ? data.imageUrl(recipeImagePath(category.dir, recipe.img))
                  : undefined,
              imageBackgroundUri:
                recipe.bg && category
                  ? data.imageUrl(recipeImagePath(category.dir, recipe.bg))
                  : undefined,
              imageW: recipe.w,
              imageH: recipe.h,
              structure: recipe.structure,
              inputs: materialInputSummary(recipe),
              outputs: slotSummary(recipe.out),
              machineKey: category?.catalysts[0],
              machineLabel: category?.catalysts[0]
                ? data.itemsByKey.get(category.catalysts[0])?.n ?? category.catalysts[0]
                : undefined,
            },
          };
        }).sort((a, b) =>
          a.title.localeCompare(b.title) || recipeRefKey(a.ref).localeCompare(recipeRefKey(b.ref)),
        );
        setChoiceState({status: 'ready', choices});
      })
      .catch(cause => {
        console.error('Favorite recipe choices could not be loaded.', {
          itemKey: expandedItemKey,
          cause,
        });
        if (alive) {
          setChoiceState({status: 'error', message: 'Recipe choices could not be loaded.'});
        }
      });
    return () => {
      alive = false;
    };
  }, [data, expandedItemKey, personal]);

  const refreshLeaderboard = async () => {
    try {
      setLeaderboard(await loadRecipeFavoriteLeaderboard(data.descriptor));
      setLeaderboardError(null);
    } catch (cause) {
      console.error('Favorite leaderboard could not be refreshed after an update.', cause);
      setLeaderboardError('Leaderboard could not be refreshed.');
    }
  };

  const updateFavorite = async (itemKey: string, recipeRef: RecipeRef | null) => {
    setPendingItemKey(itemKey);
    setActionError(null);
    try {
      await updateCommunityRecipeFavorite(data.descriptor, itemKey, recipeRef);
      const preferredSources = loadPreferredSources(
        data.descriptor,
        (candidateItemKey, source) => {
          const indexed = data.index[candidateItemKey];
          if (!indexed) return false;
          if (source.t !== 'recipe') return true;
          const sourceKey = recipeRefKey(source.ref);
          return (indexed.p ?? []).some(ref => recipeRefKey(ref) === sourceKey);
        },
      );
      if (recipeRef) {
        preferredSources[itemKey] = {t: 'recipe', ref: recipeRef};
        setPersonal(current => current.map(entry =>
          entry.itemKey === itemKey
            ? {...entry, recipeRef, updatedAt: Date.now()}
            : entry,
        ));
      } else {
        delete preferredSources[itemKey];
        setPersonal(current => current.filter(entry => entry.itemKey !== itemKey));
      }
      persistPreferredSources(data.descriptor, preferredSources);
      setExpandedItemKey(null);
      void refreshLeaderboard();
    } catch (cause) {
      console.error('Favorite recipe could not be updated.', {itemKey, recipeRef, cause});
      setActionError(
        recipeRef ? 'The new favorite could not be saved.' : 'The favorite could not be removed.',
      );
    } finally {
      setPendingItemKey(null);
    }
  };

  const scaledCardStyle = Platform.OS === 'web'
    ? ({zoom: interfaceZoom, width: `${100 / interfaceZoom}%`, maxWidth: 640 / interfaceZoom} as object)
    : null;
  const recipeCardWidth = Math.max(
    240,
    Math.min(580, viewportWidth / (Platform.OS === 'web' ? interfaceZoom : 1) - 80),
  );
  const activeError = selectedTab === 'mine' ? personalError : leaderboardError;
  const pickerFavorite = pickerItemKey
    ? availablePersonal.find(entry => entry.itemKey === pickerItemKey)
    : undefined;
  const pickerChoices =
    pickerFavorite && expandedItemKey === pickerFavorite.itemKey && choiceState.status === 'ready'
      ? choiceState.choices
      : [];

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={[styles.card, scaledCardStyle]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Recipe favorites</Text>
              <Text style={styles.subtitle}>
                {account.user
                  ? `${account.user.displayName} · ${availablePersonal.length} synced favorite${availablePersonal.length === 1 ? '' : 's'}`
                  : 'Community user leaderboard'}
              </Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close favorites" style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabs} accessibilityRole="tablist">
            {account.user && (
              <TouchableOpacity
                accessibilityRole="tab"
                accessibilityState={{selected: selectedTab === 'mine'}}
                style={[styles.tab, selectedTab === 'mine' && styles.tabActive]}
                onPress={() => setSelectedTab('mine')}>
                <Text style={[styles.tabText, selectedTab === 'mine' && styles.tabTextActive]}>
                  My favorites ({availablePersonal.length})
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityState={{selected: selectedTab === 'leaderboard'}}
              style={[styles.tab, selectedTab === 'leaderboard' && styles.tabActive]}
              onPress={() => setSelectedTab('leaderboard')}>
              <Text style={[styles.tabText, selectedTab === 'leaderboard' && styles.tabTextActive]}>
                Leaderboard
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionTitle}>
            {selectedTab === 'mine' ? 'Synced recipes' : 'Users by favorite count'} · {data.descriptor.displayName}
          </Text>
          {selectedTab === 'mine' && (
            <TextInput
              accessibilityLabel="Search saved favorites"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              placeholder="Search saved favorites…"
              placeholderTextColor={theme.textDim}
              style={styles.searchInput}
              value={favoriteSearch}
              onChangeText={setFavoriteSearch}
            />
          )}
          {selectedTab === 'mine' && cleanupError ? (
            <Text accessibilityRole="alert" style={styles.cleanupError}>{cleanupError}</Text>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
            contentContainerStyle={styles.list}>
            {loading ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.stateText}>Loading favorites…</Text>
              </View>
            ) : activeError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>{activeError}</Text>
            ) : selectedTab === 'mine' && availablePersonal.length === 0 ? (
              <Text style={styles.stateText}>Choose “Use automatically in future trees” on a recipe to add your first favorite.</Text>
            ) : selectedTab === 'mine' && filteredPersonal.length === 0 ? (
              <Text style={styles.stateText}>No saved favorites match “{favoriteSearch.trim()}”.</Text>
            ) : selectedTab === 'leaderboard' && leaderboard.length === 0 ? (
              <Text style={styles.stateText}>
                No signed-in users have saved a favorite for this pack version yet.
              </Text>
            ) : selectedTab === 'mine' ? (
              filteredPersonal.map(entry => {
                const itemName = data.itemsByKey.get(entry.itemKey)?.n ?? entry.itemKey;
                const categoryName = data.categories[entry.recipeRef[0]]?.title ?? `Recipe ${entry.recipeRef.join(':')}`;
                const expanded = expandedItemKey === entry.itemKey;
                const pending = pendingItemKey === entry.itemKey;
                return (
                  <View key={entry.itemKey} style={styles.favoriteGroup}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityState={{expanded}}
                      accessibilityLabel={`${itemName}, favorite recipe ${categoryName}`}
                      disabled={pending}
                      style={styles.row}
                      onPress={() => {
                        setActionError(null);
                        setExpandedItemKey(current => current === entry.itemKey ? null : entry.itemKey);
                      }}>
                      <Text style={styles.rank}>★</Text>
                      <View style={styles.rowCopy}>
                        <Text style={styles.itemName} numberOfLines={1}>{itemName}</Text>
                        <Text style={styles.recipeName} numberOfLines={1}>{categoryName}</Text>
                      </View>
                      {pending ? (
                        <ActivityIndicator color={theme.accent} size="small" />
                      ) : (
                        <DisclosureChevron expanded={expanded} color={theme.textDim} size={17} />
                      )}
                    </TouchableOpacity>
                    {expanded && (
                      <View style={styles.favoriteEditor}>
                        <View style={styles.editorHeader}>
                          <Text style={styles.editorTitle}>Favorite recipe</Text>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${itemName} from favorites`}
                            accessibilityState={{disabled: pending}}
                            disabled={pending}
                            style={styles.removeButton}
                            onPress={() => void updateFavorite(entry.itemKey, null)}>
                            <Text style={styles.removeButtonText}>×</Text>
                          </TouchableOpacity>
                        </View>
                        {choiceState.status === 'loading' ? (
                          <View style={styles.editorLoading}>
                            <ActivityIndicator color={theme.accent} size="small" />
                            <Text style={styles.recipeName}>Loading favorite recipe…</Text>
                          </View>
                        ) : choiceState.status === 'error' ? (
                          <Text accessibilityRole="alert" style={styles.editorError}>
                            {choiceState.message}
                          </Text>
                        ) : choiceState.status === 'ready' ? (
                          <View style={styles.recipePreview}>
                            {(() => {
                              const currentChoice = choiceState.choices.find(
                                choice => recipeRefKey(choice.ref) === recipeRefKey(entry.recipeRef),
                              );
                              if (!currentChoice) return null;
                              const category = data.categories[currentChoice.ref[0]];
                              return (
                                <RecipeCard
                                  recipe={currentChoice.recipe}
                                  dir={category.dir}
                                  catTitle={category.title}
                                  availableCardWidth={recipeCardWidth}
                                  contentZoom={contentZoom}
                                  actionSubject={itemName}
                                  actionAccessibilityLabel={`Choose a different favorite recipe for ${itemName}`}
                                  actionHint="Tap to change favorite recipe"
                                  onPress={() => {
                                    setCollapsedPickerGroupKeys(new Set());
                                    setPickerItemKey(entry.itemKey);
                                  }}
                                />
                              );
                            })()}
                          </View>
                        ) : null}
                        {actionError && (
                          <Text accessibilityRole="alert" style={styles.editorError}>{actionError}</Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            ) : (
              leaderboard.map((entry, index) => (
                <View
                  accessibilityLabel={`${entry.isCurrent ? 'You, ' : ''}${entry.displayName}, ${entry.count} favorites`}
                  key={`${entry.displayName}|${index}`}
                  style={[styles.row, entry.isCurrent && styles.currentUserRow]}>
                  <Text style={[styles.rank, entry.isCurrent && styles.currentUserText]}>
                    {index + 1}
                  </Text>
                  <View style={styles.userAvatar}>
                    <Text style={styles.userAvatarFallback}>
                      {entry.isAnonymous ? '?' : entry.displayName.slice(0, 1).toUpperCase()}
                    </Text>
                    {entry.avatarUrl && (
                      <Image
                        accessibilityLabel={`${entry.displayName}'s Discord avatar`}
                        onError={() => console.warn('A Discord leaderboard avatar could not be displayed.', {
                          displayName: entry.displayName,
                        })}
                        source={{uri: entry.avatarUrl}}
                        style={styles.userAvatarImage}
                      />
                    )}
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={styles.userNameRow}>
                      <Text
                        style={[styles.itemName, entry.isCurrent && styles.currentUserText]}
                        numberOfLines={1}>
                        {entry.displayName}
                      </Text>
                      {entry.isCurrent && (
                        <View style={styles.youBadge}>
                          <Text style={styles.youBadgeText}>You</Text>
                        </View>
                      )}
                    </View>
                    {entry.isAnonymous && (
                      <Text style={styles.recipeName}>Signed out</Text>
                    )}
                  </View>
                  <Text
                    accessibilityLabel={`${entry.count} favorites`}
                    style={[styles.count, entry.isCurrent && styles.currentUserText]}>
                    ★ {entry.count}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          </View>
        </View>
      </Modal>
      {pickerFavorite && pickerChoices.length > 0 && (
        <PickerModal
          visible
          interfaceZoom={interfaceZoom}
          contentZoom={contentZoom}
          onContentZoomChange={onContentZoomChange}
          onContentZoomComplete={onContentZoomComplete}
          title={`Choose favorite recipe for ${data.itemsByKey.get(pickerFavorite.itemKey)?.n ?? pickerFavorite.itemKey}`}
          options={pickerChoices.map(choice => choice.option)}
          collapsedGroupKeys={collapsedPickerGroupKeys}
          onToggleGroup={toggleRecipePickerGroup}
          onSelect={index => {
            const choice = pickerChoices[index];
            if (!choice) {
              console.error('Favorite recipe picker selected an unavailable option.', {
                itemKey: pickerFavorite.itemKey,
                index,
              });
              return;
            }
            closeRecipePicker();
            void updateFavorite(pickerFavorite.itemKey, choice.ref);
          }}
          onClose={closeRecipePicker}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.72)'},
  card: {width: '100%', maxWidth: 640, maxHeight: '86%', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.panel},
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 18, fontWeight: '800'},
  subtitle: {color: theme.accent, fontSize: 11, marginTop: 3},
  closeButton: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 16},
  tabs: {flexDirection: 'row', gap: 6, marginTop: 14},
  tab: {minHeight: 34, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: theme.border},
  tabActive: {borderColor: theme.accent, backgroundColor: theme.panelAlt},
  tabText: {color: theme.textDim, fontSize: 11, fontWeight: '700'},
  tabTextActive: {color: theme.accent},
  sectionTitle: {marginTop: 16, color: theme.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase'},
  searchInput: {height: 38, marginTop: 10, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: theme.border, color: theme.text, backgroundColor: theme.bg, fontSize: 12},
  cleanupError: {color: theme.danger, fontSize: 10, lineHeight: 14, marginTop: 8},
  scroll: {marginTop: 6},
  list: {paddingBottom: 4},
  favoriteGroup: {borderBottomWidth: 1, borderBottomColor: theme.border},
  row: {minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border},
  currentUserRow: {borderLeftWidth: 3, borderLeftColor: theme.accent, backgroundColor: 'rgba(88, 196, 123, 0.12)'},
  rank: {width: 24, color: theme.textDim, fontSize: 11, fontWeight: '800', textAlign: 'center'},
  userAvatar: {width: 32, height: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panelAlt},
  userAvatarFallback: {color: theme.textDim, fontSize: 12, fontWeight: '800'},
  userAvatarImage: {position: 'absolute', inset: 0, width: 32, height: 32},
  rowCopy: {flex: 1, minWidth: 0},
  userNameRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  itemName: {color: theme.text, fontSize: 12, fontWeight: '700'},
  currentUserText: {color: theme.accent},
  youBadge: {paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.accent},
  youBadgeText: {color: theme.bg, fontSize: 9, fontWeight: '900', textTransform: 'uppercase'},
  recipeName: {color: theme.textDim, fontSize: 10, marginTop: 2},
  count: {color: theme.accent, fontSize: 12, fontWeight: '800'},
  favoriteEditor: {padding: 11, gap: 9, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bg},
  editorHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  editorTitle: {color: theme.text, fontSize: 11, fontWeight: '800'},
  editorLoading: {minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8},
  editorError: {color: theme.danger, fontSize: 10, lineHeight: 14},
  recipePreview: {width: '100%'},
  removeButton: {width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: theme.danger, backgroundColor: theme.panelAlt},
  removeButtonText: {color: theme.danger, fontSize: 19, lineHeight: 20, fontWeight: '800'},
  centerState: {alignItems: 'center', paddingVertical: 28, gap: 8},
  stateText: {color: theme.textDim, fontSize: 11, lineHeight: 16, paddingVertical: 20, textAlign: 'center'},
  errorText: {color: theme.danger, fontSize: 11, paddingVertical: 20, textAlign: 'center'},
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const clientSource = await readFile(new URL('./supabaseClient.ts', import.meta.url), 'utf8');
const contextSource = await readFile(new URL('./UserContext.tsx', import.meta.url), 'utf8');
const favoritesSource = await readFile(new URL('./FavoritesModal.tsx', import.meta.url), 'utf8');
const favoriteDataSource = await readFile(new URL('../data/recipeFavorites.ts', import.meta.url), 'utf8');
const recipeCardSource = await readFile(new URL('../components/RecipeCard.tsx', import.meta.url), 'utf8');
const signInSource = await readFile(new URL('./SignInModal.tsx', import.meta.url), 'utf8');
const accountSource = await readFile(new URL('./AccountModal.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
const switcherSource = await readFile(new URL('../components/DatasetSwitcher.tsx', import.meta.url), 'utf8');
const graphSource = await readFile(new URL('../graph/GraphScreen.tsx', import.meta.url), 'utf8');
const preferredSourcesSource = await readFile(new URL('../graph/preferredSources.ts', import.meta.url), 'utf8');

test('OAuth callbacks are exchanged during Supabase initialization before the account session is read', () => {
  assert.match(clientSource, /detectSessionInUrl:\s*true/u);
  assert.match(clientSource, /appendPkceFlowIdToRedirects:\s*true/u);
  assert.doesNotMatch(clientSource, /exchangeCodeForSession/u);
  assert.match(contextSource, /await client\.auth\.initialize\(\)[\s\S]*?return refresh\(\)/u);
});

test('OAuth callback parameters are removed without discarding the current path', () => {
  for (const parameter of ['code', 'error', 'error_code', 'error_description', 'sb_flow_id']) {
    assert.match(clientSource, new RegExp(`['"]${parameter}['"]`));
  }
  assert.match(clientSource, /window\.history\.replaceState\(window\.history\.state, '', nextUrl\)/u);
  assert.match(contextSource, /return `\$\{window\.location\.origin\}\$\{window\.location\.pathname\}`/u);
});

test('authentication is opened from the header instead of the Favorites dialog', () => {
  assert.match(appSource, /accessibilityLabel=\{[\s\S]*?'Sign in to Recipe Tree'/u);
  assert.match(appSource, /account\.user\?\.displayName \?\? 'Sign in'/u);
  assert.match(signInSource, /Continue with Discord/u);
  assert.doesNotMatch(favoritesSource, /Continue with Discord|Email address|Password \(8\+ characters\)/u);
});

test('the account action precedes the pack picker on wide screens and uses the compact control row', () => {
  assert.match(appSource, /const headerTrailingAction = accountHeaderAction/u);
  assert.match(switcherSource, /fullTitleRow[\s\S]*?trailingAction[\s\S]*?datasetButton[\s\S]*?importMenu/u);
  assert.match(switcherSource, /compactControlRow[\s\S]*?leadingAction[\s\S]*?expandButton[\s\S]*?trailingAction/u);
});

test('account settings expose a synced editable username', () => {
  assert.match(accountSource, /accessibilityLabel="Username"/u);
  assert.match(accountSource, /account\.updateDisplayName\(displayName\)/u);
  assert.match(accountSource, /Shown in the header and synced across devices\./u);
});

test('account settings link non-donors to the donation page without showing configuration errors', () => {
  assert.match(accountSource, /accessibilityLabel="Open the Recipe Tree donation page"/u);
  assert.match(accountSource, /onPress=\{onOpenDonations\}/u);
  assert.doesNotMatch(accountSource, /Minecraft uses the Monocraft pixel font and block-style controls\./u);
  assert.doesNotMatch(accountSource, /setError\(cause instanceof Error \? cause\.message : 'Monthly donation tier could not be loaded\.'\)/u);
  assert.match(accountSource, /setTierError\(cause instanceof Error \? cause\.message/u);
  assert.match(accountSource, /tierError \? \(/u);
  assert.match(accountSource, /onPress=\{refreshSubscription\}/u);
  assert.match(appSource, /onOpenDonations=\{\(\) => \{[\s\S]*?setShowAccount\(false\)[\s\S]*?setShowDonations\(true\)/u);
});

test('personal favorites load independently while signed-out leaderboard failures stay diagnostic', () => {
  assert.match(favoritesSource, /data\.indexStatus !== 'ready'/u);
  assert.match(favoritesSource, /data\.ensureIndex\(\)/u);
  assert.match(favoritesSource, /Promise\.allSettled\(\[leaderboardRequest, personalRequest\]\)/u);
  assert.match(favoritesSource, /claimAnonymousRecipeFavorites\(data\.descriptor, browserFavorites\)/u);
  assert.match(favoritesSource, /Browser favorites could not be imported before loading the account\./u);
  assert.match(favoritesSource, /console\.error\('Favorite leaderboard could not be loaded\.'/u);
  assert.match(favoritesSource, /console\.error\('Personal favorites could not be loaded\.'/u);
  assert.match(favoritesSource, /setLeaderboardError\(account\.user \? 'Leaderboard could not be loaded\.' : null\)/u);
  assert.match(favoritesSource, /selectedTab === 'mine' \? personalError : leaderboardError/u);
  assert.match(favoritesSource, /cleanupInvalidPersonalRecipeFavorites/u);
  assert.match(favoritesSource, /Unavailable personal favorites could not be cleaned up\./u);
  assert.match(favoritesSource, /Promise\.all\(\[browserSyncRequest, personalRequest\]\)/u);
  assert.match(favoritesSource, /loadPreferredSources\(data\.descriptor, currentSource\)/u);
  assert.match(graphSource, /cleanupInvalidPersonalRecipeFavorites/u);
  assert.match(graphSource, /preferredSourceIsAvailable\(favorite\.itemKey/u);
  assert.match(preferredSourcesSource, /minecraft-recipe-tree\.preferred-sources\.v3/u);
  assert.match(preferredSourcesSource, /descriptor\.slug.*descriptor\.publicationId/u);
  assert.match(favoriteDataSource, /const CLEANUP_BATCH_SIZE = 25/u);
  assert.match(favoriteDataSource, /offset \+= CLEANUP_BATCH_SIZE/u);
  assert.match(
    favoriteDataSource,
    /favorites: chunk\.map\(\(\{itemKey, recipeRef\}\) => \(\{itemKey, recipeRef\}\)\)/u,
  );
});

test('saved favorites can be searched, expanded one at a time, replaced, and removed', () => {
  assert.match(favoritesSource, /accessibilityLabel="Search saved favorites"/u);
  assert.match(favoritesSource, /filteredPersonal\.map\(entry =>/u);
  assert.match(
    favoritesSource,
    /setExpandedItemKey\(current => current === entry\.itemKey \? null : entry\.itemKey\)/u,
  );
  assert.match(favoritesSource, /accessibilityState=\{\{expanded\}\}/u);
  assert.match(favoritesSource, /<RecipeCard/u);
  assert.match(favoritesSource, /actionHint="Tap to change favorite recipe"/u);
  assert.match(favoritesSource, /<PickerModal/u);
  assert.match(favoritesSource, /Choose favorite recipe for/u);
  assert.match(favoritesSource, /collapsedGroupKeys=\{collapsedPickerGroupKeys\}/u);
  assert.match(favoritesSource, /onToggleGroup=\{toggleRecipePickerGroup\}/u);
  assert.match(
    favoritesSource,
    /updateCommunityRecipeFavorite\(data\.descriptor, itemKey, recipeRef\)/u,
  );
  assert.match(favoritesSource, /persistPreferredSources\(data\.descriptor, preferredSources\)/u);
  assert.match(favoritesSource, /removeButtonText\}>×</u);
  assert.match(favoritesSource, /ref\[1\] >= category\.count/u);
  assert.match(favoritesSource, /const availablePersonal = useMemo/u);
  assert.doesNotMatch(favoritesSource, /This saved recipe is unavailable in this pack version/u);
  assert.match(preferredSourcesSource, /Preferred sources unavailable in the current pack publication were removed\./u);
  assert.match(recipeCardSource, /actionAccessibilityLabel/u);
  assert.match(recipeCardSource, /actionHint \?\?/u);
});

test('the user leaderboard includes signed-out users and highlights the current browser or account', () => {
  assert.match(favoritesSource, /entry\.isAnonymous/u);
  assert.match(favoritesSource, /entry\.isCurrent && styles\.currentUserRow/u);
  assert.match(favoritesSource, /entry\.avatarUrl/u);
  assert.match(favoritesSource, /Discord avatar/u);
  assert.match(favoritesSource, /entry\.isAnonymous \? '\?' : entry\.displayName\.slice/u);
  assert.match(favoritesSource, /<Text style=\{styles\.youBadgeText\}>You<\/Text>/u);
  assert.match(favoritesSource, /Signed out/u);
});

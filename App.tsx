'use client';

import {StatusBar} from 'expo-status-bar';
import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView, initialWindowMetrics} from './src/ui/safeArea';
import {ContentZoomControl} from './src/components/ContentZoomControl';
import {DatasetSwitcher} from './src/components/DatasetSwitcher';
import {BugIcon} from './src/components/BugIcon';
import type {GitHubIssueKind, IssueReportContext} from './src/components/githubIssues';
import {ItemsScreen} from './src/components/ItemsScreen';
import {DataProvider, useData, useLoadState} from './src/data/DataContext';
import {DatasetReadinessMarker} from './src/data/DatasetReadinessMarker';
import {
  DatasetCatalogProvider,
  useDatasetCatalog,
} from './src/data/DatasetCatalogContext';
import {
  RecipeStageProvider,
  useRecipeStages,
} from './src/data/RecipeStageContext';
import {datasetMountKey} from './src/data/datasetCatalog';
import {isLocalPackExportUrl} from './src/data/runtimeDocumentLimits';
import {theme} from './src/theme';
import type {Manifest} from './src/types';
import {Tab, UiProvider, useUi} from './src/ui/UiContext';
import {lightImpactFeedback, selectionFeedback} from './src/ui/haptics';
import {
  MAXIMUM_INTERFACE_ZOOM,
  MINIMUM_INTERFACE_ZOOM,
  loadInterfaceZoom,
  persistInterfaceZoom,
  stepInterfaceZoom,
} from './src/ui/interfaceZoom';
import {
  loadContentZoom,
  normalizeContentZoom,
  persistContentZoom,
} from './src/ui/contentZoom';
import {signalTarget, useSignalSurface} from './src/analytics/signal';
import {
  graphRenderRecovery,
  type GraphRenderRecovery,
} from './src/graph/graphRenderError';
import {clearGraphSession, loadGraphSession} from './src/graph/graphSession';
import type {RecipeImportReport} from './src/graph/RecipeImportDetailsModal';
import {UserProvider, useUser} from './src/account/UserContext';
import {ThemePreferenceProvider, useThemePreference} from './src/ui/themePreference';
import {hasSeenOnboarding, markOnboardingSeen} from './src/ui/onboarding';

const LazyGraphScreen = React.lazy(async () => {
  const module = await import('./src/graph/GraphScreen');
  return {default: module.GraphScreen};
});

const LazyItemDetailModal = React.lazy(async () => {
  const module = await import('./src/components/ItemDetailModal');
  return {default: module.ItemDetailModal};
});

const LazyDatasetPicker = React.lazy(async () => {
  const module = await import('./src/components/DatasetPicker');
  return {default: module.DatasetPicker};
});

const LazyGraphGuideModal = React.lazy(async () => {
  const module = await import('./src/components/GraphGuideModal');
  return {default: module.GraphGuideModal};
});

const LazyIssueReportModal = React.lazy(async () => {
  const module = await import('./src/components/IssueReportModal');
  return {default: module.IssueReportModal};
});

const LazyWelcomeModal = React.lazy(async () => {
  const module = await import('./src/components/WelcomeModal');
  return {default: module.WelcomeModal};
});

const LazyMobsScreen = React.lazy(async () => {
  const module = await import('./src/components/MobsScreen');
  return {default: module.MobsScreen};
});

const LazyMobileUploadGuide = React.lazy(async () => {
  const module = await import('./src/components/MobileUploadGuide');
  return {default: module.MobileUploadGuide};
});

const LazyRecipeStageModal = React.lazy(async () => {
  const module = await import('./src/components/RecipeStageModal');
  return {default: module.RecipeStageModal};
});

const LazyRecipeHistoryModal = React.lazy(async () => {
  const module = await import('./src/components/RecipeHistoryModal');
  return {default: module.RecipeHistoryModal};
});

const LazyFavoritesModal = React.lazy(async () => {
  const module = await import('./src/account/FavoritesModal');
  return {default: module.FavoritesModal};
});

const LazySignInModal = React.lazy(async () => {
  const module = await import('./src/account/SignInModal');
  return {default: module.SignInModal};
});

const LazyAccountModal = React.lazy(async () => {
  const module = await import('./src/account/AccountModal');
  return {default: module.AccountModal};
});

const LazyDonationsModal = React.lazy(async () => {
  const module = await import('./src/donations/DonationsModal');
  return {default: module.DonationsModal};
});

function DeferredModalFallback({label}: {label: string}) {
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.deferredModalBackdrop} accessibilityRole="progressbar">
        <View style={styles.deferredModalCard}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={styles.loadingText}>Loading {label}…</Text>
        </View>
      </View>
    </Modal>
  );
}

class GraphErrorBoundary extends React.Component<
  {children: React.ReactNode; onRetry(recovery: GraphRenderRecovery): void; onReturnToItems(): void},
  {recovery: GraphRenderRecovery | null}
> {
  state: {recovery: GraphRenderRecovery | null} = {recovery: null};

  static getDerivedStateFromError(error: unknown): {recovery: GraphRenderRecovery} {
    return {recovery: graphRenderRecovery(error)};
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('The graph workspace stopped rendering.', {
      error,
      kind: graphRenderRecovery(error).kind,
      componentStack: info.componentStack,
    });
  }

  render() {
    const recovery = this.state.recovery;
    if (!recovery) return this.props.children;
    return (
      <View style={styles.graphRecovery} accessibilityRole="alert">
        <Text style={styles.errorTitle}>{recovery.title}</Text>
        <Text style={styles.errorText}>{recovery.message}</Text>
        {recovery.detail && (
          <Text style={styles.graphRecoveryDetail}>Details: {recovery.detail}</Text>
        )}
        <View style={styles.graphRecoveryActions}>
          <TouchableOpacity
            style={[styles.reloadBtn, styles.graphRecoveryButton]}
            onPress={() => {
              this.props.onRetry(recovery);
              this.setState({recovery: null});
            }}>
            <Text style={styles.reloadBtnText}>
              {recovery.reloadPage ? 'Reload site' : 'Try again'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reloadBtn, styles.graphRecoveryButton]}
            onPress={this.props.onReturnToItems}>
            <Text style={styles.reloadBtnText}>Return to Browse</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

export default function App() {
  return (
    <ThemePreferenceProvider>
      <ThemedApp />
    </ThemePreferenceProvider>
  );
}

function ThemedApp() {
  const {preference} = useThemePreference();
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView
        style={styles.app}
        edges={Platform.OS === 'web' ? ['top', 'right', 'bottom', 'left'] : ['top', 'right', 'left']}>
        <StatusBar style={preference === 'light' ? 'dark' : 'light'} />
        <UserProvider>
          <DatasetCatalogProvider>
            <DatasetRoot />
          </DatasetCatalogProvider>
        </UserProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function DatasetRoot() {
  const catalog = useDatasetCatalog();
  const [showDatasetPicker, setShowDatasetPicker] = useState(false);
  const [showMobileUploadGuide, setShowMobileUploadGuide] = useState(false);
  const datasets = catalog.state.status === 'loading' ? [] : catalog.state.datasets;
  const selectedSlug = catalog.state.status === 'ready' ? catalog.state.selected.slug : null;
  const openLocalPackImport = () => {
    if (Platform.OS !== 'web') {
      setShowMobileUploadGuide(true);
      return;
    }
    const url = '/publish#upload';
    void Linking.openURL(url).catch(error => {
      console.error('Could not open the modpack upload page.', {url, error});
    });
  };

  const datasetControls = (
    loadedManifest: Manifest | null,
    details?: React.ReactNode,
    leadingAction?: React.ReactNode,
    fullWidthControls?: React.ReactNode,
    menuAction?: React.ReactNode,
    trailingAction?: React.ReactNode,
    compactMenuExpanded?: boolean,
    onCompactMenuExpandedChange?: (expanded: boolean) => void,
    onImportTree?: () => void,
  ) => (
    <>
      <DatasetSwitcher
        status={catalog.state.status}
        datasets={datasets}
        selectedSlug={selectedSlug}
        loadedManifest={loadedManifest}
        onOpenPicker={() => setShowDatasetPicker(true)}
        onImportPack={openLocalPackImport}
        onImportTree={onImportTree}
        leadingAction={leadingAction}
        menuAction={menuAction}
        trailingAction={trailingAction}
        fullWidthControls={fullWidthControls}
        details={details}
        compactMenuExpanded={compactMenuExpanded}
        onCompactMenuExpandedChange={onCompactMenuExpandedChange}
      />
      {showDatasetPicker && (
        <Suspense fallback={<DeferredModalFallback label="modpacks" />}>
          <LazyDatasetPicker
            visible
            datasets={datasets}
            selectedSlug={selectedSlug}
            onSelect={slug => {
              catalog.select(slug);
              setShowDatasetPicker(false);
            }}
            onDeleteLocal={catalog.removeLocal}
            onClose={() => setShowDatasetPicker(false)}
          />
        </Suspense>
      )}
      {showMobileUploadGuide && (
        <Suspense fallback={<DeferredModalFallback label="import guide" />}>
          <LazyMobileUploadGuide
            visible
            onClose={() => setShowMobileUploadGuide(false)}
            onInstalled={slug => {
              setShowMobileUploadGuide(false);
              catalog.refreshLocal(slug);
            }}
          />
        </Suspense>
      )}
    </>
  );

  if (catalog.state.status === 'loading') {
    return (
      <View style={styles.datasetRoot}>
        {datasetControls(null)}
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={styles.loadingText}>loading published modpacks</Text>
        </View>
      </View>
    );
  }
  if (catalog.state.status === 'error') {
    return (
      <View style={styles.datasetRoot}>
        {datasetControls(null)}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Modpack selection unavailable</Text>
          <Text style={styles.errorText}>{catalog.state.message}</Text>
          {catalog.state.datasets.length > 0 && (
            <TouchableOpacity
              style={styles.reloadBtn}
              onPress={() => setShowDatasetPicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose a valid published modpack"
              focusable>
              <Text style={styles.reloadBtnText}>Choose a published modpack</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const {source} = catalog.state;
  return (
    <DataProvider
      key={datasetMountKey(source.descriptor)}
      descriptor={source.descriptor}
      base={source.base}
      previewBase={source.previewBase}>
      <LoadedDatasetLayout
        expectedPublicationId={source.descriptor.publicationId}
        renderControls={datasetControls}
        onImportPack={openLocalPackImport}
      />
    </DataProvider>
  );
}

function LoadedDatasetLayout({
  expectedPublicationId,
  renderControls,
  onImportPack,
}: {
  expectedPublicationId: string;
  onImportPack(): void;
  renderControls(
    manifest: Manifest | null,
    details?: React.ReactNode,
    leadingAction?: React.ReactNode,
    fullWidthControls?: React.ReactNode,
    menuAction?: React.ReactNode,
    trailingAction?: React.ReactNode,
    compactMenuExpanded?: boolean,
    onCompactMenuExpandedChange?: (expanded: boolean) => void,
    onImportTree?: () => void,
  ): React.ReactNode;
}) {
  return (
    <View style={styles.datasetRoot}>
      <DatasetReadinessMarker expectedPublicationId={expectedPublicationId} />
      <View style={styles.datasetContent}>
        <UiProvider>
          <Root renderControls={renderControls} onImportPack={onImportPack} />
        </UiProvider>
      </View>
    </View>
  );
}

function Root({
  renderControls,
  onImportPack,
}: {
  onImportPack(): void;
  renderControls(
    manifest: Manifest | null,
    details?: React.ReactNode,
    leadingAction?: React.ReactNode,
    fullWidthControls?: React.ReactNode,
    menuAction?: React.ReactNode,
    trailingAction?: React.ReactNode,
    compactMenuExpanded?: boolean,
    onCompactMenuExpandedChange?: (expanded: boolean) => void,
    onImportTree?: () => void,
  ): React.ReactNode;
}) {
  const state = useLoadState();
  if (state.status === 'loading') {
    return (
      <View style={styles.datasetRoot}>
        {renderControls(null)}
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={styles.loadingText}>loading {state.step}</Text>
        </View>
      </View>
    );
  }
  if (state.status === 'error') {
    const stale = state.kind === 'stale';
    const localPack = isLocalPackExportUrl(`${state.base}/manifest.json`);
    return (
      <View style={styles.datasetRoot}>
        {renderControls(null)}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>{stale ? 'Recipe dataset updated' : 'Export unavailable'}</Text>
          <Text style={styles.errorText}>
            {state.message}
            {!stale && !localPack && (
              <>
                {'\n\n'}Expected data at “{state.base}/manifest.json”.
                {'\n\n'}Development recovery:
                {'\n'}1. Run the version-appropriate Minecraft exporter.
                {'\n'}2. Run npm run import-data -- --source /absolute/path/to/export.
                {'\n'}3. Reload this page after validation and publication complete.
              </>
            )}
            {!stale && localPack && (
              <>
                {'\n\n'}This pack is already stored on this device. If the message above says a
                legacy document exceeds the compatibility limit, make a new export with the
                latest exporter; otherwise, add the same ZIP again to repair its saved copy.
              </>
            )}
          </Text>
          {stale && Platform.OS === 'web' && (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.reloadBtn}
              onPress={() => {
                if (typeof window === 'undefined') {
                  console.error('Dataset reload was requested, but the browser window is unavailable.');
                  return;
                }
                window.location.reload();
              }}>
              <Text style={styles.reloadBtnText}>Reload catalog and dataset</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }
  return (
    <RecipeStageProvider>
      <Shell renderControls={renderControls} onImportPack={onImportPack} />
    </RecipeStageProvider>
  );
}

function Shell({
  renderControls,
  onImportPack,
}: {
  onImportPack(): void;
  renderControls(
    manifest: Manifest | null,
    details?: React.ReactNode,
    leadingAction?: React.ReactNode,
    fullWidthControls?: React.ReactNode,
    menuAction?: React.ReactNode,
    trailingAction?: React.ReactNode,
    compactMenuExpanded?: boolean,
    onCompactMenuExpandedChange?: (expanded: boolean) => void,
    onImportTree?: () => void,
  ): React.ReactNode;
}) {
  const data = useData();
  const recipeStages = useRecipeStages();
  const account = useUser();
  const ui = useUi();
  const {tab, setTab, graphRequestId} = ui;
  const {width} = useWindowDimensions();
  const [hasHydrated, setHasHydrated] = useState(Platform.OS !== 'web');
  const compactHeader = hasHydrated && width < 720;
  const [showRecipeHistory, setShowRecipeHistory] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showDonations, setShowDonations] = useState(false);
  const [donationOutcome, setDonationOutcome] = useState<'success' | 'canceled' | null>(null);
  const [showRecipeStages, setShowRecipeStages] = useState(false);
  const [showGraphGuide, setShowGraphGuide] = useState(false);
  const [showIssueReport, setShowIssueReport] = useState(false);
  // Starts closed and only opens from an effect (never from the initial render) so a first-time
  // visitor's client render can't diverge from the statically prerendered server HTML, which has
  // no window/localStorage to check against and would otherwise always render this as closed.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (!hasSeenOnboarding()) setShowWelcome(true);
  }, []);
  const [hasVisitedMobs, setHasVisitedMobs] = useState(tab === 'mobs');
  const [showInfoMenu, setShowInfoMenu] = useState(false);
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [recipeImportRequestId, setRecipeImportRequestId] = useState(0);
  const [recipeImportJob, setRecipeImportJob] = useState<{
    id: number;
    raw: string;
  } | null>(null);
  const recipeImportJobIdRef = useRef(0);
  const [recipeImportNotice, setRecipeImportNotice] = useState<string | null>(null);
  const [recipeImportReport, setRecipeImportReport] = useState<RecipeImportReport | null>(null);
  const [issueReportKind, setIssueReportKind] = useState<GitHubIssueKind>('bug');
  const [showGraphControls, setShowGraphControls] = useState(false);
  const [interfaceZoom, setInterfaceZoom] = useState(1);
  const [contentZoom, setContentZoom] = useState(1);
  const shellSurface = showWelcome
    ? 'welcome'
    : showSignIn
      ? 'sign-in'
      : showAccount
      ? 'account'
      : showDonations
      ? 'donations'
      : showFavorites
      ? 'favorites'
      : showRecipeStages
      ? 'recipe-stages'
      : showGraphGuide
        ? 'graph-guide'
        : showIssueReport
          ? 'issue-report'
          : showRecipeHistory
            ? 'recipe-history'
            : tab;
  useSignalSurface(
    shellSurface,
    showWelcome || showSignIn || showAccount || showDonations || showFavorites || showRecipeStages || showGraphGuide || showIssueReport || showRecipeHistory
      ? 'modal'
      : 'screen',
  );
  const issueReportContext = useMemo<IssueReportContext>(() => ({
    packSlug: data.descriptor.slug,
    packName: data.descriptor.displayName,
    packVersion: data.descriptor.packVersion,
    minecraftVersion: data.descriptor.minecraftVersion,
    publicationId: data.datasetIdentity,
    previewAssetSetId: data.descriptor.previewAssetSetId,
    exportGeneratedAt: data.manifest.generatedAt,
    exportFormat: data.manifest.format,
    itemCount: data.items.length,
    recipeCount: data.manifest.counts.recipes,
    categoryCount: data.categories.length,
    modCount: Object.keys(data.manifest.mods ?? {}).length,
    activeTab: tab,
    openItemKey: ui.itemStack[ui.itemStack.length - 1] ?? '',
    graphRootKey: ui.graphRootKey ?? '',
    graphDirection: ui.graphDirection,
    interfaceZoomPercent: Math.round(interfaceZoom * 100),
    contentZoomPercent: Math.round(contentZoom * 100),
  }), [contentZoom, data, interfaceZoom, tab, ui.graphDirection, ui.graphRootKey, ui.itemStack]);
  useEffect(() => {
    if (Platform.OS === 'web') setHasHydrated(true);
  }, []);
  useEffect(() => {
    if (tab === 'mobs') setHasVisitedMobs(true);
  }, [tab]);
  useEffect(() => {
    if (account.user) setShowSignIn(false);
  }, [account.user]);
  useEffect(() => {
    if (recipeImportJob || ui.graphRootKey || ui.graphRecipeRef) return;
    const session = loadGraphSession(data.descriptor);
    if (!session) return;
    ui.restoreGraph(session.rootKey, session.direction);
    setTab('graph');
  }, [
    data.descriptor,
    recipeImportJob,
    setTab,
    ui.graphRecipeRef,
    ui.graphRootKey,
    ui.restoreGraph,
  ]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('donation');
    if (outcome !== 'success' && outcome !== 'canceled') return;
    setDonationOutcome(outcome);
    setShowDonations(true);
    url.searchParams.delete('donation');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);
  useEffect(() => {
    if (tab !== 'graph' || data.indexStatus === 'ready' || data.indexStatus === 'loading') return;
    void data.ensureIndex().catch(() => {
      // DataContext logs transport and validation detail and exposes the error below.
    });
  }, [data, tab]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const storedInterfaceZoom = loadInterfaceZoom();
    setInterfaceZoom(storedInterfaceZoom);
    setContentZoom(loadContentZoom(storedInterfaceZoom));
  }, []);
  const adjustInterfaceZoom = (direction: -1 | 1) => {
    try {
      const nextZoom = stepInterfaceZoom(interfaceZoom, direction);
      if (nextZoom === interfaceZoom) return;
      setInterfaceZoom(nextZoom);
      persistInterfaceZoom(nextZoom);
      lightImpactFeedback();
    } catch (error) {
      console.error('Interface zoom could not be changed.', error);
    }
  };
  const previewContentZoom = (value: number) => {
    try {
      setContentZoom(normalizeContentZoom(value));
    } catch (error) {
      console.error('Recipe and item zoom slider produced an invalid value.', error);
    }
  };
  const saveContentZoom = (value: number) => {
    try {
      persistContentZoom(normalizeContentZoom(value));
    } catch (error) {
      console.error('Recipe and item zoom could not be saved.', error);
    }
  };
  const scaledHeaderStyle =
    Platform.OS === 'web'
      ? ({zoom: interfaceZoom} as unknown as object)
      : null;
  const scaledMobsWorkspaceStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
        } as unknown as object)
      : null;
  const headerTabs = Platform.OS === 'web' ? (
      <View style={styles.headerActionRow}>
        <TabBtn tab="items" label="Items" />
        <TabBtn tab="graph" label="Graph" />
        {data.capabilities.mobs && <TabBtn tab="mobs" label="Mobs" />}
      </View>
    ) : null;
  const compactHeaderNavigation = compactHeader && headerTabs ? (
    <View style={styles.compactHeaderNavigation}>{headerTabs}</View>
  ) : null;
  const interfaceZoomControls = Platform.OS === 'web' ? (
    <View style={styles.zoomControlGroup}>
      <View
        style={[styles.interfaceZoomControls, styles.interfaceZoomStepper]}
        accessibilityLabel="Interface zoom controls">
        <TouchableOpacity
          {...signalTarget('header.interface-zoom.decrease')}
          style={[
            styles.interfaceZoomStepButton,
            interfaceZoom <= MINIMUM_INTERFACE_ZOOM && styles.interfaceZoomStepButtonDisabled,
          ]}
          disabled={interfaceZoom <= MINIMUM_INTERFACE_ZOOM}
          onPress={() => adjustInterfaceZoom(-1)}
          accessibilityRole="button"
          accessibilityLabel="Decrease interface zoom"
          accessibilityState={{disabled: interfaceZoom <= MINIMUM_INTERFACE_ZOOM}}>
          <Text style={styles.interfaceZoomStepButtonText}>−</Text>
        </TouchableOpacity>
        <Text
          style={[styles.interfaceZoomValue, styles.interfaceZoomStepValue]}
          accessibilityLabel={`Interface zoom ${Math.round(interfaceZoom * 100)} percent`}>
          UI {Math.round(interfaceZoom * 100)}%
        </Text>
        <TouchableOpacity
          {...signalTarget('header.interface-zoom.increase')}
          style={[
            styles.interfaceZoomStepButton,
            interfaceZoom >= MAXIMUM_INTERFACE_ZOOM && styles.interfaceZoomStepButtonDisabled,
          ]}
          disabled={interfaceZoom >= MAXIMUM_INTERFACE_ZOOM}
          onPress={() => adjustInterfaceZoom(1)}
          accessibilityRole="button"
          accessibilityLabel="Increase interface zoom"
          accessibilityState={{disabled: interfaceZoom >= MAXIMUM_INTERFACE_ZOOM}}>
          <Text style={styles.interfaceZoomStepButtonText}>+</Text>
        </TouchableOpacity>
      </View>
      <ContentZoomControl
        appearance="toolbar"
        testID="content-zoom-slider"
        value={contentZoom}
        onValueChange={previewContentZoom}
        onSlidingComplete={saveContentZoom}
      />
    </View>
  ) : null;
  const headerDetails = compactHeader ? (
    <View style={styles.headerDetails}>{interfaceZoomControls}</View>
  ) : null;
  const fullWidthHeaderControls = !compactHeader ? (
    <View style={styles.fullWidthHeaderControls}>
      {headerTabs}
      {interfaceZoomControls}
    </View>
  ) : null;
  const closeInfoMenu = () => setShowInfoMenu(false);
  const openCraftingTreeImport = () => {
    setTab('graph');
    setRecipeImportRequestId(value => value + 1);
  };
  const infoMenu = (
    <View
      style={styles.infoMenuAnchor}
      onPointerDown={event => event.stopPropagation()}
      onTouchStart={event => event.stopPropagation()}>
      <TouchableOpacity
        {...signalTarget('header.info-menu')}
        style={[
          styles.headerUtilityButton,
          Platform.OS !== 'web' && styles.nativeInfoMenuButton,
          showInfoMenu && styles.headerUtilityButtonActive,
        ]}
        onPress={() => {
          lightImpactFeedback();
          setShowInfoMenu(value => {
            const next = !value;
            if (next) setShowAppMenu(false);
            return next;
          });
        }}
        accessibilityRole="button"
        accessibilityLabel={showInfoMenu ? 'Close information menu' : 'Open information menu'}
        accessibilityState={{expanded: showInfoMenu}}>
        <Text
          style={[
            styles.infoMenuButtonText,
            showInfoMenu && styles.infoMenuButtonTextActive,
          ]}>
          •••
        </Text>
      </TouchableOpacity>
      {showInfoMenu && (
        <View
          style={[
            styles.infoMenu,
            Platform.OS === 'web' ? styles.webInfoMenuPosition : styles.nativeInfoMenuPosition,
          ]}
          accessibilityRole="menu">
          {(compactHeader || Platform.OS !== 'web') && (
            <TouchableOpacity
              {...signalTarget('header.import-pack')}
              style={styles.infoMenuItem}
              onPress={() => {
                lightImpactFeedback();
                closeInfoMenu();
                onImportPack();
              }}
              accessibilityRole="button"
              accessibilityLabel="Import a local modpack exporter ZIP">
              <Text style={styles.infoMenuItemIcon}>⇧</Text>
              <Text style={styles.infoMenuItemText}>Import pack</Text>
            </TouchableOpacity>
          )}
          {Platform.OS === 'web' && (
            <TouchableOpacity
              {...signalTarget('header.donations')}
              style={styles.infoMenuItem}
              onPress={() => {
                lightImpactFeedback();
                closeInfoMenu();
                setDonationOutcome(null);
                setShowDonations(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Support Recipe Tree and view monthly donors">
              <Text style={styles.infoMenuItemIcon}>♥</Text>
              <Text style={styles.infoMenuItemText}>Support Recipe Tree</Text>
            </TouchableOpacity>
          )}
          {Platform.OS === 'web' && (
            <TouchableOpacity
              {...signalTarget('header.recipe-favorites')}
              style={styles.infoMenuItem}
              onPress={() => {
                lightImpactFeedback();
                closeInfoMenu();
                setShowFavorites(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Open recipe favorites leaderboard">
              <Text style={styles.infoMenuItemIcon}>★</Text>
              <Text style={styles.infoMenuItemText}>Favorites</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            {...signalTarget('header.graph-guide')}
            style={styles.infoMenuItem}
            onPress={() => {
              lightImpactFeedback();
              closeInfoMenu();
              setShowGraphGuide(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Open graph info and guide">
            <Text style={styles.infoMenuItemIcon}>?</Text>
            <Text style={styles.infoMenuItemText}>Info</Text>
          </TouchableOpacity>
          <TouchableOpacity
            {...signalTarget('header.issue-report')}
            style={styles.infoMenuItem}
            onPress={() => {
              lightImpactFeedback();
              closeInfoMenu();
              setIssueReportKind('bug');
              setShowIssueReport(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Report a bug or send feedback">
            <View style={styles.infoMenuItemIcon}>
              <BugIcon active={showIssueReport} size={17} />
            </View>
            <Text style={styles.infoMenuItemText}>Bug report</Text>
          </TouchableOpacity>
          <TouchableOpacity
            {...signalTarget('header.recipe-history')}
            style={styles.infoMenuItem}
            onPress={() => {
              lightImpactFeedback();
              closeInfoMenu();
              setShowRecipeHistory(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open recipe history for ${data.descriptor.displayName}`}>
            <Text style={styles.infoMenuItemIcon}>◷</Text>
            <Text style={styles.infoMenuItemText}>History</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
  const accountHeaderAction = Platform.OS === 'web' ? (
    <TouchableOpacity
      {...signalTarget('header.account')}
      style={[styles.accountHeaderButton, account.user && styles.accountHeaderButtonSignedIn]}
      onPress={() => {
        lightImpactFeedback();
        if (account.user) setShowAccount(true);
        else setShowSignIn(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={
        account.user
          ? `Open account settings for ${account.user.displayName}`
          : 'Sign in to Recipe Tree'
      }>
      <Text style={[styles.accountHeaderStatus, account.user && styles.accountHeaderStatusSignedIn]}>
        {account.user ? '●' : '○'}
      </Text>
      <Text style={styles.accountHeaderText} numberOfLines={1}>
        {account.status === 'loading' ? 'Checking…' : account.user?.displayName ?? 'Sign in'}
      </Text>
    </TouchableOpacity>
  ) : null;
  const headerActions = (
    <View
      style={[
        styles.headerUtilityRow,
        compactHeader && Platform.OS === 'web' && styles.compactHeaderUtilityRow,
        Platform.OS !== 'web' && styles.nativeHeaderUtilityRow,
      ]}>
      {compactHeaderNavigation}
      {Platform.OS === 'web' && infoMenu}
      {recipeStages.catalog.stages.length > 0 && (
        <TouchableOpacity
          {...signalTarget('header.recipe-stages')}
          style={[
            styles.headerUtilityButton,
            styles.recipeStagesHeaderButton,
            Platform.OS !== 'web' && styles.nativeHeaderUtilityButton,
            showRecipeStages && styles.headerUtilityButtonActive,
          ]}
          onPress={() => {
            lightImpactFeedback();
            setShowRecipeStages(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Open recipe stage controls, ${recipeStages.catalog.stages.length} stages`}>
          <Text
            style={[
              styles.recipeStagesHeaderText,
              showRecipeStages && styles.recipeStagesHeaderTextActive,
            ]}>
            {Platform.OS === 'web' ? '⚑ Stages' : '⚑  Recipe stages'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
  const headerMenuAction = Platform.OS !== 'web' ? infoMenu : null;
  const headerTrailingAction = accountHeaderAction;
  return (
    <View
      style={styles.shell}
      onPointerDown={showInfoMenu ? closeInfoMenu : undefined}
      onTouchStart={showInfoMenu ? closeInfoMenu : undefined}>
      <View style={[styles.headerSurface, scaledHeaderStyle]}>
        {renderControls(
          data.manifest,
          headerDetails,
          headerActions,
          fullWidthHeaderControls,
          headerMenuAction,
          headerTrailingAction,
          showAppMenu,
          next => {
            setShowAppMenu(next);
            if (next) setShowInfoMenu(false);
          },
          openCraftingTreeImport,
        )}
      </View>
      <View style={styles.workspaceViewport}>
        <View style={styles.workspace}>
          {/* All tabs stay mounted so graph expansion state survives tab switches. */}
          <View
            style={[
              styles.body,
              Platform.OS !== 'web' && styles.nativeWorkspacePane,
              Platform.OS !== 'web' && tab === 'items' && styles.nativeWorkspacePaneActive,
              Platform.OS !== 'web' && tab !== 'items' && styles.nativeWorkspacePaneInactive,
              Platform.OS === 'web' && tab !== 'items' && styles.hidden,
            ]}
            pointerEvents={Platform.OS !== 'web' && tab !== 'items' ? 'none' : 'auto'}
            accessibilityElementsHidden={Platform.OS !== 'web' && tab !== 'items'}
            importantForAccessibility={
              Platform.OS !== 'web' && tab !== 'items' ? 'no-hide-descendants' : 'auto'
            }>
            <ItemsScreen interfaceZoom={interfaceZoom} contentZoom={contentZoom} />
          </View>
          <View
            style={[
              styles.body,
              Platform.OS !== 'web' && styles.nativeWorkspacePane,
              Platform.OS !== 'web' && tab === 'graph' && styles.nativeWorkspacePaneActive,
              Platform.OS !== 'web' && tab !== 'graph' && styles.nativeWorkspacePaneInactive,
              Platform.OS === 'web' && tab !== 'graph' && styles.hidden,
            ]}
            pointerEvents={Platform.OS !== 'web' && tab !== 'graph' ? 'none' : 'auto'}
            accessibilityElementsHidden={Platform.OS !== 'web' && tab !== 'graph'}
            importantForAccessibility={
              Platform.OS !== 'web' && tab !== 'graph' ? 'no-hide-descendants' : 'auto'
            }>
            {data.indexStatus === 'ready' ? (
              <GraphErrorBoundary
                key={graphRequestId}
                onRetry={recovery => {
                  if (recovery.reloadPage && Platform.OS === 'web') {
                    globalThis.location?.reload();
                    return;
                  }
                  clearGraphSession(data.descriptor);
                  if (ui.graphRootKey) {
                    ui.restoreGraph(ui.graphRootKey, ui.graphDirection);
                  } else {
                    setTab('items');
                  }
                }}
                onReturnToItems={() => setTab('items')}>
                <Suspense
                  fallback={
                    <View style={styles.center}>
                      <ActivityIndicator color={theme.accent} size="large" />
                      <Text style={styles.loadingText}>loading graph workspace…</Text>
                    </View>
                  }>
                  <LazyGraphScreen
                    interfaceZoom={interfaceZoom}
                    contentZoom={contentZoom}
                    onContentZoomChange={previewContentZoom}
                    onContentZoomComplete={saveContentZoom}
                    showGraphControls={showGraphControls}
                    onToggleGraphControls={() =>
                      setShowGraphControls(value => !value)
                    }
                    recipeImportRequestId={recipeImportRequestId}
                    onRecipeImportRequestHandled={() => setRecipeImportRequestId(0)}
                    recipeImportJob={recipeImportJob}
                    onRecipeImportStart={raw => {
                      recipeImportJobIdRef.current += 1;
                      setRecipeImportJob({
                        id: recipeImportJobIdRef.current,
                        raw,
                      });
                    }}
                    onRecipeImportComplete={() => setRecipeImportJob(null)}
                    recipeImportNotice={recipeImportNotice}
                    onRecipeImportNoticeChange={setRecipeImportNotice}
                    recipeImportReport={recipeImportReport}
                    onRecipeImportReportChange={setRecipeImportReport}
                  />
                </Suspense>
              </GraphErrorBoundary>
            ) : (
              <View style={styles.center}>
                {data.indexStatus !== 'error' && (
                  <ActivityIndicator color={theme.accent} size="large" />
                )}
                <Text style={data.indexStatus === 'error' ? styles.errorTitle : styles.loadingText}>
                  {data.indexStatus === 'error'
                    ? 'Recipe index unavailable'
                    : 'loading recipe index…'}
                </Text>
                {data.indexStatus === 'error' && (
                  <>
                    <Text style={styles.errorText}>{data.indexError}</Text>
                    <TouchableOpacity
                      style={styles.reloadBtn}
                      onPress={() => void data.ensureIndex().catch(() => {})}>
                      <Text style={styles.reloadBtnText}>Retry recipe index</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
          {data.capabilities.mobs && hasVisitedMobs && (
            <View
              style={[
                styles.body,
                scaledMobsWorkspaceStyle,
                Platform.OS !== 'web' && styles.nativeWorkspacePane,
                Platform.OS !== 'web' && tab === 'mobs' && styles.nativeWorkspacePaneActive,
                Platform.OS !== 'web' && tab !== 'mobs' && styles.nativeWorkspacePaneInactive,
                Platform.OS === 'web' && tab !== 'mobs' && styles.hidden,
              ]}
              pointerEvents={Platform.OS !== 'web' && tab !== 'mobs' ? 'none' : 'auto'}
              accessibilityElementsHidden={Platform.OS !== 'web' && tab !== 'mobs'}
              importantForAccessibility={
                Platform.OS !== 'web' && tab !== 'mobs' ? 'no-hide-descendants' : 'auto'
              }>
              <Suspense
                fallback={(
                  <View style={styles.center} accessibilityRole="progressbar">
                    <ActivityIndicator color={theme.accent} size="large" />
                    <Text style={styles.loadingText}>Loading mobs…</Text>
                  </View>
                )}>
                <LazyMobsScreen />
              </Suspense>
            </View>
          )}
        </View>
      </View>
      {Platform.OS !== 'web' && (
        <MobileBottomNavigation hasMobs={data.capabilities.mobs} />
      )}
      {ui.itemStack.length > 0 && (
        <Suspense fallback={<DeferredModalFallback label="item details" />}>
          <LazyItemDetailModal
            interfaceZoom={interfaceZoom}
            contentZoom={contentZoom}
            onContentZoomChange={previewContentZoom}
            onContentZoomComplete={saveContentZoom}
          />
        </Suspense>
      )}
      {showRecipeStages && (
        <Suspense fallback={<DeferredModalFallback label="recipe stages" />}>
          <LazyRecipeStageModal
            visible
            interfaceZoom={interfaceZoom}
            onClose={() => setShowRecipeStages(false)}
          />
        </Suspense>
      )}
      {showRecipeHistory && (
        <Suspense fallback={<DeferredModalFallback label="recipe history" />}>
          <LazyRecipeHistoryModal
            visible
            interfaceZoom={interfaceZoom}
            onClose={() => setShowRecipeHistory(false)}
          />
        </Suspense>
      )}
      {showFavorites && (
        <Suspense fallback={<DeferredModalFallback label="favorites" />}>
          <LazyFavoritesModal
            visible
            interfaceZoom={interfaceZoom}
            contentZoom={contentZoom}
            onContentZoomChange={previewContentZoom}
            onContentZoomComplete={saveContentZoom}
            onClose={() => setShowFavorites(false)}
          />
        </Suspense>
      )}
      {showSignIn && (
        <Suspense fallback={<DeferredModalFallback label="sign in" />}>
          <LazySignInModal
            visible
            interfaceZoom={interfaceZoom}
            onClose={() => setShowSignIn(false)}
          />
        </Suspense>
      )}
      {showAccount && (
        <Suspense fallback={<DeferredModalFallback label="account" />}>
          <LazyAccountModal
            visible
            interfaceZoom={interfaceZoom}
            onClose={() => setShowAccount(false)}
            onOpenDonations={() => {
              setShowAccount(false);
              setDonationOutcome(null);
              setShowDonations(true);
            }}
          />
        </Suspense>
      )}
      {showDonations && (
        <Suspense fallback={<DeferredModalFallback label="donations" />}>
          <LazyDonationsModal
            visible
            interfaceZoom={interfaceZoom}
            checkoutOutcome={donationOutcome}
            onClose={() => {
              setShowDonations(false);
              setDonationOutcome(null);
            }}
          />
        </Suspense>
      )}
      {showGraphGuide && (
        <Suspense fallback={<DeferredModalFallback label="graph guide" />}>
          <LazyGraphGuideModal
            visible
            interfaceZoom={interfaceZoom}
            onClose={() => setShowGraphGuide(false)}
            onOpenIssueReport={kind => {
              setShowGraphGuide(false);
              setIssueReportKind(kind);
              setShowIssueReport(true);
            }}
          />
        </Suspense>
      )}
      {showIssueReport && (
        <Suspense fallback={<DeferredModalFallback label="issue report" />}>
          <LazyIssueReportModal
            visible
            interfaceZoom={interfaceZoom}
            initialKind={issueReportKind}
            context={issueReportContext}
            onClose={() => setShowIssueReport(false)}
          />
        </Suspense>
      )}
      {showWelcome && (
        <Suspense fallback={<DeferredModalFallback label="welcome" />}>
          <LazyWelcomeModal
            visible
            interfaceZoom={interfaceZoom}
            onClose={() => {
              setShowWelcome(false);
              markOnboardingSeen();
            }}
          />
        </Suspense>
      )}
    </View>
  );
}

function TabBtn({tab, label}: {tab: Tab; label: string}) {
  const ui = useUi();
  const active = ui.tab === tab;
  return (
    <TouchableOpacity
      {...signalTarget(`tab.${tab}`)}
      onPress={() => {
        selectionFeedback();
        ui.setTab(tab);
      }}
      style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MobileBottomNavigation({hasMobs}: {hasMobs: boolean}) {
  const ui = useUi();
  const tabs = useMemo(
    () => [
      {tab: 'items' as const, icon: '☷', label: 'Browse'},
      {tab: 'graph' as const, icon: '⌘', label: 'Tree'},
      ...(hasMobs ? [{tab: 'mobs' as const, icon: '♟', label: 'Mobs'}] : []),
    ],
    [hasMobs],
  );
  const selectedIndex = Math.max(0, tabs.findIndex(item => item.tab === ui.tab));
  const animatedIndex = useRef(new Animated.Value(selectedIndex)).current;
  const [navigationWidth, setNavigationWidth] = useState(0);
  const segmentWidth = Math.max(0, (navigationWidth - 20) / tabs.length);

  useEffect(() => {
    Animated.spring(animatedIndex, {
      toValue: selectedIndex,
      damping: 22,
      stiffness: 230,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [animatedIndex, selectedIndex]);

  return (
    <SafeAreaView edges={['bottom']} style={styles.mobileNavigationSafeArea}>
      <View
        style={styles.mobileNavigation}
        onLayout={event => setNavigationWidth(event.nativeEvent.layout.width)}
        accessibilityRole="tablist"
        accessibilityLabel="Main navigation">
        {segmentWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.mobileTabIndicator,
              {
                width: segmentWidth,
                transform: [{translateX: Animated.multiply(animatedIndex, segmentWidth)}],
              },
            ]}
          />
        )}
        {tabs.map(item => (
          <MobileTabBtn key={item.tab} {...item} />
        ))}
      </View>
    </SafeAreaView>
  );
}

function MobileTabBtn({tab, icon, label}: {tab: Tab; icon: string; label: string}) {
  const ui = useUi();
  const active = ui.tab === tab;
  return (
    <TouchableOpacity
      {...signalTarget(`tab.${tab}`)}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{selected: active}}
      onPress={() => {
        selectionFeedback();
        ui.setTab(tab);
      }}
      style={[styles.mobileTab, active && styles.mobileTabActive]}>
      <Text style={[styles.mobileTabIcon, active && styles.mobileTabIconActive]}>
        {icon}
      </Text>
      <Text style={[styles.mobileTabLabel, active && styles.mobileTabLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, minHeight: 0, backgroundColor: theme.bg},
  datasetRoot: {flex: 1, minHeight: 0, backgroundColor: theme.bg},
  datasetContent: {flex: 1, minHeight: 0},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  loadingText: {color: theme.textDim, marginTop: 14},
  deferredModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  deferredModalCard: {
    minWidth: 220,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 12,
    backgroundColor: theme.panel,
  },
  errorTitle: {color: theme.text, fontSize: 18, fontWeight: '700'},
  errorText: {
    color: theme.textDim,
    marginTop: 10,
    maxWidth: 560,
    lineHeight: 20,
    fontSize: 13,
  },
  reloadBtn: {
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  reloadBtnText: {color: theme.accent, fontSize: 13, fontWeight: '700'},
  graphRecovery: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.bg,
  },
  graphRecoveryDetail: {
    marginTop: 10,
    maxWidth: 640,
    color: theme.textDim,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  graphRecoveryActions: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  graphRecoveryButton: {marginTop: 0},
  shell: {flex: 1, minHeight: 0},
  headerSurface: {position: 'relative', zIndex: 200},
  headerDetails: {gap: 7},
  compactHeaderNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  fullWidthHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
  },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  subtitle: {color: theme.textDim, fontSize: 11, lineHeight: 16},
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabBtnActive: {backgroundColor: theme.panelAlt, borderColor: theme.border},
  tabBtnText: {color: theme.textDim, fontSize: 13},
  tabBtnTextActive: {color: theme.accent, fontWeight: '700'},
  headerUtilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  compactHeaderUtilityRow: {
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  nativeHeaderUtilityRow: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
  },
  headerUtilityButton: {
    width: 34,
    minHeight: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panelAlt,
  },
  nativeHeaderUtilityButton: {
    width: '100%',
    minWidth: 0,
    minHeight: 44,
    alignItems: 'flex-start',
    paddingHorizontal: 12,
  },
  nativeInfoMenuButton: {width: 44, minHeight: 44},
  headerUtilityButtonActive: {borderColor: theme.accent},
  accountHeaderButton: {
    minWidth: 76,
    maxWidth: 180,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    flexShrink: 1,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panelAlt,
  },
  accountHeaderButtonSignedIn: {borderColor: theme.accent},
  accountHeaderStatus: {color: theme.textDim, fontSize: 11},
  accountHeaderStatusSignedIn: {color: theme.accent},
  accountHeaderText: {minWidth: 0, flexShrink: 1, color: theme.text, fontSize: 11, fontWeight: '800'},
  recipeStagesHeaderButton: {width: 'auto', minWidth: 72, paddingHorizontal: 8},
  recipeStagesHeaderText: {color: theme.text, fontSize: 11, fontWeight: '800'},
  recipeStagesHeaderTextActive: {color: theme.accent},
  infoMenuAnchor: {position: 'relative', zIndex: 120},
  infoMenuButtonText: {color: theme.text, fontSize: 13, fontWeight: '900', letterSpacing: 1},
  infoMenuButtonTextActive: {color: theme.accent},
  infoMenu: {
    position: 'absolute',
    top: 40,
    zIndex: 121,
    elevation: 20,
    width: 178,
    padding: 6,
    gap: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panelAlt,
    shadowColor: '#000',
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 10},
  },
  webInfoMenuPosition: {left: 0},
  nativeInfoMenuPosition: {top: 48, right: 0},
  infoMenuItem: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderRadius: 7,
  },
  infoMenuItemActive: {backgroundColor: theme.panel},
  infoMenuItemIcon: {
    width: 20,
    alignItems: 'center',
    color: theme.textDim,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  infoMenuItemText: {color: theme.text, fontSize: 12, fontWeight: '700'},
  infoMenuItemTextActive: {color: theme.accent},
  nativeHeaderMenuText: {color: theme.text, fontSize: 12, fontWeight: '700'},
  interfaceZoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 8,
    minHeight: 34,
    paddingHorizontal: 9,
    backgroundColor: theme.panelAlt,
  },
  zoomControlGroup: {flexDirection: 'row', alignItems: 'center', gap: 6},
  interfaceZoomStepper: {paddingHorizontal: 4, gap: 2},
  interfaceZoomStepButton: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panel,
  },
  interfaceZoomStepButtonDisabled: {opacity: 0.35},
  interfaceZoomStepButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  interfaceZoomValue: {
    minWidth: 60,
    marginRight: 5,
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  interfaceZoomStepValue: {minWidth: 54, marginRight: 0},
  workspaceViewport: {flex: 1, minHeight: 0, overflow: 'hidden'},
  workspace: {flex: 1, minHeight: 0, position: 'relative'},
  body: {flex: 1, minHeight: 0},
  nativeWorkspacePane: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  nativeWorkspacePaneActive: {opacity: 1, zIndex: 1},
  nativeWorkspacePaneInactive: {opacity: 0, zIndex: 0},
  mobileNavigationSafeArea: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.panel,
  },
  mobileNavigation: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 5,
  },
  mobileTabIndicator: {
    position: 'absolute',
    left: 10,
    top: 6,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panelAlt,
  },
  mobileTab: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 12,
    zIndex: 1,
  },
  mobileTabActive: {},
  mobileTabIcon: {color: theme.textDim, fontSize: 20, lineHeight: 22},
  mobileTabIconActive: {color: theme.accent},
  mobileTabLabel: {color: theme.textDim, fontSize: 10, fontWeight: '700'},
  mobileTabLabelActive: {color: theme.accent},
  hidden: {display: 'none'},
});

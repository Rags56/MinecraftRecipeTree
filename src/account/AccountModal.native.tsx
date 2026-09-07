import {useData} from '../data/DataContext';
import {loadedDatasetAttribution} from '../data/datasetAttribution';
import {DatasetDisclaimer} from '../components/DatasetDisclaimer';
import {NativeUiScale} from '../ui/nativeUiScale';
import {ScaleSettings} from '../components/ScaleSettings';
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {useUser} from './UserContext';
import {useDatasetCatalog} from '../data/DatasetCatalogContext';
import {listDownloads, removeDownload, saveDownload} from '../native/packLibrary.native';
import type {DownloadProgress} from '../native/packDownload';
import {isLocalPackDescriptor} from '../data/localPackStorage';
import {DiscordIcon} from '../components/DiscordIcon';
import {theme} from '../theme';

// The native account surface lives in the Settings tab. The web adapter remains a modal.
export function AccountModal({onClose, onOpenHistory, interfaceZoom, contentZoom, onInterfaceZoomChange, onContentZoomChange, onContentZoomComplete}: {
  visible: boolean;
  interfaceZoom: number;
  contentZoom: number;
  onInterfaceZoomChange(direction: -1 | 1): void;
  onContentZoomChange(value: number): void;
  onContentZoomComplete(value: number): void;
  onClose(): void;
  onOpenDonations(): void;
  onOpenHistory?(): void;
}) {
  const account = useUser();
  const data = useData();
  const attribution = loadedDatasetAttribution(data.manifest);
  const catalog = useDatasetCatalog();
  const [name, setName] = useState(account.user?.displayName ?? '');
  const [editingName, setEditingName] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<ReturnType<typeof listDownloads>>([]);
  const activeDownload = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => () => activeDownload.current?.abort(new Error('Download stopped because the viewer closed.')), []);
  useEffect(() => {
    activeDownload.current?.abort(new Error('The account changed.'));
    setEditingName(false);
    setError(null);
    try {setDownloads(account.user ? listDownloads(account.user.id) : []);}
    catch (cause) {
      console.error('Downloaded library could not be read.', cause);
      setDownloads([]);
      setError(cause instanceof Error ? cause.message : 'Downloaded library unavailable.');
    }
  }, [account.user?.id]);
  useEffect(() => {setName(account.user?.displayName ?? '');}, [account.user?.displayName]);

  const refresh = () => {
    setDownloads(account.user ? listDownloads(account.user.id) : []);
    catalog.refreshLocal();
  };
  const run = (operation: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    void operation().catch(cause => {
      console.error('iOS account operation failed.', cause);
      setError(cause instanceof Error ? cause.message : 'The operation failed.');
    }).finally(() => {
      busy.current = false;
      setPending(false);
      activeDownload.current = null;
      setDownloadName(null);
      setProgress(null);
    });
  };
  const datasets = catalog.state.status === 'loading' ? [] : catalog.state.datasets.filter(entry => !isLocalPackDescriptor(entry));
  const totalBytes = downloads.reduce((total, download) => total + download.bytes, 0);
  const accountError = error ?? account.error;

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <NativeUiScale><View style={s.content}>
      <View style={s.pageHeader}>
        <Text style={s.pageTitle} accessibilityRole="header">Settings</Text>
        <Text style={s.subtitle}>Your account and offline library</Text>
      </View>

      <ScaleSettings interfaceZoom={interfaceZoom} contentZoom={contentZoom} onInterfaceZoomChange={onInterfaceZoomChange} onContentZoomChange={onContentZoomChange} onContentZoomComplete={onContentZoomComplete} />

      {accountError && <Text style={s.error} accessibilityRole="alert">{accountError}</Text>}
      <View style={s.card}>
        <View style={s.accountHeader}>
          <View style={s.avatar}>
            {account.user ? <Text style={s.initial}>{account.user.displayName.charAt(0).toUpperCase()}</Text> : <DiscordIcon size={24} />}
          </View>
          <View style={s.grow}>
            <Text style={s.title}>{account.user?.displayName ?? 'Your recipe library'}</Text>
            <Text style={s.detail}>{account.user ? 'Connected with Discord' : 'Favorites and packs, in one place.'}</Text>
          </View>
          {account.user && !editingName && <Action label="Edit" accessibilityLabel="Edit display name" disabled={pending} onPress={() => setEditingName(true)} />}
        </View>
        {!account.user && (
          <TouchableOpacity style={[s.discord, pending && s.disabled]} disabled={pending} onPress={() => run(account.signInWithDiscord)} accessibilityRole="button">
            {pending ? <ActivityIndicator color="#fff" /> : <DiscordIcon size={18} />}
            <Text style={s.discordText}>{pending ? 'Signing in…' : 'Continue with Discord'}</Text>
          </TouchableOpacity>
        )}
        {account.user && editingName && (
          <View style={s.editName}>
            <Text style={s.detail}>Display name</Text>
            <TextInput style={s.input} accessibilityLabel="Display name" value={name} onChangeText={setName} autoCorrect={false} editable={!pending} returnKeyType="done" />
            <View style={s.editActions}>
              <Action label="Cancel" disabled={pending} onPress={() => {setName(account.user?.displayName ?? ''); setEditingName(false);}} />
              <Action label="Save" disabled={pending || !name.trim() || name.trim() === account.user.displayName} onPress={() => run(async () => {await account.updateDisplayName(name.trim()); setEditingName(false);})} />
            </View>
          </View>
        )}
      </View>

      <View style={s.sectionHeading}>
        <Text style={s.sectionTitle} accessibilityRole="header">Downloads</Text>
        {account.user && <Text style={s.meta}>{downloads.length} saved · {formatBytes(totalBytes)}</Text>}
      </View>
      {!account.user ? (
        <View style={s.card}>
          <Text style={s.title}>Take your packs offline</Text>
          <Text style={s.detail}>Sign in above to save recipes, icons and previews on this iPhone.</Text>
        </View>
      ) : (
        <>
          <Text style={s.sectionNote}>Keep the app open while downloading. Large packs are best saved over Wi-Fi.</Text>
          {downloadName && (
            <View style={s.card} accessibilityLiveRegion="polite">
              <View style={s.accountHeader}>
                <ActivityIndicator color={theme.accent} />
                <View style={s.grow}>
                  <Text style={s.title}>Downloading {downloadName}</Text>
                  <Text style={s.detail}>{progress ? `${formatBytes(progress.bytes)} · ${progress.files} files saved` : 'Preparing download…'}</Text>
                </View>
                <Action label="Cancel" onPress={() => activeDownload.current?.abort(new Error('Download cancelled. No partial pack was saved.'))} />
              </View>
            </View>
          )}
          <View style={s.list}>
            {datasets.map((descriptor, index) => {
              const saved = downloads.find(entry => entry.descriptor.publicationId === descriptor.publicationId && entry.descriptor.previewAssetSetId === descriptor.previewAssetSetId);
              return (
                <View key={descriptor.slug} style={[s.packRow, index > 0 && s.separator]}>
                  <View style={s.grow}>
                    <Text style={s.title}>{descriptor.displayName}</Text>
                    <Text style={s.detail}>{descriptor.packVersion}{saved ? ` · ${formatBytes(saved.bytes)}` : ''}</Text>
                    {saved && <Text style={s.saved}>Available offline</Text>}
                  </View>
                  <Action label={saved ? 'Open' : '↓'} accessibilityLabel={saved ? `Open downloaded ${descriptor.displayName}` : `Download ${descriptor.displayName}`} disabled={pending} onPress={() => {
                    if (saved) {catalog.select(descriptor.slug); onClose(); return;}
                    Alert.alert(`Download ${descriptor.displayName}?`, 'Save this complete pack on your iPhone. Large packs can use over 1 GB of storage and mobile data.', [
                      {text: 'Cancel', style: 'cancel'},
                      {text: 'Download', onPress: () => run(async () => {
                        if (!account.user) throw new Error('Sign in before downloading a pack.');
                        const request = new AbortController();
                        activeDownload.current = request;
                        setDownloadName(descriptor.displayName);
                        setProgress(null);
                        await saveDownload(account.user.id, descriptor, request.signal, setProgress);
                        refresh();
                      })},
                    ]);
                  }} />
                  {saved && <Action label="×" accessibilityLabel={`Remove ${descriptor.displayName} download`} disabled={pending} destructive onPress={() => Alert.alert('Remove download?', 'The online pack will still be available.', [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Remove', style: 'destructive', onPress: () => run(async () => {if (account.user) removeDownload(account.user.id, descriptor); refresh();})},
                  ])} />}
                </View>
              );
            })}
            {datasets.length === 0 && <Text style={s.empty}>{catalog.state.status === 'loading' ? 'Loading packs…' : 'No packs are available to download.'}</Text>}
          </View>
        </>
      )}

      <Text style={s.sectionTitle} accessibilityRole="header">History</Text>
      <View style={s.list}>
        <TouchableOpacity style={s.packRow} onPress={onOpenHistory} accessibilityRole="button" accessibilityLabel="Open tree history">
          <View style={s.grow}><Text style={s.title}>Tree history</Text><Text style={s.detail}>Saved trees for your current pack</Text></View>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>
        <View style={[s.packRow, s.separator]}>
          <View style={s.grow}><Text style={s.title}>Minecraft sync</Text><Text style={s.detail}>Automatic syncing isn’t connected yet.</Text></View>
        </View>
      </View>
      {attribution && <DatasetDisclaimer attribution={attribution} variant="menu" />}
      {account.user && (
        <View style={s.session}>
          {pending && !downloadName && <ActivityIndicator color={theme.accent} />}
          <Action label="Sign out" disabled={pending} onPress={() => run(account.signOut)} />
          <Action label="Delete account" destructive disabled={pending} onPress={() => Alert.alert('Delete your account?', 'This permanently deletes your Recipe Tree account and synced favorites.', [
            {text: 'Cancel', style: 'cancel'},
            {text: 'Delete account', style: 'destructive', onPress: () => run(account.deleteAccount)},
          ])} />
        </View>
      )}
      </View></NativeUiScale>
    </ScrollView>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`;
}
function Action({label, accessibilityLabel, onPress, disabled = false, destructive = false}: {
  label: string; accessibilityLabel?: string; onPress(): void; disabled?: boolean; destructive?: boolean;
}) {
  return <TouchableOpacity style={[s.action, disabled && s.disabled]} disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}>
    <Text style={[s.actionText, destructive && s.danger]}>{label}</Text>
  </TouchableOpacity>;
}
const s = StyleSheet.create({
  screen: {flex: 1, backgroundColor: theme.bg},
  content: {padding: 20, paddingBottom: 32, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center'},
  pageHeader: {paddingTop: 12, paddingBottom: 10, gap: 5},
  pageTitle: {color: theme.text, fontSize: 32, fontWeight: '800'},
  subtitle: {color: theme.textDim, fontSize: 14},
  card: {backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 14},
  list: {backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden'},
  accountHeader: {flexDirection: 'row', alignItems: 'center', gap: 12},
  avatar: {width: 44, height: 44, borderRadius: 12, backgroundColor: '#5865f2', alignItems: 'center', justifyContent: 'center'},
  initial: {color: '#fff', fontSize: 22, fontWeight: '800'},
  grow: {flex: 1, minWidth: 0, gap: 4},
  title: {color: theme.text, fontSize: 15, fontWeight: '700'},
  detail: {color: theme.textDim, fontSize: 13, lineHeight: 18},
  sectionHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12},
  sectionTitle: {color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 6},
  sectionNote: {color: theme.textDim, fontSize: 12, lineHeight: 18},
  meta: {color: theme.textDim, fontSize: 12},
  packRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, minHeight: 64, gap: 8},
  separator: {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border},
  saved: {color: theme.accent, fontSize: 11},
  action: {minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center'},
  actionText: {color: theme.accent, fontSize: 14, fontWeight: '700'},
  danger: {color: theme.danger},
  disabled: {opacity: 0.4},
  chevron: {color: theme.textDim, fontSize: 24},
  discord: {backgroundColor: '#5865f2', minHeight: 48, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9},
  discordText: {color: '#fff', fontSize: 14, fontWeight: '700'},
  editName: {gap: 8},
  input: {color: theme.text, backgroundColor: theme.panelAlt, borderColor: theme.borderLight, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 44, fontSize: 16},
  editActions: {flexDirection: 'row', justifyContent: 'flex-end'},
  session: {alignItems: 'center', paddingTop: 6, gap: 2},
  empty: {color: theme.textDim, padding: 16, fontSize: 13},
  error: {color: theme.danger, fontSize: 13, lineHeight: 19, padding: 12, backgroundColor: theme.panel, borderRadius: 10},
});

import {Modal} from '../ui/nativeUiScale';
import * as DocumentPicker from 'expo-document-picker';
import {File as NativeFile} from 'expo-file-system';
import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {inspectLocalPackArchive, type LocalPackArchiveFile} from '../data/localPackInspection';
import {installLocalPackArchive} from '../data/localPackStorage';
import {localPackUploadErrorMessage} from '../data/localPackUploadError';
import {theme} from '../theme';
import {SafeAreaProvider, SafeAreaView, initialWindowMetrics} from '../ui/safeArea';

type ImportPhase = 'choosing' | 'checking' | 'reading' | 'saving' | 'finalizing';
type ImportState =
  | {status: 'idle'}
  | {status: 'working'; filename: string; phase: ImportPhase; progress: number; detail: string}
  | {status: 'error'; filename: string | null; message: string};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function phaseLabel(phase: ImportPhase): string {
  if (phase === 'choosing') return 'Opening Files…';
  if (phase === 'checking') return 'Checking ZIP…';
  if (phase === 'reading') return 'Reading export…';
  if (phase === 'saving') return 'Saving on device…';
  return 'Preparing viewer…';
}

export function MobileUploadGuide({
  visible,
  onClose,
  onInstalled,
}: {
  visible: boolean;
  onClose(): void;
  onInstalled(slug: string): void;
}) {
  const operationRef = useRef(0);
  const [state, setState] = useState<ImportState>({status: 'idle'});
  const busy = state.status === 'working';

  useEffect(() => {
    if (!visible) {
      operationRef.current += 1;
      setState({status: 'idle'});
    }
  }, [visible]);

  const chooseZip = async () => {
    const operation = operationRef.current + 1;
    let selectedFilename: string | null = null;
    operationRef.current = operation;
    setState({
      status: 'working',
      filename: 'exporter ZIP',
      phase: 'choosing',
      progress: 0,
      detail: 'Choose the completed exporter ZIP from Files or Downloads.',
    });
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (operationRef.current !== operation) return;
      if (result.canceled) {
        setState({status: 'idle'});
        return;
      }

      const asset = result.assets[0];
      selectedFilename = asset.name;
      if (!asset.name.toLowerCase().endsWith('.zip')) {
        setState({
          status: 'error',
          filename: asset.name,
          message: 'Choose the ZIP made from your completed jei-exports folder.',
        });
        return;
      }
      const nativeFile = new NativeFile(asset.uri);
      const file: LocalPackArchiveFile = {
        name: asset.name,
        size: nativeFile.size,
        slice: (start, end) => nativeFile.slice(start, end),
      };
      setState({
        status: 'working',
        filename: file.name,
        phase: 'checking',
        progress: 0,
        detail: `Checking ${formatBytes(file.size)} locally.`,
      });
      const inspected = await inspectLocalPackArchive(file, fraction => {
        if (operationRef.current !== operation) return;
        setState({
          status: 'working',
          filename: file.name,
          phase: 'checking',
          progress: fraction,
          detail: `${Math.round(fraction * 100)}% checked`,
        });
      });
      if (operationRef.current !== operation) return;
      if (!inspected.summary.readyForHandoff) {
        throw new Error(inspected.summary.findings.join(' '));
      }

      const installed = await installLocalPackArchive(
        file,
        inspected.manifestPath,
        inspected.manifestBytes,
        inspected.manifest,
        inspected.summary,
        progress => {
          if (operationRef.current !== operation) return;
          if (progress.phase === 'finalizing') {
            setState({
              status: 'working',
              filename: file.name,
              phase: 'finalizing',
              progress: 1,
              detail: 'Adding the pack to the mobile viewer.',
            });
          } else if (progress.phase === 'saving') {
            setState({
              status: 'working',
              filename: file.name,
              phase: 'saving',
              progress: progress.fraction,
              detail: `${progress.completedFiles.toLocaleString()} of ${progress.totalFiles.toLocaleString()} files saved`,
            });
          } else {
            setState({
              status: 'working',
              filename: file.name,
              phase: 'reading',
              progress: progress.fraction,
              detail: `${formatBytes(progress.completedBytes)} of ${formatBytes(progress.totalBytes)} read · ${progress.discoveredFiles.toLocaleString()} files`,
            });
          }
        },
        inspected.delta,
      );
      if (operationRef.current !== operation) return;
      onInstalled(installed.descriptor.slug);
    } catch (error) {
      if (operationRef.current !== operation) return;
      console.error('The mobile exporter ZIP import failed.', error);
      setState({
        status: 'error',
        filename: selectedFilename,
        message: localPackUploadErrorMessage(error),
      });
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
      onRequestClose={busy ? undefined : onClose}
      accessibilityViewIsModal>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.page}>
          <View style={styles.header}>
            <TouchableOpacity
              style={[styles.backButton, busy && styles.disabled]}
              disabled={busy}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close local pack import">
              <Text style={styles.backIcon}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} accessibilityRole="header">Import local pack</Text>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            <View style={styles.localBadge}>
              <Text style={styles.localBadgeText}>STAYS ON THIS DEVICE</Text>
            </View>
            <Text style={styles.title}>Open an exporter ZIP</Text>
            <Text style={styles.body}>
              Create the export in desktop Minecraft, move the completed ZIP to this phone or
              tablet, then choose it below. The pack is stored only inside Recipe Tree and is not
              published or uploaded.
            </Text>

            <TouchableOpacity
              style={[styles.chooseButton, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void chooseZip()}
              accessibilityRole="button"
              accessibilityLabel="Choose exporter ZIP from this device">
              <Text style={styles.chooseButtonText}>
                {state.status === 'error' ? 'Choose another ZIP' : 'Choose exporter ZIP'}
              </Text>
            </TouchableOpacity>

            {state.status === 'working' && (
              <View style={styles.statusCard} accessibilityLiveRegion="polite">
                <View style={styles.statusTopline}>
                  <ActivityIndicator color={theme.accent} />
                  <View style={styles.statusCopy}>
                    <Text style={styles.statusTitle}>{phaseLabel(state.phase)}</Text>
                    <Text style={styles.statusFilename} numberOfLines={1}>{state.filename}</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, {width: `${Math.max(2, state.progress * 100)}%`}]} />
                </View>
                <Text style={styles.statusDetail}>{state.detail}</Text>
              </View>
            )}

            {state.status === 'error' && (
              <View style={styles.errorCard} accessibilityRole="alert">
                <Text style={styles.errorTitle}>Couldn’t add this pack</Text>
                {state.filename && <Text style={styles.errorFilename}>{state.filename}</Text>}
                <Text style={styles.errorText}>{state.message}</Text>
              </View>
            )}

            <View style={styles.steps}>
              <UploadStep
                number="1"
                title="Create the export on your computer"
                body="Run the matching Recipe Tree exporter in the modpack and wait for the completed ZIP."
              />
              <UploadStep
                number="2"
                title="Move the ZIP to this device"
                body="Use AirDrop, a USB cable, cloud drive, email, or any other file transfer you trust."
              />
              <UploadStep
                number="3"
                title="Choose it in Recipe Tree"
                body="The app validates and saves the pack locally. It then opens automatically in the viewer."
                last
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function UploadStep({
  number,
  title,
  body,
  last = false,
}: {
  number: string;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
        {!last && <View style={styles.stepLine} />}
      </View>
      <View style={styles.stepCopy}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: theme.bg},
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.panel,
  },
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  backIcon: {color: theme.accent, fontSize: 32, lineHeight: 34},
  headerTitle: {flex: 1, color: theme.text, fontSize: 17, fontWeight: '800'},
  headerSpacer: {width: 44},
  scroll: {flex: 1},
  content: {padding: 22, paddingBottom: 38},
  localBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.panelAlt,
  },
  localBadgeText: {color: theme.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.8},
  title: {color: theme.text, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 16},
  body: {color: theme.textDim, fontSize: 14, lineHeight: 21, marginTop: 10},
  chooseButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: theme.accent,
  },
  chooseButtonText: {color: '#0b2613', fontSize: 15, fontWeight: '900'},
  disabled: {opacity: 0.5},
  statusCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.borderLight,
    backgroundColor: theme.panel,
  },
  statusTopline: {flexDirection: 'row', alignItems: 'center', gap: 12},
  statusCopy: {flex: 1, minWidth: 0},
  statusTitle: {color: theme.text, fontSize: 14, fontWeight: '800'},
  statusFilename: {color: theme.textDim, fontSize: 11, marginTop: 2},
  progressTrack: {height: 7, marginTop: 14, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.bg},
  progressFill: {height: '100%', borderRadius: 999, backgroundColor: theme.accent},
  statusDetail: {color: theme.textDim, fontSize: 11, lineHeight: 16, marginTop: 8},
  errorCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.warn,
    backgroundColor: theme.panel,
  },
  errorTitle: {color: theme.warn, fontSize: 14, fontWeight: '900'},
  errorFilename: {color: theme.textDim, fontSize: 11, marginTop: 4},
  errorText: {color: theme.text, fontSize: 12, lineHeight: 18, marginTop: 9},
  steps: {marginTop: 28},
  step: {flexDirection: 'row', minHeight: 92},
  stepRail: {width: 34, alignItems: 'center'},
  stepNumber: {width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.panelAlt, borderWidth: 1, borderColor: theme.accent},
  stepNumberText: {color: theme.accent, fontSize: 12, fontWeight: '900'},
  stepLine: {width: 1, flex: 1, backgroundColor: theme.borderLight},
  stepCopy: {flex: 1, paddingLeft: 12, paddingBottom: 22},
  stepTitle: {color: theme.text, fontSize: 14, lineHeight: 20, fontWeight: '800'},
  stepBody: {color: theme.textDim, fontSize: 12, lineHeight: 18, marginTop: 4},
});

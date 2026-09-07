import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {theme} from '../theme';
import {
  buildIssueReportPayload,
  type GitHubIssueKind,
  type IssueReportContext,
  type IssueReportRuntime,
} from './githubIssues';

type SubmissionState =
  | {status: 'idle'}
  | {status: 'submitting'}
  | {status: 'error'; message: string}
  | {status: 'submitted'; issueUrl: string};

function runtimeDiagnostics(context: IssueReportContext): IssueReportRuntime {
  const browserWindow = Platform.OS === 'web' && typeof window !== 'undefined' ? window : null;
  const browserNavigator = typeof navigator !== 'undefined' ? navigator : null;
  const pixelRatio = browserWindow?.devicePixelRatio ?? 1;
  return {
    page: browserWindow
      ? `${browserWindow.location.pathname}${browserWindow.location.search}`
      : `/${context.activeTab}`,
    platform: `${Platform.OS} ${String(Platform.Version)}`,
    userAgent: browserNavigator?.userAgent ?? Platform.OS,
    viewport: browserWindow
      ? `${browserWindow.innerWidth}×${browserWindow.innerHeight} @${pixelRatio}x`
      : 'Unavailable',
    language: browserNavigator?.language ?? 'Unavailable',
    online: browserNavigator && 'onLine' in browserNavigator
      ? browserNavigator.onLine ? 'yes' : 'no'
      : 'Unavailable',
  };
}

function feedbackEndpoint(): string {
  return Platform.OS === 'web'
    ? '/api/feedback'
    : 'https://minecraftrecipetree.craftsmannsoftware.com/api/feedback';
}

export function IssueReportModal({
  visible,
  initialKind,
  context,
  onClose,
  interfaceZoom = 1,
}: {
  visible: boolean;
  initialKind: GitHubIssueKind;
  context: IssueReportContext;
  onClose(): void;
  interfaceZoom?: number;
}) {
  const [kind, setKind] = useState<GitHubIssueKind>(initialKind);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [submission, setSubmission] = useState<SubmissionState>({status: 'idle'});
  const runtime = useMemo(() => runtimeDiagnostics(context), [context]);
  const canSubmit =
    title.trim().length >= 3 &&
    message.trim().length >= 10 &&
    submission.status !== 'submitting';
  const scaledCardStyle =
    Platform.OS === 'web'
      ? ({
          zoom: interfaceZoom,
          width: `${100 / interfaceZoom}%`,
          maxWidth: 560 / interfaceZoom,
          maxHeight: `${90 / interfaceZoom}%`,
        } as unknown as object)
      : null;

  useEffect(() => {
    if (!visible) return;
    setKind(initialKind);
    setTitle('');
    setMessage('');
    setSubmission({status: 'idle'});
  }, [initialKind, visible]);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmission({status: 'submitting'});
    try {
      const response = await fetch(feedbackEndpoint(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(Platform.OS !== 'web'
            ? {Origin: 'https://minecraftrecipetree.craftsmannsoftware.com'}
            : {}),
        },
        body: JSON.stringify(buildIssueReportPayload(kind, title, message, context, runtime)),
      });
      const payload = (await response.json()) as {issueUrl?: unknown; error?: unknown};
      if (!response.ok || typeof payload.issueUrl !== 'string') {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : `Report submission failed with status ${response.status}.`,
        );
      }
      setSubmission({status: 'submitted', issueUrl: payload.issueUrl});
    } catch (error) {
      console.error('Issue report could not be submitted.', error);
      setSubmission({
        status: 'error',
        message: error instanceof Error ? error.message : 'The report could not be submitted.',
      });
    }
  };

  const openIssue = () => {
    if (submission.status !== 'submitted') return;
    void Linking.openURL(submission.issueUrl).catch(error => {
      console.error('The submitted GitHub issue could not be opened.', error);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, scaledCardStyle]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Report an issue</Text>
              <Text style={styles.subtitle}>Send a bug report or feedback directly to GitHub</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close issue report"
              onPress={onClose}
              style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {submission.status === 'submitted' ? (
            <View style={styles.success} accessibilityRole="alert">
              <Text style={styles.successMark}>✓</Text>
              <Text style={styles.successTitle}>Sent to GitHub</Text>
              <Text style={styles.successText}>
                Your report and diagnostics were added to the Recipe Tree issue tracker.
              </Text>
              <View style={styles.successActions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
                  <Text style={styles.secondaryButtonText}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.submitButton} onPress={openIssue}>
                  <Text style={styles.submitButtonText}>View GitHub issue</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled">
              <View
                style={styles.kindToggle}
                accessibilityRole="tablist"
                accessibilityLabel="Report type">
                {(['bug', 'feedback'] as const).map(option => {
                  const selected = kind === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      accessibilityRole="tab"
                      accessibilityState={{selected}}
                      accessibilityLabel={option === 'bug' ? 'Bug report' : 'Feedback'}
                      onPress={() => {
                        setKind(option);
                        if (submission.status === 'error') setSubmission({status: 'idle'});
                      }}
                      style={[styles.kindOption, selected && styles.kindOptionSelected]}>
                      <Text style={[styles.kindText, selected && styles.kindTextSelected]}>
                        {option === 'bug' ? 'Bug report' : 'Feedback'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Title</Text>
                <TextInput
                  accessibilityLabel="Issue title"
                  autoFocus={Platform.OS === 'web'}
                  maxLength={120}
                  value={title}
                  onChangeText={setTitle}
                  placeholder={kind === 'bug' ? 'What went wrong?' : 'What could be better?'}
                  placeholderTextColor={theme.textDim}
                  style={styles.titleInput}
                />
                <Text style={styles.counter}>{title.length}/120</Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>
                  {kind === 'bug' ? 'What happened?' : 'Your feedback'}
                </Text>
                <TextInput
                  accessibilityLabel={kind === 'bug' ? 'Bug description' : 'Feedback description'}
                  maxLength={2000}
                  multiline
                  textAlignVertical="top"
                  value={message}
                  onChangeText={setMessage}
                  placeholder={
                    kind === 'bug'
                      ? 'Tell us what you were doing, what you expected, and what happened instead.'
                      : 'Describe the improvement and how it would help.'
                  }
                  placeholderTextColor={theme.textDim}
                  style={styles.messageInput}
                />
                <Text style={styles.counter}>{message.length}/2000</Text>
              </View>

              <View style={styles.diagnostics}>
                <View style={styles.diagnosticsHeading}>
                  <Text style={styles.diagnosticsTitle}>Diagnostics included</Text>
                  <Text style={styles.diagnosticsBadge}>Automatic</Text>
                </View>
                <Text style={styles.diagnosticsText}>
                  {context.packName} {context.packVersion} · Minecraft {context.minecraftVersion}
                </Text>
                <Text style={styles.diagnosticsText}>
                  {context.activeTab} screen · UI {context.interfaceZoomPercent}% · Recipe/items{' '}
                  {context.contentZoomPercent}% · {runtime.viewport}
                </Text>
                <Text style={styles.diagnosticsNote}>
                  Includes dataset IDs, exporter time, item and recipe counts, browser, platform,
                  viewport, and the active graph item.
                </Text>
              </View>

              {submission.status === 'error' && (
                <Text style={styles.error} accessibilityRole="alert">
                  {submission.message}
                </Text>
              )}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Send report to GitHub"
                  disabled={!canSubmit}
                  onPress={() => void submit()}
                  style={[styles.submitButton, !canSubmit && styles.disabled]}>
                  {submission.status === 'submitting' ? (
                    <ActivityIndicator color={theme.bg} />
                  ) : (
                    <Text style={styles.submitButtonText}>Send to GitHub</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
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
    maxWidth: 560,
    maxHeight: '90%' as never,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 14,
    backgroundColor: theme.panel,
  },
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 19, fontWeight: '800'},
  subtitle: {marginTop: 3, color: theme.textDim, fontSize: 11, lineHeight: 16},
  closeButton: {padding: 6},
  closeText: {color: theme.textDim, fontSize: 15},
  scroll: {marginTop: 16},
  form: {gap: 14, paddingBottom: 2},
  kindToggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    backgroundColor: theme.panelAlt,
  },
  kindOption: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  kindOptionSelected: {backgroundColor: theme.radialRootPanel},
  kindText: {color: theme.textDim, fontSize: 12, fontWeight: '800'},
  kindTextSelected: {color: theme.radialRoot},
  field: {gap: 7},
  label: {color: theme.text, fontSize: 12, fontWeight: '800'},
  titleInput: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 9,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 15,
  },
  messageInput: {
    minHeight: 132,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 9,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
  },
  counter: {alignSelf: 'flex-end', color: theme.textDim, fontSize: 10},
  diagnostics: {
    gap: 5,
    padding: 11,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 9,
    backgroundColor: theme.panelAlt,
  },
  diagnosticsHeading: {flexDirection: 'row', alignItems: 'center', gap: 8},
  diagnosticsTitle: {flex: 1, color: theme.text, fontSize: 11, fontWeight: '800'},
  diagnosticsBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(88,196,123,0.14)',
    color: theme.accent,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  diagnosticsText: {color: theme.textDim, fontSize: 10, lineHeight: 14},
  diagnosticsNote: {marginTop: 3, color: theme.textDim, fontSize: 9, lineHeight: 13},
  error: {
    padding: 10,
    borderWidth: 1,
    borderColor: theme.danger,
    borderRadius: 8,
    color: theme.danger,
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
  secondaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 9,
    backgroundColor: theme.panelAlt,
  },
  secondaryButtonText: {color: theme.text, fontSize: 12, fontWeight: '800'},
  submitButton: {
    minWidth: 132,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: theme.accent,
  },
  submitButtonText: {color: theme.bg, fontSize: 12, fontWeight: '900'},
  disabled: {opacity: 0.42},
  success: {alignItems: 'center', paddingHorizontal: 8, paddingVertical: 34},
  successMark: {color: theme.accent, fontSize: 38, fontWeight: '900'},
  successTitle: {marginTop: 8, color: theme.text, fontSize: 20, fontWeight: '800'},
  successText: {
    maxWidth: 380,
    marginTop: 7,
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  successActions: {flexDirection: 'row', gap: 8, marginTop: 22},
});

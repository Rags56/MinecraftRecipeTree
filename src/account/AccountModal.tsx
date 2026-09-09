import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  type AccountSubscription,
  loadAccountSubscription,
  updateAccountSubscription,
} from '../data/accountSubscription';
import {theme} from '../theme';
import {type ThemePreference, useThemePreference} from '../ui/themePreference';
import {useUser} from './UserContext';

const THEME_CHOICES: Array<{value: ThemePreference; label: string}> = [
  {value: 'dark', label: 'Dark'},
  {value: 'light', label: 'Light'},
];

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);
}

function tierCents(value: string): number | null {
  if (!/^\d{1,4}(?:\.\d{0,2})?$/u.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 100 && cents <= 100_000 ? cents : null;
}

export function AccountModal({
  visible,
  interfaceZoom = 1,
  onClose,
  onOpenDonations,
}: {
  visible: boolean;
  interfaceZoom?: number;
  onClose(): void;
  onOpenDonations(): void;
}) {
  const account = useUser();
  const themePreference = useThemePreference();
  const [displayName, setDisplayName] = useState(account.user?.displayName ?? '');
  const [email, setEmail] = useState(account.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [subscription, setSubscription] = useState<AccountSubscription | null>(null);
  const [tierAmount, setTierAmount] = useState('');
  const [reviewedTier, setReviewedTier] = useState<number | null>(null);
  const [loadingTier, setLoadingTier] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);

  const refreshSubscription = useCallback(() => {
    setSubscription(null);
    setTierAmount('');
    setTierError(null);
    setLoadingTier(true);
    void loadAccountSubscription()
      .then(value => {
        setSubscription(value);
        setTierAmount(value ? (value.amountCents / 100).toFixed(2) : '');
      })
      .catch(cause => {
        console.error('Monthly donation tier could not be loaded.', cause);
        setTierError(cause instanceof Error ? cause.message : 'Monthly donation tier could not be loaded.');
      })
      .finally(() => setLoadingTier(false));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setDisplayName(account.user?.displayName ?? '');
    setEmail(account.user?.email ?? '');
    setPassword('');
    setMessage(null);
    setError(null);
    setConfirmDelete(false);
    setEditingDetails(false);
    setReviewedTier(null);
    refreshSubscription();
  }, [refreshSubscription, visible]);

  const scaledCardStyle = Platform.OS === 'web'
    ? ({zoom: interfaceZoom, width: `${100 / interfaceZoom}%`, maxWidth: 620 / interfaceZoom} as object)
    : null;
  const nextTierCents = useMemo(() => tierCents(tierAmount), [tierAmount]);
  const closeDetailsEditor = () => {
    setEditingDetails(false);
    setDisplayName(account.user?.displayName ?? '');
    setEmail(account.user?.email ?? '');
    setPassword('');
  };

  const run = (name: string, operation: () => Promise<void>) => {
    if (pending) return;
    setPending(name);
    setMessage(null);
    setError(null);
    void operation()
      .catch(cause => {
        console.error(`Account ${name} failed.`, cause);
        setError(cause instanceof Error ? cause.message : 'Account request failed.');
      })
      .finally(() => setPending(null));
  };

  if (!account.user) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable accessibilityViewIsModal style={[styles.card, scaledCardStyle]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Account</Text>
              <Text style={styles.subtitle}>Signed in as {account.user.displayName}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close account settings" style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.section}>
              <View style={styles.sectionHeadingRow}>
                <View style={styles.sectionHeadingCopy}>
                  <Text style={styles.sectionTitle}>Account details</Text>
                  <Text style={styles.accountSummaryName}>{account.user.displayName}</Text>
                  <Text style={styles.accountSummaryEmail}>{account.user.email || 'No email address'}</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{expanded: editingDetails}}
                  style={styles.editButton}
                  onPress={() => editingDetails ? closeDetailsEditor() : setEditingDetails(true)}>
                  <Text style={styles.buttonText}>{editingDetails ? 'Done' : 'Edit'}</Text>
                </TouchableOpacity>
              </View>

              {editingDetails && (
                <View style={styles.detailsEditor}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Username</Text>
                    <View style={styles.fieldActionRow}>
                      <TextInput
                        accessibilityLabel="Username"
                        autoCapitalize="words"
                        autoComplete="name"
                        maxLength={32}
                        placeholder="Username"
                        placeholderTextColor={theme.textDim}
                        style={styles.compactInput}
                        value={displayName}
                        onChangeText={setDisplayName}
                      />
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={
                          displayName.trim().length < 2 ||
                          displayName.trim() === account.user.displayName ||
                          !!pending
                        }
                        style={[
                          styles.compactButton,
                          (displayName.trim().length < 2 ||
                            displayName.trim() === account.user.displayName ||
                            !!pending) && styles.disabled,
                        ]}
                        onPress={() => run('username change', async () => {
                          await account.updateDisplayName(displayName);
                          setMessage('Username updated.');
                        })}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.fieldHint}>Shown in the header and synced across devices.</Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Email</Text>
                    <View style={styles.fieldActionRow}>
                      <TextInput
                        accessibilityLabel="New email address"
                        autoCapitalize="none"
                        autoComplete="email"
                        keyboardType="email-address"
                        placeholder="Email address"
                        placeholderTextColor={theme.textDim}
                        style={styles.compactInput}
                        value={email}
                        onChangeText={setEmail}
                      />
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={!email.trim() || email.trim().toLowerCase() === account.user.email?.toLowerCase() || !!pending}
                        style={[
                          styles.compactButton,
                          (!email.trim() || email.trim().toLowerCase() === account.user.email?.toLowerCase() || !!pending) && styles.disabled,
                        ]}
                        onPress={() => run('email change', async () => {
                          await account.updateEmail(email);
                          setMessage('Check your email to confirm the address change.');
                        })}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <View style={styles.fieldActionRow}>
                      <TextInput
                        accessibilityLabel="New password"
                        autoCapitalize="none"
                        autoComplete="new-password"
                        placeholder="New password (8+ characters)"
                        placeholderTextColor={theme.textDim}
                        secureTextEntry
                        style={styles.compactInput}
                        value={password}
                        onChangeText={setPassword}
                      />
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={password.length < 8 || !!pending}
                        style={[styles.compactButton, (password.length < 8 || !!pending) && styles.disabled]}
                        onPress={() => run('password change', async () => {
                          await account.updatePassword(password);
                          setPassword('');
                          setMessage('Password updated.');
                        })}>
                        <Text style={styles.buttonText}>Update</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Appearance</Text>
              <View accessibilityRole="radiogroup" style={styles.themePicker}>
                {THEME_CHOICES.map(choice => {
                  const selected = choice.value === themePreference.preference;
                  return (
                    <TouchableOpacity
                      key={choice.value}
                      accessibilityRole="radio"
                      accessibilityState={{checked: selected}}
                      style={[styles.themeChoice, selected && styles.themeChoiceSelected]}
                      onPress={() => themePreference.setPreference(choice.value)}>
                      <Text style={[styles.themeChoiceText, selected && styles.themeChoiceTextSelected]}>
                        {choice.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                accessibilityRole="switch"
                accessibilityState={{checked: themePreference.minecraftFont}}
                accessibilityLabel="Use Minecraft font"
                style={styles.fontToggleRow}
                onPress={() => themePreference.setMinecraftFont(!themePreference.minecraftFont)}>
                <View style={styles.fontToggleCopy}>
                  <Text style={styles.fontToggleTitle}>Minecraft font</Text>
                  <Text style={styles.fieldHint}>Use Monocraft throughout the interface.</Text>
                </View>
                <View style={[styles.toggleTrack, themePreference.minecraftFont && styles.toggleTrackActive]}>
                  <View style={[styles.toggleThumb, themePreference.minecraftFont && styles.toggleThumbActive]} />
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Monthly donation tier</Text>
              {loadingTier ? (
                <ActivityIndicator color={theme.accent} />
              ) : tierError ? (
                <>
                  <Text accessibilityRole="alert" style={styles.error}>{tierError}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.button}
                    onPress={refreshSubscription}>
                    <Text style={styles.buttonText}>Retry</Text>
                  </TouchableOpacity>
                </>
              ) : subscription ? (
                <>
                  <Text style={styles.helpText}>
                    Current tier: {money(subscription.amountCents)}/month · next renewal {new Date(subscription.nextBillingAt).toLocaleDateString()}
                  </Text>
                  <TextInput
                    accessibilityLabel="New monthly donation amount"
                    keyboardType="decimal-pad"
                    placeholder="Monthly amount in USD"
                    placeholderTextColor={theme.textDim}
                    style={styles.input}
                    value={tierAmount}
                    onChangeText={value => {
                      setTierAmount(value);
                      setReviewedTier(null);
                    }}
                  />
                  {reviewedTier === null ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={!nextTierCents || nextTierCents === subscription.amountCents || !!pending}
                      style={styles.button}
                      onPress={() => setReviewedTier(nextTierCents)}>
                      <Text style={styles.buttonText}>Review tier change</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.review}>
                      <Text style={styles.reviewText}>
                        Change the next renewal to {money(reviewedTier)}/month? There is no immediate charge.
                      </Text>
                      <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.button} onPress={() => setReviewedTier(null)}>
                          <Text style={styles.buttonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.button, styles.primaryButton]}
                          onPress={() => run('tier change', async () => {
                            const updated = await updateAccountSubscription(reviewedTier);
                            setSubscription(updated);
                            setTierAmount((updated.amountCents / 100).toFixed(2));
                            setReviewedTier(null);
                            setMessage('Monthly donation tier updated for the next renewal.');
                          })}>
                          <Text style={styles.primaryButtonText}>Confirm change</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.helpText}>No active monthly donation tier is linked to this account.</Text>
                  <TouchableOpacity
                    accessibilityRole="link"
                    accessibilityLabel="Open the Recipe Tree donation page"
                    style={[styles.button, styles.primaryButton]}
                    onPress={onOpenDonations}>
                    <Text style={styles.primaryButtonText}>Open donation page</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {pending && <ActivityIndicator color={theme.accent} />}
            {message && <Text accessibilityRole="alert" style={styles.success}>{message}</Text>}
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

            <View style={styles.actionRow}>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.button}
                onPress={() => run('sign out', async () => {
                  await account.signOut();
                  onClose();
                })}>
                <Text style={styles.buttonText}>Sign out</Text>
              </TouchableOpacity>
              {!confirmDelete ? (
                <TouchableOpacity accessibilityRole="button" style={[styles.button, styles.dangerButton]} onPress={() => setConfirmDelete(true)}>
                  <Text style={styles.dangerText}>Delete account</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.deleteConfirm}>
                  <Text style={styles.helpText}>This permanently deletes the account and synced favorites.</Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.button} onPress={() => setConfirmDelete(false)}>
                      <Text style={styles.buttonText}>Keep account</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.dangerButton]}
                      onPress={() => run('deletion', async () => {
                        await account.deleteAccount();
                        onClose();
                      })}>
                      <Text style={styles.dangerText}>Delete my account</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.72)'},
  card: {width: '100%', maxWidth: 620, maxHeight: '90%', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.panel},
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 18, fontWeight: '800'},
  subtitle: {color: theme.accent, fontSize: 11, marginTop: 3},
  closeButton: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 16},
  content: {gap: 10, paddingTop: 12, paddingBottom: 2},
  section: {gap: 8, padding: 10, borderRadius: 9, backgroundColor: theme.panelAlt},
  sectionTitle: {color: theme.text, fontSize: 12, fontWeight: '800'},
  sectionHeadingRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  sectionHeadingCopy: {flex: 1, minWidth: 0},
  accountSummaryName: {marginTop: 5, color: theme.text, fontSize: 14, fontWeight: '800'},
  accountSummaryEmail: {marginTop: 1, color: theme.textDim, fontSize: 11},
  editButton: {minWidth: 62, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight},
  detailsEditor: {gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border},
  fieldGroup: {gap: 5},
  fieldLabel: {color: theme.text, fontSize: 11, fontWeight: '800'},
  fieldActionRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  compactInput: {height: 34, minWidth: 0, flex: 1, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight, color: theme.text, backgroundColor: theme.panel, fontSize: 12},
  compactButton: {minWidth: 72, height: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight},
  fieldHint: {color: theme.textDim, fontSize: 10, lineHeight: 14},
  helpText: {color: theme.textDim, fontSize: 11, lineHeight: 16},
  themePicker: {flexDirection: 'row', padding: 3, gap: 3, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg},
  themeChoice: {minHeight: 32, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: 'transparent'},
  themeChoiceSelected: {borderColor: theme.accent, backgroundColor: theme.panel},
  themeChoiceText: {color: theme.textDim, fontSize: 12, fontWeight: '700'},
  themeChoiceTextSelected: {color: theme.accent},
  fontToggleRow: {minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2},
  fontToggleCopy: {flex: 1, minWidth: 0},
  fontToggleTitle: {color: theme.text, fontSize: 12, fontWeight: '800'},
  toggleTrack: {width: 38, height: 22, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 11, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.bg},
  toggleTrackActive: {borderColor: theme.accent, backgroundColor: 'rgba(88,196,123,0.18)'},
  toggleThumb: {width: 14, height: 14, borderRadius: 7, backgroundColor: theme.textDim},
  toggleThumbActive: {alignSelf: 'flex-end', backgroundColor: theme.accent},
  input: {minHeight: 40, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight, color: theme.text, backgroundColor: theme.panel},
  button: {minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight},
  buttonText: {color: theme.text, fontSize: 12, fontWeight: '700'},
  primaryButton: {borderColor: theme.accent, backgroundColor: theme.accent},
  primaryButtonText: {color: theme.bg, fontSize: 12, fontWeight: '800'},
  review: {gap: 8, padding: 10, borderRadius: 7, borderWidth: 1, borderColor: theme.accent},
  reviewText: {color: theme.text, fontSize: 11, lineHeight: 16},
  actionRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8},
  deleteConfirm: {flex: 1, minWidth: 260, gap: 8},
  dangerButton: {borderColor: theme.danger},
  dangerText: {color: theme.danger, fontSize: 12, fontWeight: '800'},
  success: {color: theme.accent, fontSize: 11, textAlign: 'center'},
  error: {color: theme.danger, fontSize: 11, textAlign: 'center'},
  disabled: {opacity: 0.42},
});

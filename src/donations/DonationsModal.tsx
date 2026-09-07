import {Modal} from '../ui/nativeUiScale';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
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
import {useUser} from '../account/UserContext';
import {
  createDonationCheckout,
  type DonationLeaderboardEntry,
  type DonationMark,
  type DonationStatus,
  loadDonationStatus,
} from '../data/donations';
import {theme} from '../theme';

const PRESETS = [5, 10, 25, 50] as const;
const LEADERBOARD_ROW_HEIGHT = 46;
const METER_TRACK_HEIGHT = 300;
const MILESTONE_STORAGE_PREFIX = 'mrt-donation-milestone:';
const SERVICE_REASON: Record<DonationMark['id'], string> = {
  'github-actions': 'Automated updates',
  cloudflare: 'Hosting & storage',
  supabase: 'Accounts & sync',
};
const CONFETTI = Array.from({length: 26}, (_, index) => ({
  id: index,
  left: (index * 37) % 100,
  drift: ((index * 29) % 90) - 45,
  delay: (index % 7) * 45,
  color: [theme.accent, theme.accentAlt, theme.warn, theme.radialRoot][index % 4],
}));

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);
}

function tier(cents: number): string {
  if (cents >= 10_000) return 'Nether Star';
  if (cents >= 5_000) return 'Emerald';
  if (cents >= 2_500) return 'Diamond';
  if (cents >= 1_000) return 'Gold';
  return 'Supporter';
}

function milestone(status: Extract<DonationStatus, {enabled: true}>): number {
  let reached = -1;
  status.marks.forEach((mark, index) => {
    if (status.totalCents >= mark.cumulativeCents) reached = index;
  });
  return reached;
}

function milestoneKey(weekStart: number): string {
  return `${MILESTONE_STORAGE_PREFIX}${weekStart}`;
}

function saveMilestone(status: Extract<DonationStatus, {enabled: true}>): void {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(milestoneKey(status.month.startsAt), String(milestone(status)));
  } catch (error) {
    console.error('Donation milestone could not be saved.', error);
  }
}

function priorMilestone(status: Extract<DonationStatus, {enabled: true}>): number | null {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(milestoneKey(status.month.startsAt));
    return value !== null && /^-?\d+$/u.test(value) ? Number(value) : null;
  } catch (error) {
    console.error('Donation milestone could not be read.', error);
    return null;
  }
}

function ConfettiBurst({burst}: {burst: number}) {
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (burst <= 0) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 1700,
      useNativeDriver: true,
    }).start();
  }, [burst, progress]);
  if (burst <= 0) return null;
  return (
    <View pointerEvents="none" style={styles.confettiLayer} accessibilityElementsHidden>
      {CONFETTI.map(particle => (
        <Animated.View
          key={`${burst}:${particle.id}`}
          style={[
            styles.confettiParticle,
            {
              left: `${particle.left}%`,
              backgroundColor: particle.color,
              opacity: progress.interpolate({inputRange: [0, 0.75, 1], outputRange: [0, 1, 0]}),
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20 - particle.delay / 12, 310],
                  }),
                },
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, particle.drift],
                  }),
                },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${360 + particle.id * 31}deg`],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function AnimatedLeaderboard({entries}: {entries: DonationLeaderboardEntry[]}) {
  const positions = useRef(new Map<string, Animated.Value>()).current;
  for (const [index, entry] of entries.entries()) {
    if (!positions.has(entry.donorKey)) positions.set(entry.donorKey, new Animated.Value(index + 1));
  }
  useEffect(() => {
    entries.forEach((entry, index) => {
      const value = positions.get(entry.donorKey);
      if (!value) return;
      Animated.spring(value, {
        toValue: index,
        damping: 22,
        stiffness: 190,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    });
  }, [entries, positions]);
  return (
    <View style={[styles.leaderboard, {height: entries.length * LEADERBOARD_ROW_HEIGHT}]}>
      {entries.map((entry, index) => {
        const position = positions.get(entry.donorKey) ?? new Animated.Value(index);
        return (
          <Animated.View
            key={entry.donorKey}
            style={[
              styles.leaderboardRow,
              {transform: [{translateY: Animated.multiply(position, LEADERBOARD_ROW_HEIGHT)}]},
            ]}>
            <Text style={styles.rank}>{index + 1}</Text>
            <View style={styles.donorCopy}>
              <Text style={styles.donorName} numberOfLines={1}>{entry.displayName}</Text>
              <Text style={styles.donorTier}>{tier(entry.totalCents)}</Text>
            </View>
            <Text style={styles.donorAmount}>{dollars(entry.totalCents)}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

export function DonationsModal({
  visible,
  interfaceZoom = 1,
  checkoutOutcome,
  onClose,
}: {
  visible: boolean;
  interfaceZoom?: number;
  checkoutOutcome: 'success' | 'canceled' | null;
  onClose(): void;
}) {
  const account = useUser();
  const [status, setStatus] = useState<DonationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<'one_time' | 'monthly'>('one_time');
  const [amount, setAmount] = useState('10');
  const [showName, setShowName] = useState(true);
  const [publicName, setPublicName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [burst, setBurst] = useState(0);
  const outcomeHandled = useRef(false);
  const cadencePosition = useRef(new Animated.Value(0)).current;

  const refresh = async () => {
    try {
      const next = await loadDonationStatus();
      setStatus(next);
      setError(null);
      if (next.enabled && checkoutOutcome === 'success' && !outcomeHandled.current) {
        const prior = priorMilestone(next);
        const current = milestone(next);
        if (prior !== null && current > prior) {
          setBurst(value => value + 1);
          outcomeHandled.current = true;
          saveMilestone(next);
        }
      }
    } catch (cause) {
      console.error('Donation status could not be loaded.', cause);
      setError(cause instanceof Error ? cause.message : 'Donation status could not be loaded.');
    }
  };

  useEffect(() => {
    if (!visible) return;
    outcomeHandled.current = checkoutOutcome !== 'success';
    setShowName(true);
    setLoading(true);
    setPublicName(account.user?.displayName ?? '');
    void refresh().finally(() => setLoading(false));
    const interval = setInterval(() => void refresh(), checkoutOutcome === 'success' ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [account.user?.displayName, checkoutOutcome, visible]);

  useEffect(() => {
    Animated.timing(cadencePosition, {
      toValue: cadence === 'monthly' ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [cadence, cadencePosition]);

  const amountCents = useMemo(() => {
    if (!/^\d{1,4}(?:\.\d{0,2})?$/u.test(amount)) return null;
    const cents = Math.round(Number(amount) * 100);
    return Number.isSafeInteger(cents) && cents >= 100 && cents <= 100_000 ? cents : null;
  }, [amount]);
  const enabled = status?.enabled === true;
  const canDonate = enabled && amountCents !== null && (!showName || publicName.trim().length > 0) && !submitting;
  const scaledCardStyle = Platform.OS === 'web'
    ? ({zoom: interfaceZoom, width: '100%', maxWidth: 740 / interfaceZoom} as object)
    : null;

  const togglePublicName = () => {
    setShowName(value => {
      const next = !value;
      if (next && !publicName.trim() && account.user?.displayName) {
        setPublicName(account.user.displayName);
      }
      return next;
    });
  };

  const donate = async () => {
    if (!canDonate || amountCents === null || !status?.enabled) return;
    setSubmitting(true);
    setError(null);
    saveMilestone(status);
    try {
      const checkoutUrl = await createDonationCheckout({
        amountCents,
        cadence,
        publicName: showName ? publicName.trim() : null,
      });
      await Linking.openURL(checkoutUrl);
    } catch (cause) {
      console.error('Stripe Checkout could not be opened.', cause);
      setError(cause instanceof Error ? cause.message : 'Stripe Checkout could not be opened.');
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, scaledCardStyle]} onPress={() => {}}>
          <ConfettiBurst burst={burst} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Support Recipe Tree</Text>
              <Text style={styles.subtitle}>Fund the services that keep recipes available</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close donations" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {checkoutOutcome === 'success' && (
              <Text style={styles.successMessage}>Thank you! Stripe is confirming your contribution.</Text>
            )}
            {checkoutOutcome === 'canceled' && (
              <Text style={styles.canceledMessage}>Checkout was canceled. Nothing was charged.</Text>
            )}
            {account.user && (
              <View style={styles.accountBanner}>
                <View style={styles.accountCopy}>
                  <Text style={styles.accountLabel}>Logged in as</Text>
                  <Text style={styles.accountName} numberOfLines={1}>{account.user.displayName}</Text>
                </View>
                {account.user.provider === 'discord' && <Text style={styles.providerBadge}>Discord</Text>}
              </View>
            )}
            {loading && !status ? <ActivityIndicator color={theme.accent} /> : enabled && status ? (
              <>
                <View style={styles.supportGrid}>
                  <View style={styles.meterPanel}>
                    <View style={styles.meterHeading}>
                      <Text style={styles.sectionTitle}>This month</Text>
                      <Text style={styles.meterAmount}>{dollars(status.totalCents)} / {dollars(status.goalCents)}</Text>
                    </View>
                    <View style={styles.verticalMeter} accessibilityRole="progressbar" accessibilityValue={{min: 0, max: status.goalCents, now: Math.min(status.totalCents, status.goalCents)}}>
                      <View style={styles.verticalTrack}>
                        <View style={[styles.verticalFill, {height: `${Math.min(100, status.totalCents / status.goalCents * 100)}%`}]} />
                      </View>
                      {status.marks.map(mark => {
                        const level = Math.min(90, Math.max(4, mark.cumulativeCents / status.goalCents * 100));
                        return (
                          <View key={mark.id} style={[styles.meterLevel, {bottom: `${level}%`}]}>
                            <View style={[styles.levelDot, status.totalCents >= mark.cumulativeCents && styles.levelDotReached]} />
                            <View style={styles.levelCopy}>
                              <Text style={styles.levelName}>{status.totalCents >= mark.cumulativeCents ? '✓ ' : ''}{mark.label}</Text>
                              <Text style={styles.levelAmount}>
                                {dollars(mark.monthlyCents)} / month · {SERVICE_REASON[mark.id]}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.donationForm}>
                    <View style={styles.segmented} accessibilityRole="tablist">
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.segmentIndicator,
                          {left: cadencePosition.interpolate({inputRange: [0, 1], outputRange: ['1%', '50%']})},
                        ]}
                      />
                      {(['one_time', 'monthly'] as const).map(option => (
                        <TouchableOpacity key={option} onPress={() => setCadence(option)} style={styles.segment} accessibilityRole="tab" accessibilityState={{selected: cadence === option}}>
                          <Text style={[styles.segmentText, cadence === option && styles.segmentTextActive]}>{option === 'one_time' ? 'One time' : 'Monthly'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.presets}>
                      {PRESETS.map(value => (
                        <TouchableOpacity key={value} onPress={() => setAmount(String(value))} style={[styles.preset, amount === String(value) && styles.presetActive]}>
                          <Text style={[styles.presetText, amount === String(value) && styles.presetTextActive]}>${value}</Text>
                        </TouchableOpacity>
                      ))}
                      <View style={styles.amountField}>
                        <Text style={styles.currencyPrefix}>$</Text>
                        <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel="Donation amount in US dollars" style={styles.amountInput} />
                      </View>
                    </View>
                    <TouchableOpacity style={styles.nameToggle} onPress={togglePublicName} accessibilityRole="checkbox" accessibilityState={{checked: showName}}>
                      <View style={[styles.checkbox, showName && styles.checkboxChecked]}><Text style={styles.checkmark}>{showName ? '✓' : ''}</Text></View>
                      <Text style={styles.nameToggleText}>Show my name on the donor list</Text>
                    </TouchableOpacity>
                    {showName && (
                      <View style={styles.nameFieldGroup}>
                        <Text style={styles.fieldLabel}>Donation name</Text>
                        <TextInput value={publicName} onChangeText={setPublicName} maxLength={60} accessibilityLabel="Public donor name" placeholder="Name shown publicly" placeholderTextColor={theme.textDim} style={styles.nameInput} />
                      </View>
                    )}
                    <TouchableOpacity disabled={!canDonate} onPress={() => void donate()} style={[styles.donateButton, !canDonate && styles.disabled]}>
                      {submitting ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.donateButtonText}>Donate</Text>}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.leaderboardHeading}>
                  <Text style={styles.sectionTitle}>Monthly donor tiers</Text>
                </View>
                <View style={styles.anonymousCard}>
                  <View>
                    <Text style={styles.anonymousTitle}>Anonymous support</Text>
                    <Text style={styles.anonymousCount}>{status.anonymous.donorCount} donor{status.anonymous.donorCount === 1 ? '' : 's'} this month</Text>
                  </View>
                  <Text style={styles.anonymousAmount}>{dollars(status.anonymous.totalCents)}</Text>
                </View>
                {status.leaderboard.length > 0 && (
                  <AnimatedLeaderboard entries={status.leaderboard} />
                )}
              </>
            ) : (
              <Text style={styles.emptyText}>{status?.enabled === false ? status.error : 'Donation status is unavailable.'}</Text>
            )}
            {error && <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.72)'},
  card: {width: '100%', maxHeight: '86%', overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.panel},
  header: {minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: theme.border},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 18, fontWeight: '800'},
  subtitle: {marginTop: 3, color: theme.textDim, fontSize: 12},
  closeButton: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 16},
  scroll: {minHeight: 0},
  content: {padding: 14, paddingBottom: 16},
  successMessage: {marginBottom: 12, padding: 11, borderRadius: 7, color: theme.accent, backgroundColor: 'rgba(88,196,123,0.11)', fontSize: 13, fontWeight: '700'},
  canceledMessage: {marginBottom: 12, padding: 11, borderRadius: 7, color: theme.textDim, backgroundColor: theme.panelAlt, fontSize: 13},
  accountBanner: {marginBottom: 12, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panelAlt},
  accountCopy: {flex: 1, minWidth: 0},
  accountLabel: {color: theme.textDim, fontSize: 12, fontWeight: '600'},
  accountName: {marginTop: 2, color: theme.text, fontSize: 15, fontWeight: '800'},
  providerBadge: {paddingHorizontal: 9, paddingVertical: 5, overflow: 'hidden', borderRadius: 999, color: theme.accentAlt, backgroundColor: 'rgba(126,97,255,0.14)', fontSize: 12, fontWeight: '800'},
  supportGrid: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 14},
  meterPanel: {width: 210, minHeight: 373, padding: 12, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panelAlt},
  meterHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sectionTitle: {color: theme.text, fontSize: 14, fontWeight: '800'},
  meterAmount: {color: theme.accent, fontSize: 14, fontWeight: '800'},
  verticalMeter: {position: 'relative', height: METER_TRACK_HEIGHT, marginTop: 13},
  verticalTrack: {position: 'absolute', top: 0, bottom: 0, left: 5, width: 16, overflow: 'hidden', borderRadius: 8, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.bg},
  verticalFill: {position: 'absolute', right: 0, bottom: 0, left: 0, minHeight: 2, backgroundColor: theme.accent},
  meterLevel: {position: 'absolute', right: 0, left: 0, height: 3, flexDirection: 'row', alignItems: 'center'},
  levelDot: {width: 26, height: 3, borderRadius: 2, backgroundColor: theme.borderLight},
  levelDotReached: {backgroundColor: theme.accent},
  levelCopy: {flex: 1, minWidth: 0, marginLeft: 9, paddingVertical: 3, backgroundColor: theme.panelAlt},
  levelName: {color: theme.text, fontSize: 13, fontWeight: '800'},
  levelAmount: {marginTop: 1, color: theme.textDim, fontSize: 12},
  donationForm: {minWidth: 0, flexBasis: 250, flexGrow: 1, flexShrink: 1, padding: 12, gap: 10, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panelAlt},
  segmented: {position: 'relative', minHeight: 42, flexDirection: 'row', padding: 3, overflow: 'hidden', borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg},
  segmentIndicator: {position: 'absolute', top: 3, bottom: 3, width: '49%', borderRadius: 6, borderWidth: 1, borderColor: theme.accent, backgroundColor: 'rgba(88,196,123,0.15)'},
  segment: {zIndex: 1, flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center'},
  segmentText: {color: theme.textDim, fontSize: 13, fontWeight: '700'},
  segmentTextActive: {color: theme.accent},
  presets: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  preset: {minWidth: 48, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: theme.border},
  presetActive: {borderColor: theme.accent},
  presetText: {color: theme.textDim, fontSize: 13, fontWeight: '700'},
  presetTextActive: {color: theme.accent},
  amountField: {height: 38, minWidth: 82, flexDirection: 'row', alignItems: 'center', borderRadius: 7, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg},
  currencyPrefix: {paddingLeft: 9, color: theme.textDim, fontSize: 14},
  amountInput: {flex: 1, height: 36, paddingHorizontal: 5, color: theme.text, fontSize: 14},
  nameToggle: {minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 9},
  checkbox: {width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: theme.borderLight},
  checkboxChecked: {borderColor: theme.accent, backgroundColor: 'rgba(88,196,123,0.15)'},
  checkmark: {color: theme.accent, fontSize: 13, fontWeight: '900'},
  nameToggleText: {flex: 1, color: theme.text, fontSize: 13},
  nameFieldGroup: {gap: 6},
  fieldLabel: {color: theme.text, fontSize: 12, fontWeight: '700'},
  nameInput: {height: 40, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight, color: theme.text, backgroundColor: theme.bg, fontSize: 13},
  donateButton: {minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: theme.accent},
  donateButtonText: {color: theme.bg, fontSize: 14, fontWeight: '900'},
  disabled: {opacity: 0.4},
  leaderboardHeading: {marginTop: 14},
  anonymousCard: {marginTop: 8, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panelAlt},
  anonymousTitle: {color: theme.text, fontSize: 14, fontWeight: '800'},
  anonymousCount: {marginTop: 2, color: theme.textDim, fontSize: 12},
  anonymousAmount: {color: theme.accent, fontSize: 18, fontWeight: '900'},
  leaderboard: {position: 'relative', marginTop: 10, overflow: 'hidden'},
  leaderboardRow: {position: 'absolute', top: 0, right: 0, left: 0, height: LEADERBOARD_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border},
  rank: {width: 30, color: theme.textDim, fontSize: 12, fontWeight: '800'},
  donorCopy: {flex: 1, minWidth: 0},
  donorName: {color: theme.text, fontSize: 13, fontWeight: '700'},
  donorTier: {marginTop: 1, color: theme.accentAlt, fontSize: 11, fontWeight: '700', textTransform: 'uppercase'},
  donorAmount: {color: theme.accent, fontSize: 13, fontWeight: '800'},
  emptyText: {marginTop: 14, color: theme.textDim, fontSize: 13, textAlign: 'center'},
  errorText: {marginTop: 10, color: theme.danger, fontSize: 12, textAlign: 'center'},
  confettiLayer: {position: 'absolute', zIndex: 10, top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden'},
  confettiParticle: {position: 'absolute', top: 0, width: 8, height: 12, borderRadius: 1},
});

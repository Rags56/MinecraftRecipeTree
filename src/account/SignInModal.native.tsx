import {NativeUiScale} from '../ui/nativeUiScale';
import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from '../ui/safeArea';
import {theme} from '../theme';
import {useUser} from './UserContext';
import {DiscordIcon} from '../components/DiscordIcon';

export function SignInModal({visible, anchor, onClose}: {
  visible: boolean;
  interfaceZoom?: number;
  anchor?: {x: number; y: number; width: number; height: number};
  onClose(): void;
}) {
  const account = useUser();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {if (account.user) onClose();}, [account.user, onClose]);
  useEffect(() => {
    if (visible && !anchor) console.error('Sign-in popover cannot open without its header anchor.');
  }, [visible, anchor]);
  if (!anchor) return null;

  const cardWidth = Math.min(360, width - insets.left - insets.right - 24);
  const left = Math.max(insets.left + 12, Math.min(anchor.x + anchor.width - cardWidth, width - insets.right - cardWidth - 12));
  const top = Math.max(insets.top + 12, anchor.y + anchor.height + 12);
  const arrowLeft = Math.max(20, Math.min(cardWidth - 32, anchor.x + anchor.width / 2 - left - 6));
  const startSignIn = () => {
    if (pending) return;
    setPending(true);
    setError(null);
    void account.signInWithDiscord().catch(cause => {
      console.error('Native Discord sign-in failed.', cause);
      setError(cause instanceof Error ? cause.message : 'Sign-in could not be completed.');
    }).finally(() => setPending(false));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss sign in" />
        <View style={[styles.card, {left, top, width: cardWidth}]} accessibilityViewIsModal>
          <View pointerEvents="none" style={[styles.arrow, {left: arrowLeft}]} />
          <ScrollView style={{maxHeight: Math.max(100, height - top - insets.bottom - 12)}} contentContainerStyle={styles.content} bounces={false}>
            <NativeUiScale>
            <View style={{gap: 14}}>
            <View style={styles.header}>
              <View style={styles.heading}>
                <Text style={styles.title} accessibilityRole="header">Your recipe library</Text>
                <Text style={styles.subtitle}>Sign in to Recipe Tree</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close sign in">
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.detail}>Sync favorites and keep downloaded packs in your account’s library on this iPhone.</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{disabled: pending, busy: pending}} disabled={pending} style={[styles.discordButton, pending && styles.pending]} onPress={startSignIn}>
              {pending ? <ActivityIndicator color="#fff" /> : <DiscordIcon size={20} />}
              <Text style={styles.discordLabel}>{pending ? 'Signing in…' : 'Continue with Discord'}</Text>
            </TouchableOpacity>
            {(error || account.error) && <Text style={styles.error} accessibilityRole="alert">{error ?? account.error}</Text>}
            <Text style={styles.footnote}>Discord opens in the iOS sign-in browser. Recipe Tree never receives your Discord password.</Text>
            </View></NativeUiScale>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.3)'},
  card: {position: 'absolute', borderRadius: 12, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.panelAlt, shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 16, shadowOffset: {width: 0, height: 8}},
  arrow: {position: 'absolute', top: -7, width: 12, height: 12, transform: [{rotate: '45deg'}], borderLeftWidth: 1, borderTopWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.panelAlt},
  content: {padding: 16, gap: 14},
  header: {flexDirection: 'row', alignItems: 'center', gap: 8},
  heading: {flex: 1},
  title: {color: theme.text, fontSize: 20, fontWeight: '800'},
  subtitle: {color: theme.accent, fontSize: 12, marginTop: 4},
  close: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 18},
  detail: {color: theme.textDim, fontSize: 14, lineHeight: 20},
  discordButton: {minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 8, backgroundColor: '#5865f2'},
  discordLabel: {color: '#fff', fontSize: 15, fontWeight: '700'},
  pending: {opacity: 0.7},
  footnote: {color: theme.textDim, fontSize: 12, lineHeight: 18},
  error: {color: theme.danger, fontSize: 13, lineHeight: 19},
});

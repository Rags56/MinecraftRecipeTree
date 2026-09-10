import {Modal} from '../ui/nativeUiScale';
import React, {useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {DiscordIcon} from '../components/DiscordIcon';
import {theme} from '../theme';
import {useUser} from './UserContext';

export function SignInModal({
  visible,
  interfaceZoom = 1,
  onClose,
}: {
  visible: boolean;
  interfaceZoom?: number;
  anchor?: {x: number; y: number; width: number; height: number};
  onClose(): void;
}) {
  const account = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailReady = email.trim().length > 0;
  const passwordReady = password.length >= 8;
  const scaledCardStyle = Platform.OS === 'web'
    ? ({zoom: interfaceZoom, width: `${100 / interfaceZoom}%`, maxWidth: 480 / interfaceZoom} as object)
    : null;

  const start = (operation: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    void operation()
      .catch(cause => {
        console.error('Account sign-in request failed.', cause);
        setError(cause instanceof Error ? cause.message : 'Sign-in could not be completed.');
      })
      .finally(() => setPending(false));
  };

  const sendMagicLink = () => {
    if (!emailReady) return;
    setEmailSent(false);
    start(async () => {
      await account.sendMagicLink(email.trim());
      setEmailSent(true);
    });
  };

  const usePassword = (mode: 'sign_in' | 'sign_up') => {
    if (!emailReady || !passwordReady) return;
    start(async () => {
      if (mode === 'sign_in') {
        await account.signInWithPassword(email, password);
        onClose();
        return;
      }
      const result = await account.signUpWithPassword(email, password);
      if (result === 'confirmation_required') {
        setMessage('Check your email to confirm your new account.');
      } else {
        onClose();
      }
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable accessibilityViewIsModal style={[styles.card, scaledCardStyle]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Sign in</Text>
              <Text style={styles.subtitle}>Sync favorites across devices</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close sign in" style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={pending}
              style={styles.discordButton}
              onPress={() => start(() => account.signInWithDiscord())}>
              <DiscordIcon size={18} />
              <Text style={styles.discordButtonText}>Continue with Discord</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or use email</Text>
              <View style={styles.dividerLine} />
            </View>

            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email address"
              placeholderTextColor={theme.textDim}
              style={styles.input}
              value={email}
              onChangeText={value => {
                setEmail(value);
                setEmailSent(false);
                setMessage(null);
              }}
              onSubmitEditing={sendMagicLink}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{disabled: !emailReady || pending}}
              disabled={!emailReady || pending}
              style={[styles.button, (!emailReady || pending) && styles.buttonDisabled]}
              onPress={sendMagicLink}>
              <Text style={[styles.buttonText, (!emailReady || pending) && styles.buttonTextDisabled]}>
                Send me a Magic Link
              </Text>
            </TouchableOpacity>
            {emailSent && <Text accessibilityRole="alert" style={styles.success}>Check your email for a one-time sign-in link.</Text>}

            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Password (8+ characters)"
              placeholderTextColor={theme.textDim}
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={value => {
                setPassword(value);
                setMessage(null);
              }}
              onSubmitEditing={() => usePassword('sign_in')}
            />
            <View style={styles.passwordActions}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!emailReady || !passwordReady || pending}
                style={[styles.button, styles.passwordButton, (!emailReady || !passwordReady || pending) && styles.buttonDisabled]}
                onPress={() => usePassword('sign_in')}>
                <Text style={styles.buttonText}>Sign in</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!emailReady || !passwordReady || pending}
                style={[styles.button, styles.passwordButton, (!emailReady || !passwordReady || pending) && styles.buttonDisabled]}
                onPress={() => usePassword('sign_up')}>
                <Text style={styles.buttonText}>Create account</Text>
              </TouchableOpacity>
            </View>

            {pending && <ActivityIndicator color={theme.accent} />}
            {message && <Text accessibilityRole="alert" style={styles.success}>{message}</Text>}
            {(error || account.error) && <Text accessibilityRole="alert" style={styles.error}>{error ?? account.error}</Text>}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.72)'},
  card: {width: '100%', maxWidth: 480, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.borderLight, backgroundColor: theme.panel},
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  headerCopy: {flex: 1},
  title: {color: theme.text, fontSize: 18, fontWeight: '800'},
  subtitle: {color: theme.accent, fontSize: 11, marginTop: 3},
  closeButton: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  closeText: {color: theme.textDim, fontSize: 16},
  content: {gap: 8, marginTop: 14, padding: 10, borderRadius: 9, backgroundColor: theme.panelAlt},
  discordButton: {minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 13, borderRadius: 7, backgroundColor: '#5865F2'},
  discordButtonText: {color: '#FFFFFF', fontSize: 12, fontWeight: '800'},
  divider: {flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 2},
  dividerLine: {flex: 1, height: 1, backgroundColor: theme.border},
  dividerText: {color: theme.textDim, fontSize: 10},
  input: {minHeight: 40, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight, color: theme.text, backgroundColor: theme.panel},
  button: {minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, borderRadius: 7, borderWidth: 1, borderColor: theme.borderLight},
  buttonDisabled: {borderColor: theme.border, backgroundColor: theme.panel, opacity: 0.62},
  buttonText: {color: theme.text, fontSize: 12, fontWeight: '700'},
  buttonTextDisabled: {color: theme.textDim},
  passwordActions: {flexDirection: 'row', gap: 8},
  passwordButton: {flex: 1},
  success: {color: theme.accent, fontSize: 11, lineHeight: 16, textAlign: 'center'},
  error: {color: theme.danger, fontSize: 11, lineHeight: 16, textAlign: 'center'},
});

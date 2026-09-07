import type {SupabaseClient} from '@supabase/supabase-js';
import {openAuthSessionAsync} from 'expo-web-browser';
import {nativeAuthCode, NATIVE_AUTH_CALLBACK} from './nativeAuthCallback';
let signingIn = false;
export async function performDiscordSignIn(client: SupabaseClient, _redirectTo: string): Promise<void> {
  if (signingIn) throw new Error('Discord sign-in is already open.');
  signingIn = true;
  try {
    const {data, error} = await client.auth.signInWithOAuth({
      provider: 'discord', options: {redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true},
    });
    if (error) throw error;
    if (!data.url) throw new Error('Discord sign-in URL was not returned.');
    if (new URL(data.url).searchParams.get('code_challenge_method') !== 's256') {
      throw new Error('Secure Discord sign-in requires SHA-256 PKCE.');
    }
    const result = await openAuthSessionAsync(data.url, NATIVE_AUTH_CALLBACK);
    if (result.type === 'cancel' || result.type === 'dismiss') return;
    if (result.type !== 'success') throw new Error('The sign-in browser could not complete authentication.');
    const {error: exchangeError} = await client.auth.exchangeCodeForSession(nativeAuthCode(result.url));
    if (exchangeError) throw exchangeError;
  } finally { signingIn = false; }
}

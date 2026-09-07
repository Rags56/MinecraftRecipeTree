import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import {AppState} from 'react-native';
import {installNativeAuthCrypto} from './nativeCrypto.native';
import {SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY} from './supabaseConfig';

export const NATIVE_API_ORIGIN = 'https://minecraftrecipetree.craftsmannsoftware.com';
let client: SupabaseClient | null = null;
export async function supabaseAccountClient(): Promise<SupabaseClient> {
  if (client) return client;
  installNativeAuthCrypto();
  client = createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storage: {
        getItem: key => SecureStore.getItemAsync(key),
        setItem: (key, value) => SecureStore.setItemAsync(key, value, {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),
        removeItem: key => SecureStore.deleteItemAsync(key),
      },
    },
  });
  const updateRefresh = (state: string) => {
    if (state === 'active') client?.auth.startAutoRefresh();
    else client?.auth.stopAutoRefresh();
  };
  updateRefresh(AppState.currentState);
  AppState.addEventListener('change', updateRefresh);
  return client;
}
export function cleanFailedAccountAuthRedirect(): void { /* ASWebAuthenticationSession owns the callback. */ }
export async function accountFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (typeof input !== 'string' && !(input instanceof URL)) throw new Error('Native account requests require a URL.');
  const url = new URL(String(input), NATIVE_API_ORIGIN);
  if (url.origin !== NATIVE_API_ORIGIN || !url.pathname.startsWith('/api/') || url.username || url.password) {
    throw new Error('Refusing to send an account session outside the Recipe Tree API.');
  }
  const account = await supabaseAccountClient();
  const {data, error} = await account.auth.getSession();
  if (error) throw error;
  const headers = new Headers(init.headers);
  headers.set('Origin', NATIVE_API_ORIGIN);
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return fetch(url.href, {...init, headers, redirect: 'error'});
}

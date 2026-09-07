import type {User} from '@supabase/supabase-js';
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Platform} from 'react-native';
import {performDiscordSignIn} from './discordSignIn';
import {cleanFailedAccountAuthRedirect, supabaseAccountClient} from './supabaseClient';
import {validDisplayName, validEmail, validPassword} from './userCredentials';
import {recipeTreeUserIdentity} from './userIdentity';

export interface RecipeTreeUser {
  id: string;
  displayName: string;
  email: string | null;
  provider: string | null;
}

type AccountStatus = 'loading' | 'anonymous' | 'authenticated' | 'error';

interface UserContextValue {
  status: AccountStatus;
  user: RecipeTreeUser | null;
  revision: number;
  error: string | null;
  signInWithDiscord(): Promise<void>;
  sendMagicLink(email: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUpWithPassword(email: string, password: string): Promise<'signed_in' | 'confirmation_required'>;
  updateDisplayName(displayName: string): Promise<void>;
  updateEmail(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  deleteAccount(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

function currentReturnUrl(): string {
  if (Platform.OS !== 'web') return 'minecraft-recipe-tree://auth/callback';
  if (typeof window === 'undefined') throw new Error('Account redirects require a browser window.');
  return `${window.location.origin}${window.location.pathname}`;
}

export function UserProvider({children}: {children: React.ReactNode}) {
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [user, setUser] = useState<RecipeTreeUser | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const appliedIdentity = useRef('uninitialized');

  const applyUser = useCallback((next: User | null) => {
    try {
      const mapped = next ? recipeTreeUserIdentity(next) : null;
      const identity = mapped
        ? `${mapped.id}\u0000${mapped.displayName}\u0000${mapped.email ?? ''}\u0000${mapped.provider ?? ''}`
        : 'anonymous';
      setUser(mapped);
      setStatus(mapped ? 'authenticated' : 'anonymous');
      setError(null);
      if (identity !== appliedIdentity.current) {
        appliedIdentity.current = identity;
        setRevision(value => value + 1);
      }
    } catch (cause) {
      console.error('Supabase account profile could not be applied.', cause);
      setUser(null);
      setStatus('error');
      setError('Account profile could not be loaded.');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const client = await supabaseAccountClient();
      if (Platform.OS !== 'web') {
        const {data, error: sessionError} = await client.auth.getSession();
        if (sessionError) throw sessionError;
        applyUser(data.session?.user ?? null);
        return;
      }
      const {data, error: authError} = await client.auth.getUser();
      if (authError && authError.name !== 'AuthSessionMissingError') throw authError;
      applyUser(data.user ?? null);
    } catch (cause) {
      console.error('Account session could not be loaded.', cause);
      setUser(null);
      setStatus('error');
      setError('Account sync is temporarily unavailable.');
    }
  }, [applyUser]);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | null = null;
    void supabaseAccountClient()
      .then(async client => {
        if (!alive) return;
        const {error: initializationError} = await client.auth.initialize();
        if (initializationError) {
          cleanFailedAccountAuthRedirect();
          throw initializationError;
        }
        if (!alive) return;
        const subscription = client.auth.onAuthStateChange((_event, session) => {
          if (alive) applyUser(session?.user ?? null);
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        return refresh();
      })
      .catch(cause => {
        if (!alive) return;
        console.error('Account session initialization failed.', cause);
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Account sync is temporarily unavailable.');
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [applyUser, refresh]);

  const signInWithDiscord = useCallback(async () => {
    const client = await supabaseAccountClient();
    await performDiscordSignIn(client, currentReturnUrl());
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    if (Platform.OS !== 'web') {
      throw new Error('Email sign-in is currently available only in the web app.');
    }
    const client = await supabaseAccountClient();
    const {error: authError} = await client.auth.signInWithOtp({
      email: validEmail(email),
      options: {
        emailRedirectTo: currentReturnUrl(),
        shouldCreateUser: true,
      },
    });
    if (authError) throw authError;
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (Platform.OS !== 'web') {
      throw new Error('Password sign-in is currently available only in the web app.');
    }
    const client = await supabaseAccountClient();
    const {error: authError} = await client.auth.signInWithPassword({
      email: validEmail(email),
      password: validPassword(password),
    });
    if (authError) throw authError;
  }, []);

  const signUpWithPassword = useCallback(async (
    email: string,
    password: string,
  ): Promise<'signed_in' | 'confirmation_required'> => {
    if (Platform.OS !== 'web') {
      throw new Error('Account creation is currently available only in the web app.');
    }
    const client = await supabaseAccountClient();
    const {data, error: authError} = await client.auth.signUp({
      email: validEmail(email),
      password: validPassword(password),
      options: {emailRedirectTo: currentReturnUrl()},
    });
    if (authError) throw authError;
    return data.session ? 'signed_in' : 'confirmation_required';
  }, []);

  const updateEmail = useCallback(async (email: string) => {
    const client = await supabaseAccountClient();
    const {error: authError} = await client.auth.updateUser({email: validEmail(email)});
    if (authError) throw authError;
  }, []);

  const updateDisplayName = useCallback(async (displayName: string) => {
    const client = await supabaseAccountClient();
    const {data, error: authError} = await client.auth.updateUser({
      data: {display_name: validDisplayName(displayName)},
    });
    if (authError) throw authError;
    if (!data.user) throw new Error('Supabase did not return the updated account profile.');
    applyUser(data.user);
  }, [applyUser]);

  const updatePassword = useCallback(async (password: string) => {
    const client = await supabaseAccountClient();
    const {error: authError} = await client.auth.updateUser({password: validPassword(password)});
    if (authError) throw authError;
  }, []);

  const deleteAccount = useCallback(async () => {
    const {accountFetch} = await import('./supabaseClient');
    const response = await accountFetch('/api/auth/account', {method: 'DELETE'});
    const body = await response.json().catch(() => null) as {error?: unknown} | null;
    if (!response.ok) {
      throw new Error(typeof body?.error === 'string' ? body.error : 'Account could not be deleted.');
    }
    const client = await supabaseAccountClient();
    const {error: authError} = await client.auth.signOut({scope: 'local'});
    if (authError) throw authError;
    applyUser(null);
  }, [applyUser]);

  const signOut = useCallback(async () => {
    const client = await supabaseAccountClient();
    const {error: authError} = await client.auth.signOut();
    if (authError) throw authError;
  }, []);

  const value = useMemo<UserContextValue>(
    () => ({
      status,
      user,
      revision,
      error,
      signInWithDiscord,
      sendMagicLink,
      signInWithPassword,
      signUpWithPassword,
      updateDisplayName,
      updateEmail,
      updatePassword,
      deleteAccount,
      signOut,
      refresh,
    }),
    [
      deleteAccount,
      error,
      refresh,
      revision,
      sendMagicLink,
      signInWithDiscord,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      status,
      updateEmail,
      updateDisplayName,
      updatePassword,
      user,
    ],
  );
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const value = useContext(UserContext);
  if (!value) throw new Error('useUser must be used inside UserProvider.');
  return value;
}

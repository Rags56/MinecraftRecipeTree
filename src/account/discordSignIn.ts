import type {SupabaseClient} from '@supabase/supabase-js';
export async function performDiscordSignIn(client: SupabaseClient, redirectTo: string): Promise<void> {
  const {error} = await client.auth.signInWithOAuth({provider: 'discord', options: {redirectTo}});
  if (error) throw error;
}

import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_DATABASE_URL } from '$env/static/public';

export const supabaseClient = createBrowserClient(
  PUBLIC_SUPABASE_DATABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Calls a Postgres function that returns a set of rows. The client has no
 * generated database types, so it cannot know the row type; `.returns<T[]>()`
 * no longer type-checks for RPCs, hence the assertion here.
 */
export async function rpcRows<T>(fn: string, args?: Record<string, unknown>) {
  const { data, error } = await supabaseClient.rpc(fn, args);
  return { data: (data ?? []) as T[], error };
}

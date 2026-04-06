import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_DATABASE_URL } from '$env/static/public';

export const supabaseClient = createBrowserClient(PUBLIC_SUPABASE_DATABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

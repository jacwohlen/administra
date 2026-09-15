// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
// and what to do when importing types

import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { UserProfile } from '$lib/models';

declare global {
  // Injected by the `define` block in vite.config.js.
  const __GIT_BRANCH__: string;

  namespace App {
    // interface Error {}
    interface Locals {
      supabase: SupabaseClient;
      safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
    }
    interface PageData {
      session: Session | null;
      userProfile: UserProfile | null;
    }
    // interface Platform {}
  }
}

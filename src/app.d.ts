// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
// and what to do when importing types

import type { SupabaseClient, Session } from '@supabase/supabase-js';
import type { UserProfile } from '$lib/models';
import type { AssistantKind } from '$lib/assistant/types';

declare global {
  // Injected by the `define` block in vite.config.js.
  const __GIT_BRANCH__: string;
  // Netlify's deploy context at build time, for the Sentry environment.
  const __NETLIFY_CONTEXT__: string;

  namespace App {
    interface Error {
      message: string;
      /** Sentry event ID, shown on the error page so people can quote it. */
      errorId?: string;
    }
    interface Locals {
      supabase: SupabaseClient;
      /** The verified account of the session cookie (hooks.server.ts) */
      safeGetSession: () => Promise<{ session: Session | null; user: { id: string } | null }>;
    }
    interface PageData {
      session: Session | null;
      userProfile: UserProfile | null;
    }
    interface PageState {
      /** The ?assistant=<kind> request of this history entry was answered (autoOpen.ts) */
      assistantTaken?: AssistantKind;
    }
    // interface Platform {}
  }
}

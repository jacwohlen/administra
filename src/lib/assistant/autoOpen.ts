import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import type { AssistantKind } from './types';

/**
 * The Daten-Assistent page (/dashboard/assistant) sends the user to the
 * page where a kind is reviewed and saved, with `?assistant=<kind>`. That
 * page calls this in onMount: true when the dialog should open right away.
 * The parameter is removed again, so a reload or the back button does not
 * reopen it.
 */
export function takeAssistantRequest(kind: AssistantKind): boolean {
  if (page.url.searchParams.get('assistant') !== kind) return false;
  const url = new URL(page.url);
  url.searchParams.delete('assistant');
  try {
    replaceState(url, page.state);
  } catch {
    // On a full page load onMount can run before the router has started;
    // remove the parameter once it has, or leave it if that fails too.
    setTimeout(() => {
      try {
        replaceState(url, page.state);
      } catch {
        // Only cosmetic: a reload would open the dialog again
      }
    });
  }
  return true;
}

/** Link to a page that opens the assistant for `kind` on arrival. */
export function assistantHref(path: string, kind: AssistantKind): string {
  return `${path}?assistant=${kind}`;
}

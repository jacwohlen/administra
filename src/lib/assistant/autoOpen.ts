import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import type { AssistantKind } from './types';

/**
 * The Daten-Assistent page (/dashboard/assistant) sends the user to the
 * page where a kind is reviewed and saved, with `?assistant=<kind>`. That
 * page calls takeAssistantRequest in onMount: true when the dialog should
 * open right away.
 *
 * The request is answered once per history entry. The parameter is removed
 * from the address bar, and the entry is marked as answered in its shallow
 * state (`page.state.assistantTaken`): SvelteKit keeps the original URL of
 * an entry and restores it on Back, and `page.url` keeps the parameter
 * until the next navigation, so the parameter alone would reopen the
 * dialog on Back or when a component mounts again.
 */
export function isAssistantRequested(kind: AssistantKind): boolean {
  return page.url.searchParams.get('assistant') === kind && page.state.assistantTaken !== kind;
}

export function takeAssistantRequest(kind: AssistantKind): boolean {
  if (!isAssistantRequested(kind)) return false;
  const url = new URL(page.url);
  url.searchParams.delete('assistant');
  const mark = () => replaceState(url, { ...page.state, assistantTaken: kind });
  try {
    mark();
  } catch {
    // On a full page load onMount can run before the router has started
    setTimeout(() => {
      try {
        mark();
      } catch {
        // Only cosmetic: the dialog could open once more
      }
    });
  }
  return true;
}

/** Link to a page that opens the assistant for `kind` on arrival. */
export function assistantHref(path: string, kind: AssistantKind): string {
  return `${path}?assistant=${kind}`;
}

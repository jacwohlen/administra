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
  replaceState(url, page.state);
  return true;
}

/** Link to a page that opens the assistant for `kind` on arrival. */
export function assistantHref(path: string, kind: AssistantKind): string {
  return `${path}?assistant=${kind}`;
}

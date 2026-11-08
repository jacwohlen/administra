import { isValidEmail, suggestEmail } from '#lib/emailAddress.ts';

/**
 * What a form does with the e-mail address it is about to send:
 * - `invalid`: refuse it (message `components.emailCheck.invalid`)
 * - `suggest`: ask whether the person meant `suggestion` first
 * - `ok`: send it
 *
 * `kept` is the address the person already confirmed after a suggestion
 * ("No, it is correct"), so they are asked once only.
 */
export type EmailCheck =
  | { result: 'ok' }
  | { result: 'invalid'; suggestion: string | null }
  | { result: 'suggest'; suggestion: string };

export function checkEmail(email: string, kept: string | null = null): EmailCheck {
  const value = email.trim();
  const suggestion = suggestEmail(value);
  if (!isValidEmail(value)) return { result: 'invalid', suggestion };
  if (suggestion && value !== kept) return { result: 'suggest', suggestion };
  return { result: 'ok' };
}

/**
 * Asks the server whether the domain receives mail (`/api/email-check`).
 * True when it does, or when the server cannot tell (offline, error): the
 * check only catches typos and never blocks a sign-in on its own.
 */
export async function emailReachable(email: string, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher('/api/email-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() })
    });
    if (!response.ok) return true;
    return ((await response.json()) as { ok?: boolean }).ok !== false;
  } catch {
    return true;
  }
}

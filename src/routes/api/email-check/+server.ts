import type { RequestHandler } from '@sveltejs/kit';
import { emailDomain } from '#lib/emailAddress.ts';
import { domainReceivesMail } from '#lib/server/emailDomain.ts';

/**
 * Whether an e-mail address can receive mail: valid syntax and a domain with
 * mail servers (`#lib/server/emailDomain.ts`). The sign-in page asks before it
 * requests a one-time code, since Supabase creates the account with the
 * request and a mistyped address would wait on the users page for ever.
 * Answers `{ ok }` only; a failed lookup counts as ok.
 */
export const POST: RequestHandler = async ({ request }) => {
  let email: unknown;
  try {
    ({ email } = await request.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const domain = typeof email === 'string' ? emailDomain(email) : null;
  return Response.json({ ok: domain !== null && (await domainReceivesMail(domain)) });
};

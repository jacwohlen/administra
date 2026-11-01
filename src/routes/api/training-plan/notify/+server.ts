import { json, type RequestHandler } from '@sveltejs/kit';
import { planMailMode, sendMail, type SendResult } from '$lib/server/mailer';
import { loadMailSettings } from '$lib/server/trialMailContext';
import { scrubText } from '$lib/sentryScrub';
import {
  computeNotices,
  fingerprint,
  type MailLocale,
  type MailScope,
  type NoticeSet,
  type NotifyErrorCode,
  type NotifyRequest,
  type NotifyResult
} from '$lib/trainingPlanMail';
import { loadMailPlan, loadMailScope } from '$lib/trainingPlanMailData';
import { renderMail } from '$lib/trainingPlanMailText';

/**
 * "Trainer informieren" (docs/TRAINING_PLAN.md): a planner mails trainers
 * what changed in the plan since they were last told, one address per
 * request, or marks members as told without a mail.
 *
 * Runs with the signed-in user's session, so row-level security decides what
 * is read and written. Nothing the mail says comes from the browser: the plan
 * and what each member was told are loaded again, the lines recomputed
 * (src/lib/trainingPlanMail.ts), the address looked up here, and the
 * fingerprint of the preview must match (409 otherwise). Only members with
 * pending lines can be mailed, and once mailed they are told, so the same
 * mail cannot go out twice without a change to the plan. A mail whose outcome
 * is unknown (its log row still 'pending') is part of the fingerprint: a
 * preview from before it was sent is stale.
 *
 * Mails leave only in production (planMailMode()); the demo and, with SMTP
 * set, Dev simulate: the told state is saved, the log says skipped.
 *
 * Failures are answered as { code } with a status, never error(): the dialog
 * tells a stale preview (409) apart, and an expected 5xx (503 mail_off) is
 * not reported to Sentry.
 */

const MAX_MEMBERS = 500;

function failure(code: NotifyErrorCode, status: number) {
  return json({ code }, { status });
}

/** Whether plan mails leave (smtp), are simulated (demo, test) or are off */
export const GET: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) return failure('not_signed_in', 401);
  return json({ mode: planMailMode() });
};

/** Logged for a mail simulated outside production */
const TEST_SKIP = 'Test environment: plan mails leave only in production (PUBLIC_MODE=PROD)';

/** The request, or null when it is not one; anything else in the body is ignored */
function parseRequest(body: unknown): NotifyRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { action, memberIds, fingerprint: print, locale } = body as Record<string, unknown>;
  if (action !== 'send' && action !== 'mark') return null;
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > MAX_MEMBERS) {
    return null;
  }
  if (!memberIds.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
    return null;
  }
  if (new Set(memberIds).size !== memberIds.length) return null;
  if (typeof print !== 'string' || print.length < 1 || print.length > 32) return null;
  const mailLocale: MailLocale = locale === 'en' ? 'en' : 'de';
  return { action, memberIds: memberIds as number[], fingerprint: print, locale: mailLocale };
}

const messageOf = (e: unknown) =>
  scrubText(
    e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e)
  ).slice(0, 300);

export const POST: RequestHandler = async ({ request, locals, url }) => {
  const { session, user } = await locals.safeGetSession();
  if (!session || !user) return failure('not_signed_in', 401);

  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return failure('bad_request', 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure('bad_request', 400);
  }
  const req = parseRequest(body);
  if (!req) return failure('bad_request', 400);
  const send = req.action === 'send';

  const mode = planMailMode();
  if (send && mode === 'off') return failure('mail_off', 503);

  let scope: MailScope | null;
  try {
    scope = await loadMailScope(locals.supabase);
  } catch (e) {
    console.error('Plan mails: loading the scope failed:', messageOf(e));
    return failure('load_failed', 500);
  }
  if (!scope) return failure('not_allowed', 403);

  let set: NoticeSet;
  try {
    const data = await loadMailPlan(locals.supabase, scope, {
      signal: AbortSignal.timeout(10_000)
    });
    set = computeNotices(data, scope);
  } catch (e) {
    console.error('Plan mails: loading the plan failed:', messageOf(e));
    return failure('load_failed', 500);
  }

  // Only members with pending lines: not the sender's own, nobody outside
  // the scope, nobody told since the preview
  const requested = new Set(req.memberIds);
  const notices = set.members.filter((n) => requested.has(n.memberId));
  if (notices.length !== requested.size) return failure('stale', 409);

  let address: string | null = null;
  let key: string | null = null;
  if (send) {
    if (set.unreachable.some((u) => requested.has(u.member.memberId))) {
      return failure('unreachable', 400);
    }
    const groups = set.groups.filter((g) => g.members.some((m) => requested.has(m.memberId)));
    if (groups.length !== 1) return failure('several_addresses', 400);
    address = groups[0].address;
    key = groups[0].key;
  }

  if (fingerprint(notices, key) !== req.fingerprint) return failure('stale', 409);
  if (notices.every((n) => n.trainings.every((t) => t.lines.length === 0))) {
    return failure('nothing_pending', 400);
  }

  // The sender's own members are told along, never mailed
  const states = [...notices.map((n) => n.told), ...set.own.map((o) => o.told)];

  const { data: profile } = await locals.supabase
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle<{ full_name: string | null }>();
  const senderName = profile?.full_name?.trim() || user.email || '';
  const { club } = await loadMailSettings(locals.supabase);
  const ctx = { locale: req.locale, clubName: club.name, origin: url.origin, senderName };

  if (!send) {
    const { error } = await locals.supabase.rpc('training_plan_set_told', { p_states: states });
    if (error) {
      if (error.code === '42501') return failure('not_allowed', 403);
      console.error('Plan mails: training_plan_set_told failed:', error.code);
      return failure('save_failed', 500);
    }
    // Each member's own lines, for the log
    const { error: logError } = await locals.supabase.from('training_plan_mails').insert(
      notices.map((n) => ({
        member_id: n.memberId,
        status: 'marked',
        to_email: null,
        subject: null,
        body: renderMail([n], ctx).text.slice(0, 20_000)
      }))
    );
    if (logError) console.error('Plan mails: logging the marking failed:', logError.code);
    const result: NotifyResult = { status: 'marked', simulated: false, toldSaved: true };
    return json(result);
  }

  const mail = renderMail(notices, ctx);
  // Logged before sending, so a send whose function is killed stays visible
  const { data: logged, error: insertError } = await locals.supabase
    .from('training_plan_mails')
    .insert(
      notices.map((n) => ({
        member_id: n.memberId,
        to_email: address,
        subject: mail.subject.slice(0, 300),
        body: mail.text.slice(0, 20_000),
        status: 'pending'
      }))
    )
    .select('id');
  if (insertError || !logged) return failure('not_allowed', 403);

  // Outside production the mailer is never asked (the demo's refuses anyway)
  const sent: SendResult =
    mode === 'test'
      ? { status: 'skipped', error: TEST_SKIP }
      : await sendMail({
          to: address!,
          subject: mail.subject,
          text: mail.text,
          replyTo: user.email || club.contactEmail
        });
  const simulated = mode === 'test' || (sent.status === 'skipped' && sent.reason === 'demo');
  const error = 'error' in sent ? scrubText(sent.error).slice(0, 1000) : undefined;

  const { error: updateError } = await locals.supabase
    .from('training_plan_mails')
    .update({
      status: sent.status,
      error: error ?? null,
      sent_at: sent.status === 'sent' ? new Date().toISOString() : null
    })
    .in(
      'id',
      (logged as { id: number }[]).map((row) => row.id)
    );
  if (updateError) console.error('Plan mails: updating the log failed:', updateError.code);

  let toldSaved = false;
  if (sent.status === 'sent' || simulated) {
    const { error: toldError } = await locals.supabase.rpc('training_plan_set_told', {
      p_states: states
    });
    if (toldError) console.error('Plan mails: training_plan_set_told failed:', toldError.code);
    toldSaved = !toldError;
  }

  const result: NotifyResult = {
    status: sent.status,
    simulated,
    toldSaved,
    ...(error ? { error } : {})
  };
  return json(result);
};

import type { RequestHandler } from '@sveltejs/kit';
import { planMailMode, sendMail } from '#lib/server/mailer.ts';
import { loadMailSettings } from '#lib/server/trialMailContext.ts';
import { scrubText } from '#lib/sentryScrub.ts';
import {
  mailRecipient,
  renderRequestMail,
  requestErrorCode,
  type RequestErrorCode,
  type RequestEvent,
  type RequestMailData,
  type RequestMailOutcome,
  type RequestResult,
  type RequestStatus
} from '#lib/trainingPlanRequests.ts';
import type { MailLocale } from '#lib/trainingPlanMail.ts';

/**
 * Substitutes and swaps (docs/TRAINING_PLAN.md, "Vertretung und Tausch"):
 * asking, answering and withdrawing a request, then the mail to the other
 * person. Runs with the signed-in user's session: the database functions
 * check who may do what (training_plan_request_*()), and the mail is built
 * from what training_plan_request_mail() returns, never from the browser.
 *
 * The mail is a courtesy: the request is saved (and the plan changed) before
 * it is sent, and a mail that fails does not undo it. Mails leave only in
 * production (planMailMode(), as the plan mails); elsewhere they are
 * simulated. Nobody is mailed who opted out of plan mails or has no address.
 */

function failure(code: RequestErrorCode, status: number) {
  return Response.json({ code }, { status });
}

const HTTP: Partial<Record<RequestErrorCode, number>> = {
  not_allowed: 403,
  not_your_date: 403,
  not_found: 404,
  busy: 409,
  failed: 500
};

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

type Parsed =
  | {
      action: 'create';
      params: {
        p_kind: 'substitute' | 'swap';
        p_training_id: number;
        p_date: string;
        p_to_member: number;
        p_other_training_id: number | null;
        p_other_date: string | null;
        p_message: string | null;
        p_move_note: boolean;
        p_other_move_note: boolean;
      };
    }
  | { action: 'answer'; id: number; accept: boolean }
  | { action: 'withdraw'; id: number };

function parse(body: Record<string, unknown>): Parsed | null {
  if (body.action === 'create') {
    const swap = body.kind === 'swap';
    if (body.kind !== 'substitute' && !swap) return null;
    if (!isId(body.trainingId) || !isDate(body.date) || !isId(body.toMemberId)) return null;
    if (swap && (!isId(body.otherTrainingId) || !isDate(body.otherDate))) return null;
    const message = body.message == null ? null : body.message;
    if (message !== null && (typeof message !== 'string' || message.length > 500)) return null;
    return {
      action: 'create',
      params: {
        p_kind: swap ? 'swap' : 'substitute',
        p_training_id: body.trainingId,
        p_date: body.date,
        p_to_member: body.toMemberId,
        p_other_training_id: swap ? (body.otherTrainingId as number) : null,
        p_other_date: swap ? (body.otherDate as string) : null,
        p_message: message,
        p_move_note: body.moveNote !== false,
        p_other_move_note: body.otherMoveNote !== false
      }
    };
  }
  if (body.action === 'answer' && isId(body.id) && typeof body.accept === 'boolean') {
    return { action: 'answer', id: body.id, accept: body.accept };
  }
  if (body.action === 'withdraw' && isId(body.id)) return { action: 'withdraw', id: body.id };
  return null;
}

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
  if (typeof body !== 'object' || body === null) return failure('bad_request', 400);
  const req = parse(body as Record<string, unknown>);
  if (!req) return failure('bad_request', 400);
  const locale: MailLocale = (body as { locale?: unknown }).locale === 'en' ? 'en' : 'de';

  // The database decides; its exception message is the code
  let id: number;
  let status: RequestStatus;
  let event: RequestEvent | null;
  if (req.action === 'create') {
    const { data, error } = await locals.supabase.rpc('training_plan_request_create', req.params);
    if (error) {
      const code = requestErrorCode(error.message);
      if (code === 'failed') console.error('Plan requests: create failed:', error.code);
      return failure(code, HTTP[code] ?? 400);
    }
    id = Number(data);
    status = 'open';
    event = 'asked';
  } else {
    const fn =
      req.action === 'answer' ? 'training_plan_request_answer' : 'training_plan_request_withdraw';
    const args =
      req.action === 'answer' ? { p_id: req.id, p_accept: req.accept } : { p_id: req.id };
    const { data, error } = await locals.supabase.rpc(fn, args);
    if (error) {
      const code = requestErrorCode(error.message);
      if (code === 'failed') console.error(`Plan requests: ${req.action} failed:`, error.code);
      return failure(code, HTTP[code] ?? 400);
    }
    id = req.id;
    status = data as RequestStatus;
    // Only what this call changed is mailed (not an answer given before)
    const changed =
      req.action === 'answer'
        ? status === (req.accept ? 'accepted' : 'declined')
        : status === 'withdrawn';
    event = changed ? (status as RequestEvent) : null;
  }

  const result: RequestResult = { status, id, mail: 'off' };
  const mode = planMailMode();
  if (!event || mode === 'off') return Response.json(result);

  try {
    const { data } = await locals.supabase.rpc('training_plan_request_mail', { p_id: id });
    const details = data as RequestMailData | null;
    if (!details) return Response.json({ ...result, mail: 'skipped' });
    const to = mailRecipient(event, details);
    if (!to.email || to.optout) return Response.json({ ...result, mail: 'skipped' });

    const { club } = await loadMailSettings(locals.supabase);
    const mail = renderRequestMail(event, details, {
      locale,
      clubName: club.name,
      origin: url.origin
    });
    if (mode !== 'smtp') return Response.json({ ...result, mail: 'simulated' });
    const sent = await sendMail({
      to: to.email,
      subject: mail.subject,
      text: mail.text,
      replyTo: user.email || club.contactEmail
    });
    if (sent.status === 'failed') {
      console.error('Plan requests: mail failed:', scrubText(sent.error).slice(0, 300));
    }
    const outcome: RequestMailOutcome =
      sent.status === 'sent' ? 'sent' : sent.status === 'failed' ? 'failed' : 'skipped';
    return Response.json({ ...result, mail: outcome });
  } catch (e) {
    console.error(
      'Plan requests: mail failed:',
      scrubText(e instanceof Error ? e.message : String(e)).slice(0, 300)
    );
    return Response.json({ ...result, mail: 'failed' });
  }
};

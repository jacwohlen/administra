import { json, error, type RequestHandler } from '@sveltejs/kit';
import { isMailConfigured, sendMail } from '$lib/server/mailer';
import { loadMailSettings } from '$lib/server/trialMailContext';
import { TRIAL_MAIL_KINDS, type TrialMailKind } from '$lib/trialMail';

/**
 * Mails staff send to a trial candidate after previewing them in the
 * dashboard. Runs with the signed-in user's session, so row-level security
 * decides who may read the candidate and log a mail (writers: trainer and
 * admin). The recipient is always the candidate's stored address.
 */

/** Whether mails would actually leave, for the hint in the preview dialog. */
export const GET: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) error(401, 'Not signed in');
  return json({ configured: isMailConfigured() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) error(401, 'Not signed in');

  let body: { memberId?: unknown; kind?: unknown; subject?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request');
  }

  const memberId = Number(body.memberId);
  const kind = body.kind as TrialMailKind;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!Number.isInteger(memberId) || !TRIAL_MAIL_KINDS.includes(kind) || !subject || !text) {
    error(400, 'memberId, kind, subject and body are required');
  }
  if (subject.length > 300 || text.length > 10_000) error(400, 'Mail too long');

  const { data: member } = await locals.supabase
    .from('members')
    .select('id, email')
    .eq('id', memberId)
    .maybeSingle();
  if (!member) error(404, 'Member not found');
  if (!member.email) error(400, 'Member has no e-mail address');

  const { data: logged, error: insertError } = await locals.supabase
    .from('trial_emails')
    .insert({ member_id: memberId, kind, to_email: member.email, subject, body: text })
    .select('id')
    .single();
  if (insertError || !logged) {
    // RLS rejects viewers here; they may look but not send.
    error(403, insertError?.message ?? 'Not allowed');
  }

  const { club } = await loadMailSettings(locals.supabase);
  const result = await sendMail({
    to: member.email,
    subject,
    text,
    replyTo: club.contactEmail
  });

  const { error: updateError } = await locals.supabase
    .from('trial_emails')
    .update({
      status: result.status,
      error: 'error' in result ? result.error : null,
      sent_at: result.status === 'sent' ? new Date().toISOString() : null
    })
    .eq('id', logged.id);
  if (updateError) console.error('Updating trial_emails failed:', updateError);

  return json(result);
};

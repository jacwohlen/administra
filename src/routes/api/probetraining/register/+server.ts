import { json, error, type RequestHandler } from '@sveltejs/kit';
import { sendMail } from '$lib/server/mailer';
import { loadMailSettings } from '$lib/server/trialMailContext';
import {
  buildTrialMailVars,
  renderTrialMail,
  trialMailLocale,
  trialMailTemplate,
  trialStatusUrl
} from '$lib/trialMail';

/**
 * Public trial registration (the /probetraining form). Creates the
 * candidate through register_trial() and sends the thank-you mail right
 * away; the other trial mails go out only after staff previewed them.
 *
 * A failed mail never fails the registration — it is logged in
 * trial_emails and staff can resend it from the dashboard.
 */

interface RegistrationBody {
  firstname?: unknown;
  lastname?: unknown;
  birthday?: unknown;
  email?: unknown;
  mobile?: unknown;
  section?: unknown;
  notes?: unknown;
  locale?: unknown;
  /** Honeypot: humans never see this field. */
  website?: unknown;
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * HTTP status for a failed register_trial() call. The function raises
 * 'PT429' when a rate limit is hit (PostgREST answers those with 429) and
 * 22xxx for invalid input; everything else is our fault.
 */
function registrationErrorStatus(code: string | undefined, status?: number) {
  if (code === 'PT429' || status === 429) return 429;
  if (code?.startsWith('22')) return 400;
  return 500;
}

/** Generic message per status; details only go to the server log. */
const registrationErrorMessages: Record<number, string> = {
  400: 'Invalid registration',
  429: 'Too many registrations, please try again later',
  500: 'Registration failed'
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
  let body: RegistrationBody;
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request');
  }

  // Bots get a success response and nothing happens.
  if (str(body.website)) return json({ ok: true });

  const registration = {
    p_firstname: str(body.firstname),
    p_lastname: str(body.lastname),
    p_birthday: str(body.birthday),
    p_email: str(body.email),
    p_mobile: str(body.mobile) || null,
    p_section: str(body.section) || null,
    p_notes: str(body.notes) || null,
    p_locale: body.locale === 'en' ? 'en' : 'de'
  };
  if (
    !registration.p_firstname ||
    !registration.p_lastname ||
    !registration.p_birthday ||
    !registration.p_email
  ) {
    error(400, 'Missing required fields');
  }

  const {
    data,
    error: rpcError,
    status
  } = await locals.supabase.rpc('register_trial', registration);
  if (rpcError) {
    console.error('register_trial failed:', rpcError);
    const httpStatus = registrationErrorStatus(rpcError.code, status);
    error(httpStatus, registrationErrorMessages[httpStatus]);
  }

  const { emailId, token, statusToken } = (data ?? {}) as {
    emailId?: number;
    token?: string;
    statusToken?: string;
  };
  const statusUrl = trialStatusUrl(url.origin, statusToken);
  if (emailId && token) {
    const { club, values } = await loadMailSettings(locals.supabase);
    const locale = trialMailLocale(registration.p_locale, club.defaultLocale);
    const mail = renderTrialMail(
      trialMailTemplate(values, 'welcome', locale),
      buildTrialMailVars(
        { firstname: registration.p_firstname, lastname: registration.p_lastname },
        club,
        [],
        locale,
        statusUrl
      )
    );
    const result = await sendMail({
      to: registration.p_email,
      subject: mail.subject,
      text: mail.body,
      replyTo: club.contactEmail
    });
    const { error: logError } = await locals.supabase.rpc('complete_trial_email', {
      p_id: emailId,
      p_token: token,
      p_status: result.status,
      p_subject: mail.subject,
      p_body: mail.body,
      p_error: 'error' in result ? result.error : null
    });
    if (logError) console.error('complete_trial_email failed:', logError);
  }

  return json({ ok: true, statusUrl: statusToken ? statusUrl : null });
};

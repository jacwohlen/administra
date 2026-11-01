import { env } from '$env/dynamic/private';
import { PUBLIC_MODE } from '$env/static/public';
import nodemailer, { type Transporter } from 'nodemailer';
import { scrubText } from '$lib/sentryScrub';

/**
 * Outgoing e-mail through the club's SMTP server.
 *
 * Configured with PRIVATE_SMTP_HOST / _PORT / _USER / _PASSWORD / _FROM
 * (see .env.example and docs/TRIAL_EMAILS.md). They are read at runtime from
 * `$env/dynamic/private`, so a deploy without them still builds: mails are
 * then logged as "skipped" instead of sent. That is also how Deploy Previews
 * stay silent — leave the SMTP variables out of the deploy-preview context.
 *
 * Never sent, whatever the configuration: anything in the public demo
 * (PUBLIC_MODE=DEMO), and mail to *.invalid addresses, which the Webling
 * sync gives anonymized members outside production. Errors are logged and
 * returned without e-mail addresses (SMTP servers like to quote them).
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}

/** Why a mail was not sent */
export type SkipReason = 'demo' | 'invalid_address' | 'not_configured';

export type SendResult =
  | { status: 'sent' }
  | { status: 'skipped'; error: string; reason?: SkipReason }
  | { status: 'failed'; error: string };

/**
 * smtp: mails leave; demo: the public demo, nothing leaves; test: plan mails
 * outside production, simulated (planMailMode()); off: SMTP not configured
 */
export type MailMode = 'smtp' | 'demo' | 'test' | 'off';

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env.PRIVATE_SMTP_HOST && env.PRIVATE_SMTP_FROM);
}

/** demo: PUBLIC_MODE=DEMO (wins over SMTP), smtp: configured, off: neither */
export function mailMode(): MailMode {
  if (PUBLIC_MODE === 'DEMO') return 'demo';
  return isMailConfigured() ? 'smtp' : 'off';
}

/**
 * The plan mails (Trainer informieren, docs/TRAINING_PLAN.md) leave only in
 * production: PUBLIC_MODE=PROD, which every club instance runs. Dev
 * (PUBLIC_MODE=DEV) has the club's SMTP server for the trial mails, but a
 * trainer there may be linked to a real sign-in address, so with SMTP set
 * sending is simulated (test), as in the demo.
 */
export function planMailMode(): MailMode {
  const mode = mailMode();
  return mode === 'smtp' && PUBLIC_MODE !== 'PROD' ? 'test' : mode;
}

/** The sync's anonymized addresses (member-<id>@example.invalid) never reach anyone */
export function isUndeliverable(address: string): boolean {
  return /\.invalid$/i.test(address.trim());
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(env.PRIVATE_SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: env.PRIVATE_SMTP_HOST,
      port,
      // 465 is implicit TLS; 587 (the default) upgrades with STARTTLS, which
      // is required so credentials never travel in the clear.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: env.PRIVATE_SMTP_USER
        ? { user: env.PRIVATE_SMTP_USER, pass: env.PRIVATE_SMTP_PASSWORD ?? '' }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    });
  }
  return transporter;
}

export async function sendMail(mail: OutgoingMail): Promise<SendResult> {
  if (PUBLIC_MODE === 'DEMO') {
    return { status: 'skipped', error: 'Demo: no mail is sent', reason: 'demo' };
  }
  if (isUndeliverable(mail.to)) {
    return {
      status: 'skipped',
      error: 'Address cannot receive mail (.invalid)',
      reason: 'invalid_address'
    };
  }
  if (!isMailConfigured()) {
    return { status: 'skipped', error: 'SMTP is not configured', reason: 'not_configured' };
  }
  try {
    await getTransporter().sendMail({
      from: env.PRIVATE_SMTP_FROM,
      to: mail.to,
      replyTo: mail.replyTo || undefined,
      subject: mail.subject,
      text: mail.text
    });
    return { status: 'sent' };
  } catch (e) {
    const message = scrubText(e instanceof Error ? e.message : String(e));
    console.error('Sending mail failed:', message);
    return { status: 'failed', error: message };
  }
}

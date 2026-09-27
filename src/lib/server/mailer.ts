import { env } from '$env/dynamic/private';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outgoing e-mail through the club's SMTP server.
 *
 * Configured with PRIVATE_SMTP_HOST / _PORT / _USER / _PASSWORD / _FROM
 * (see .env.example and docs/TRIAL_EMAILS.md). They are read at runtime from
 * `$env/dynamic/private`, so a deploy without them still builds: mails are
 * then logged as "skipped" instead of sent. That is also how Deploy Previews
 * stay silent — leave the SMTP variables out of the deploy-preview context.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}

export type SendResult =
  { status: 'sent' } | { status: 'skipped'; error: string } | { status: 'failed'; error: string };

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env.PRIVATE_SMTP_HOST && env.PRIVATE_SMTP_FROM);
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
  if (!isMailConfigured()) {
    return { status: 'skipped', error: 'SMTP is not configured' };
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
    console.error('Sending mail failed:', e);
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

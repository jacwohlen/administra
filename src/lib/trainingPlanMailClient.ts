import {
  NOTIFY_ERROR_CODES,
  type NotifyErrorCode,
  type NotifyRequest,
  type NotifyResult
} from './trainingPlanMail';

/**
 * Browser side of /api/training-plan/notify (plan mails, see
 * src/lib/trainingPlanMail.ts). Failures carry a code; the dialog shows a
 * text per code.
 */

/**
 * smtp: mails leave; demo: sending is simulated (PUBLIC_MODE=DEMO); test:
 * simulated too, outside production (Dev); off: no mails
 */
export type MailMode = 'smtp' | 'demo' | 'test' | 'off';

const MODES: readonly MailMode[] = ['smtp', 'demo', 'test', 'off'];
const RESULT_STATUSES: readonly NotifyResult['status'][] = ['sent', 'skipped', 'failed', 'marked'];

/** Whether plan mails can be sent here; 'off' when the answer is anything else */
export async function loadNotifyMode(fetchFn: typeof fetch = fetch): Promise<MailMode> {
  try {
    const res = await fetchFn('/api/training-plan/notify', {
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return 'off';
    const mode = ((await res.json()) as { mode?: unknown } | null)?.mode;
    return MODES.includes(mode as MailMode) ? (mode as MailMode) : 'off';
  } catch {
    return 'off';
  }
}

export type NotifyResponse =
  | ({ ok: true } & NotifyResult)
  | { ok: false; code: NotifyErrorCode | 'timeout' | 'network' | 'failed'; httpStatus?: number };

/**
 * Sends to one address, or marks members as told. Netlify answers a killed
 * function with a bare 502/504: then it is unclear whether the mail left.
 */
export async function postNotify(
  body: NotifyRequest,
  fetchFn: typeof fetch = fetch
): Promise<NotifyResponse> {
  let res: Response;
  try {
    res = await fetchFn('/api/training-plan/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, code: 'network' };
  }
  const answer = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = answer?.code;
    if (NOTIFY_ERROR_CODES.includes(code as NotifyErrorCode)) {
      return { ok: false, code: code as NotifyErrorCode, httpStatus: res.status };
    }
    const timeout = res.status === 502 || res.status === 504;
    return { ok: false, code: timeout ? 'timeout' : 'failed', httpStatus: res.status };
  }
  const status = answer?.status as NotifyResult['status'];
  if (!RESULT_STATUSES.includes(status)) {
    return { ok: false, code: 'failed', httpStatus: res.status };
  }
  return {
    ok: true,
    status,
    simulated: answer?.simulated === true,
    toldSaved: answer?.toldSaved === true,
    ...(typeof answer?.error === 'string' ? { error: answer.error } : {})
  };
}

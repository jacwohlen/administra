import { toaster } from '#lib/toast.ts';
import type { RequestEvent, RequestMailOutcome } from '#lib/trainingPlanRequests.ts';

type Translate = (key: string, options?: { values?: Record<string, string> }) => string;

/**
 * The toast after asking, answering or withdrawing: what happened, and
 * whether the other person got a mail (sent, simulated outside production,
 * or not: no address, opted out, mails off)
 */
export function requestToast(
  t: Translate,
  event: RequestEvent,
  mail: RequestMailOutcome,
  name: string
) {
  const title = t(`page.trainingPlan.request.done.${event}`, { values: { name } });
  const description = t(`page.trainingPlan.request.mail.${mail}`, { values: { name } });
  if (mail === 'failed') toaster.warning({ title, description });
  else toaster.success({ title, description });
}

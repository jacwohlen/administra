import {
  ASSISTANT_ERROR_CODES,
  type AssistantErrorCode,
  type AssistantKind,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantStatus
} from './types';

/**
 * Browser side of /api/assistant. Errors carry a code; the dialog shows
 * assistant.errors.<code>.
 */

export type ClientErrorCode = AssistantErrorCode | 'network';

export class AssistantRequestError extends Error {
  constructor(readonly code: ClientErrorCode) {
    super(code);
    this.name = 'AssistantRequestError';
  }
}

let status: Promise<AssistantStatus> | null = null;
const OFF: AssistantStatus = { configured: false, remaining: null };

/**
 * Whether the assistant is set up on this deployment, fetched once per app
 * session; a failed check is not cached.
 */
export function loadAssistantStatus(fetchFn: typeof fetch = fetch): Promise<AssistantStatus> {
  status ??= fetchFn('/api/assistant', { headers: { accept: 'application/json' } })
    .then(async (res) => (res.ok ? ((await res.json()) as AssistantStatus) : OFF))
    .catch(() => OFF)
    .then((result) => {
      if (!result.configured) status = null;
      return result;
    });
  return status;
}

/** Code for a failed response; Netlify answers a killed function with a bare 502/504. */
function errorCode(statusCode: number, body: unknown): ClientErrorCode {
  const code = (body as { code?: unknown } | null)?.code;
  if (ASSISTANT_ERROR_CODES.includes(code as AssistantErrorCode)) return code as AssistantErrorCode;
  if (statusCode === 413) return 'too_large';
  if (statusCode === 502 || statusCode === 504) return 'timeout';
  if (statusCode === 401) return 'unauthorized';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 429) return 'quota';
  return 'failed';
}

/**
 * Asks for a proposal. Rejects with AssistantRequestError, or with the
 * AbortError when `signal` cancels it.
 */
export async function requestProposal<K extends AssistantKind>(
  request: AssistantRequest & { kind: K },
  signal?: AbortSignal
): Promise<AssistantResponse<K>> {
  let res: Response;
  try {
    res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
      signal
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AssistantRequestError('network');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new AssistantRequestError(errorCode(res.status, body));
  const response = body as AssistantResponse<K>;
  if (response?.kind !== request.kind || !response.proposal) {
    throw new AssistantRequestError('invalid_output');
  }
  status = Promise.resolve({ configured: true, remaining: response.remaining });
  return response;
}

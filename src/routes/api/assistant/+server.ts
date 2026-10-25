import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clubToday, sanitizeProposal } from '$lib/assistant/proposals';
import { ASSISTANT_LIMITS, type AssistantErrorCode } from '$lib/assistant/types';
import {
  apiError,
  countInputTokens,
  createMessage,
  isAssistantConfigured,
  modelSettings,
  readAnswer,
  usageOf
} from '$lib/server/assistant/claude';
import { loadPromptContext } from '$lib/server/assistant/context';
import { buildParams } from '$lib/server/assistant/prompts';
import { AssistantError, parseAssistantRequest } from '$lib/server/assistant/request';

/**
 * Daten-Assistent (docs/AI_ASSISTANT.md): turns an upload into a proposal.
 *
 * Runs with the signed-in user's session. ai_import_begin() checks that the
 * account may write what it asks to extract and enforces the daily limits;
 * then Claude transcribes the material into the kind's fixed JSON schema
 * (no tools, nothing else it could do), and the answer is checked field by
 * field before it is returned. Nothing is written here: the browser saves
 * what the user reviewed, under RLS.
 *
 * Neither the upload nor the answer is ever logged; failures are answered
 * with an error code only (assistant.errors.<code> in the dialog).
 */

function failure(code: AssistantErrorCode, status: number) {
  return json({ code }, { status });
}

/** Whether the assistant is offered at all, and how many extractions are left today. */
export const GET: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) return failure('unauthorized', 401);
  if (!isAssistantConfigured()) return json({ configured: false, remaining: null });
  const { data, error } = await locals.supabase.rpc('ai_import_remaining');
  return json({ configured: true, remaining: error ? null : (data as number) });
};

interface Started {
  id: number;
  remaining: number;
}

async function begin(supabase: SupabaseClient, kind: string): Promise<Started> {
  const { data, error } = await supabase.rpc('ai_import_begin', { p_kind: kind });
  if (error) {
    if (error.code === 'PT429') throw new AssistantError('quota', 429);
    if (error.code === '42501') throw new AssistantError('forbidden', 403);
    console.error('Assistant: ai_import_begin failed', error.code);
    throw new AssistantError('failed', 500);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Started | undefined;
  if (!row) throw new AssistantError('failed', 500);
  return row;
}

async function finish(
  supabase: SupabaseClient,
  id: number,
  status: 'ok' | 'failed' | 'refused',
  tokens: { inputTokens: number; outputTokens: number } | null = null
) {
  const { error } = await supabase.rpc('ai_import_finish', {
    p_id: id,
    p_status: status,
    p_input_tokens: tokens?.inputTokens ?? null,
    p_output_tokens: tokens?.outputTokens ?? null
  });
  if (error) console.error('Assistant: ai_import_finish failed', error.code);
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) return failure('unauthorized', 401);
  if (!isAssistantConfigured()) return failure('not_configured', 503);

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > ASSISTANT_LIMITS.maxRequestBytes) return failure('too_large', 413);

  let started: Started | null = null;
  try {
    const body = await request.text();
    if (body.length > ASSISTANT_LIMITS.maxRequestBytes) return failure('too_large', 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return failure('invalid_request', 400);
    }
    const input = parseAssistantRequest(parsed);

    started = await begin(locals.supabase, input.kind);
    const context = await loadPromptContext(locals.supabase, input);
    const params = buildParams(input, context.text, clubToday(), modelSettings());
    // A PDF can have hundreds of pages within the byte limit; refuse those
    // before they cost anything
    if (input.files.some((f) => f.mediaType === 'application/pdf')) {
      const tokens = await countInputTokens(params, request.signal);
      if (tokens > ASSISTANT_LIMITS.maxInputTokens) {
        throw new AssistantError('too_many_pages', 413);
      }
    }
    const message = await createMessage(params, request.signal);

    let answer;
    try {
      answer = readAnswer(message);
    } catch (err) {
      const refused = err instanceof AssistantError && err.code === 'refused';
      await finish(locals.supabase, started.id, refused ? 'refused' : 'failed', usageOf(message));
      started = null;
      throw err;
    }

    const proposal = sanitizeProposal(input.kind, answer.raw, context.sanitize);
    await finish(locals.supabase, started.id, 'ok', answer);
    return json({ kind: input.kind, proposal, remaining: started.remaining });
  } catch (err) {
    const failed = apiError(err);
    if (started) await finish(locals.supabase, started.id, 'failed');
    return failure(failed.code, failed.status);
  }
};

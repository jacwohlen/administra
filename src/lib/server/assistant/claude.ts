import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { env } from '$env/dynamic/private';
import type { ModelSettings } from './prompts';
import { AssistantError } from './request';

/**
 * The Claude API behind the Daten-Assistent (docs/AI_ASSISTANT.md).
 *
 * Configured with PRIVATE_ANTHROPIC_API_KEY, read at runtime like the SMTP
 * settings: without it the assistant is simply not offered. Optional:
 * PRIVATE_ASSISTANT_MODEL (default claude-opus-5-5), PRIVATE_ASSISTANT_EFFORT
 * (low, medium or high; default low — transcription needs little
 * reasoning and every second counts against the Netlify function limit)
 * and PRIVATE_ASSISTANT_TIMEOUT_MS (default 50 s, below Netlify's 60 s).
 */

export const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_TIMEOUT_MS = 50_000;

export function isAssistantConfigured(): boolean {
  return Boolean(env.PRIVATE_ANTHROPIC_API_KEY?.trim());
}

export function modelSettings(): ModelSettings {
  const effort = env.PRIVATE_ASSISTANT_EFFORT?.trim();
  return {
    model: env.PRIVATE_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL,
    effort: effort === 'medium' || effort === 'high' ? effort : 'low'
  };
}

function timeoutMs(): number {
  const value = Number(env.PRIVATE_ASSISTANT_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 5_000 && value <= 300_000 ? value : DEFAULT_TIMEOUT_MS;
}

let client: { key: string; anthropic: Anthropic } | null = null;

function getClient(): Anthropic {
  const key = env.PRIVATE_ANTHROPIC_API_KEY?.trim() ?? '';
  if (client?.key !== key) {
    // No retries: a retry would rarely fit into the function's time limit,
    // and the user can simply try again.
    client = {
      key,
      anthropic: new Anthropic({ apiKey: key, timeout: timeoutMs(), maxRetries: 0 })
    };
  }
  return client.anthropic;
}

/**
 * Maps an SDK error to our codes. Only the class and status are logged:
 * API error messages can quote the request.
 */
export function apiError(err: unknown): AssistantError {
  if (err instanceof AssistantError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AssistantError('timeout', 504);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AssistantError('timeout', 504);
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    console.error('Assistant: the Anthropic API rejected the key');
    return new AssistantError('not_configured', 503);
  }
  if (err instanceof Anthropic.RateLimitError) return new AssistantError('busy', 503);
  if (err instanceof Anthropic.InternalServerError) return new AssistantError('busy', 503);
  if (err instanceof Anthropic.APIConnectionError) return new AssistantError('busy', 503);
  if (err instanceof Anthropic.APIError) {
    console.error(`Assistant: Anthropic API error ${err.status ?? ''} ${err.name}`);
    return new AssistantError('failed', 502);
  }
  console.error('Assistant: unexpected error', err instanceof Error ? err.name : typeof err);
  return new AssistantError('failed', 500);
}

export async function createMessage(
  params: MessageCreateParamsNonStreaming,
  signal?: AbortSignal
): Promise<BetaMessage> {
  try {
    return await getClient().beta.messages.create(params, { signal });
  } catch (err) {
    throw apiError(err);
  }
}

export interface Extraction {
  /** The parsed JSON, still unchecked */
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** Token counts of a message, cache reads and writes included. */
export function usageOf(message: Pick<BetaMessage, 'usage'>): {
  inputTokens: number;
  outputTokens: number;
} {
  const u = message.usage;
  return {
    inputTokens:
      (u?.input_tokens ?? 0) +
      (u?.cache_creation_input_tokens ?? 0) +
      (u?.cache_read_input_tokens ?? 0),
    outputTokens: u?.output_tokens ?? 0
  };
}

/**
 * The JSON answer of a finished message. A declined request (also after the
 * fallback model), a cut-off answer or anything but JSON is an error; the
 * parse error itself is dropped since its message quotes the text.
 */
export function readAnswer(message: BetaMessage): Extraction {
  if (message.stop_reason === 'refusal') throw new AssistantError('refused', 422);
  if (message.stop_reason === 'max_tokens') throw new AssistantError('incomplete', 422);
  if (message.stop_reason !== 'end_turn') throw new AssistantError('invalid_output', 502);
  const text = message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AssistantError('invalid_output', 502);
  }
  return { raw, ...usageOf(message) };
}

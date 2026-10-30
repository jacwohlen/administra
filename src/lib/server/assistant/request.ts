import { isIsoDate } from '$lib/assistant/proposals';
import {
  ASSISTANT_LIMITS,
  ASSISTANT_MEDIA_TYPES,
  isAssistantKind,
  type AssistantContext,
  type AssistantErrorCode,
  type AssistantFile,
  type AssistantMediaType,
  type AssistantRequest
} from '$lib/assistant/types';

/** A failure with the error code and HTTP status /api/assistant answers with. */
export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    readonly status: number
  ) {
    super(code);
    this.name = 'AssistantError';
  }
}

const invalid = () => new AssistantError('invalid_request', 400);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** The first bytes of each accepted type, so a renamed file is caught. */
function hasSignature(mediaType: AssistantMediaType, base64: string): boolean {
  const head = Buffer.from(base64.slice(0, 16), 'base64');
  const ascii = (from: number, to: number) => head.subarray(from, to).toString('latin1');
  switch (mediaType) {
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png':
      return ascii(0, 8) === '\x89PNG\r\n\x1a\n';
    case 'image/gif':
      return ascii(0, 4) === 'GIF8';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
  }
}

function parseFile(value: unknown): AssistantFile {
  if (!value || typeof value !== 'object') throw invalid();
  const { name, mediaType, data } = value as Record<string, unknown>;
  if (!ASSISTANT_MEDIA_TYPES.includes(mediaType as AssistantMediaType)) throw invalid();
  if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0) throw invalid();
  if (!BASE64.test(data)) throw invalid();
  if (!hasSignature(mediaType as AssistantMediaType, data)) throw invalid();
  return {
    name: typeof name === 'string' ? name.slice(0, 200) : '',
    mediaType: mediaType as AssistantMediaType,
    data
  };
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseContext(value: unknown): AssistantContext {
  const c = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const date = typeof c.date === 'string' && isIsoDate(c.date) ? c.date : undefined;
  return {
    memberId: positiveInt(c.memberId),
    trainingId: positiveInt(c.trainingId),
    date
  };
}

/**
 * Checks the JSON body of POST /api/assistant: a known kind, at most
 * ASSISTANT_LIMITS.maxFiles files of the accepted types (by their bytes,
 * not just their name), sizes within the limits, and the context the kind
 * needs. Throws AssistantError (400 / 413).
 */
export function parseAssistantRequest(body: unknown): AssistantRequest {
  if (!body || typeof body !== 'object') throw invalid();
  const b = body as Record<string, unknown>;
  if (!isAssistantKind(b.kind)) throw invalid();

  const rawFiles = b.files ?? [];
  if (!Array.isArray(rawFiles)) throw invalid();
  if (rawFiles.length > ASSISTANT_LIMITS.maxFiles) throw new AssistantError('too_large', 413);
  const files = rawFiles.map(parseFile);
  const total = files.reduce((sum, f) => sum + decodedSize(f.data), 0);
  if (total > ASSISTANT_LIMITS.maxTotalBytes) throw new AssistantError('too_large', 413);

  const text = typeof b.text === 'string' ? b.text : '';
  const hint = typeof b.hint === 'string' ? b.hint : '';
  if (
    text.length > ASSISTANT_LIMITS.maxTextLength ||
    hint.length > ASSISTANT_LIMITS.maxHintLength
  ) {
    throw new AssistantError('too_large', 413);
  }
  if (files.length === 0 && !text.trim()) throw invalid();

  const context = parseContext(b.context);
  if (b.kind === 'attendance' && !context.trainingId) throw invalid();
  if (b.kind === 'lesson_plan' && (!context.trainingId || !context.date)) throw invalid();

  return {
    kind: b.kind,
    files,
    text,
    hint,
    locale: b.locale === 'en' ? 'en' : 'de',
    context
  };
}

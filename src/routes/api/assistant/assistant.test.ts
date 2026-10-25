import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = { PRIVATE_ANTHROPIC_API_KEY: 'sk-test' };
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/trialMailContext', () => ({
  loadMailSettings: vi.fn().mockResolvedValue({ club: { sections: ['Judo', 'Aikido'] } })
}));

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', async (original) => {
  const actual = await original<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    static APIError = actual.default.APIError;
    static APIUserAbortError = actual.default.APIUserAbortError;
    static APIConnectionError = actual.default.APIConnectionError;
    static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;
    static AuthenticationError = actual.default.AuthenticationError;
    static PermissionDeniedError = actual.default.PermissionDeniedError;
    static RateLimitError = actual.default.RateLimitError;
    static InternalServerError = actual.default.InternalServerError;
    beta = { messages: { create } };
  }
  return { default: FakeAnthropic };
});

const { GET, POST } = await import('./+server');

type Rpc = (fn: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>;

function locals(rpc: Rpc, session: object | null = { user: {} }) {
  return {
    safeGetSession: async () => ({ session, user: null }),
    supabase: {
      rpc: vi.fn(rpc),
      from: () => ({
        select: () => ({
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
        })
      })
    }
  };
}

async function post(body: unknown, l: ReturnType<typeof locals>) {
  const request = new Request('http://localhost/api/assistant', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const response = await POST({ request, locals: l } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, body: await response.json() };
}

const okRpc: Rpc = async (fn) =>
  fn === 'ai_import_begin'
    ? { data: [{ id: 7, remaining: 41 }], error: null }
    : { data: null, error: null };

beforeEach(() => {
  create.mockReset();
  env.PRIVATE_ANTHROPIC_API_KEY = 'sk-test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/assistant', () => {
  it('says whether the assistant is configured', async () => {
    const l = locals(async () => ({ data: 12, error: null }));
    const response = await GET({ locals: l } as unknown as Parameters<typeof GET>[0]);
    expect(await response.json()).toEqual({ configured: true, remaining: 12 });

    env.PRIVATE_ANTHROPIC_API_KEY = '';
    const off = await GET({ locals: l } as unknown as Parameters<typeof GET>[0]);
    expect(await off.json()).toEqual({ configured: false, remaining: null });
  });
});

describe('POST /api/assistant', () => {
  const body = { kind: 'events', text: 'Kids Cup am 14.11.2026 in Wohlen' };

  it('needs a session', async () => {
    const result = await post(body, locals(okRpc, null));
    expect(result).toEqual({ status: 401, body: { code: 'unauthorized' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('is off without an API key', async () => {
    env.PRIVATE_ANTHROPIC_API_KEY = undefined;
    expect((await post(body, locals(okRpc))).body.code).toBe('not_configured');
  });

  it('does not call the model when the role or the limit says no', async () => {
    const forbidden = await post(
      body,
      locals(async () => ({ data: null, error: { code: '42501', message: 'NOT_ALLOWED' } }))
    );
    expect(forbidden).toEqual({ status: 403, body: { code: 'forbidden' } });
    const quota = await post(
      body,
      locals(async () => ({ data: null, error: { code: 'PT429', message: 'too many' } }))
    );
    expect(quota).toEqual({ status: 429, body: { code: 'quota' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns the checked proposal and logs the usage', async () => {
    create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            events: [{ title: 'Kids Cup', date: '2026-11-14', section: 'Judo', extra: 'x' }],
            warnings: []
          })
        }
      ],
      usage: { input_tokens: 900, output_tokens: 120 }
    });
    const l = locals(okRpc);
    const result = await post(body, l);
    expect(result.status).toBe(200);
    expect(result.body.remaining).toBe(41);
    expect(result.body.proposal.events[0]).toMatchObject({ title: 'Kids Cup', date: '2026-11-14' });
    expect(result.body.proposal.events[0]).not.toHaveProperty('extra');
    expect(l.supabase.rpc).toHaveBeenCalledWith('ai_import_finish', {
      p_id: 7,
      p_status: 'ok',
      p_input_tokens: 900,
      p_output_tokens: 120
    });
    const params = create.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
    expect(params.model).toBe('claude-opus-5-5');
  });

  it('logs a refusal and answers with its code', async () => {
    create.mockResolvedValue({ stop_reason: 'refusal', content: [], usage: { input_tokens: 5 } });
    const l = locals(okRpc);
    expect(await post(body, l)).toEqual({ status: 422, body: { code: 'refused' } });
    expect(l.supabase.rpc).toHaveBeenCalledWith(
      'ai_import_finish',
      expect.objectContaining({ p_status: 'refused' })
    );
  });

  it('answers invalid JSON and oversized bodies before anything else', async () => {
    const l = locals(okRpc);
    const request = new Request('http://localhost/api/assistant', { method: 'POST', body: '{' });
    const response = await POST({ request, locals: l } as unknown as Parameters<typeof POST>[0]);
    expect(response.status).toBe(400);
    const big = await post({ kind: 'events', text: 'x'.repeat(5_100_000) }, l);
    expect(big.status).toBe(413);
    expect(l.supabase.rpc).not.toHaveBeenCalled();
  });
});

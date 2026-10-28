import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The `demo` action of the login page (src/routes/+page.server.ts). PUBLIC_MODE
 * is a static import, so each test loads the module afresh with its own mode.
 */

type Actions = (typeof import('./+page.server'))['actions'];

async function loadActions(mode: string): Promise<Actions> {
  vi.resetModules();
  vi.doMock('$env/static/public', () => ({
    PUBLIC_MODE: mode,
    PUBLIC_SUPABASE_DATABASE_URL: 'http://localhost',
    PUBLIC_SUPABASE_ANON_KEY: 'anon'
  }));
  return (await import('./+page.server')).actions;
}

function demoEvent(
  form: Record<string, string>,
  signInWithPassword: ReturnType<typeof vi.fn>,
  clientAddress = '203.0.113.7'
) {
  return {
    getClientAddress: () => clientAddress,
    request: new Request('http://localhost/?/demo', {
      method: 'POST',
      body: new URLSearchParams(form)
    }),
    locals: { supabase: { auth: { signInWithPassword } } }
  } as never;
}

async function run(actions: Actions, event: never): Promise<unknown> {
  try {
    return await actions.demo(event);
  } catch (thrown) {
    return thrown;
  }
}

afterEach(() => {
  vi.doUnmock('$env/static/public');
  vi.restoreAllMocks();
});

describe('demo action in DEMO mode', () => {
  let actions: Actions;
  beforeEach(async () => {
    actions = await loadActions('DEMO');
  });

  it.each([
    ['admin', 'vorstand@demo.administra.ch'],
    ['trainer', 'trainer@demo.administra.ch'],
    ['member', 'mitglied@demo.administra.ch']
  ])('signs %s in with the mapped account and redirects to /', async (role, email) => {
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    const result = await run(actions, demoEvent({ role }, signIn));
    expect(result).toMatchObject({ status: 303, location: '/' });
    expect(signIn).toHaveBeenCalledOnce();
    expect(signIn).toHaveBeenCalledWith({ email, password: 'administra-demo' });
  });

  it.each(['viewer', '__proto__', 'constructor', '', 'ADMIN'])(
    'rejects the role %j with 400 without touching auth',
    async (role) => {
      const signIn = vi.fn();
      const result = await run(actions, demoEvent({ role }, signIn));
      expect(result).toMatchObject({ status: 400, data: { demoError: 'unknownRole' } });
      expect(signIn).not.toHaveBeenCalled();
    }
  );

  it('rejects a missing role and ignores e-mail/password fields', async () => {
    const signIn = vi.fn();
    const result = await run(
      actions,
      demoEvent({ email: 'someone@example.com', password: 'secret' }, signIn)
    );
    expect(result).toMatchObject({ status: 400, data: { demoError: 'unknownRole' } });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('never signs in with credentials sent along with a valid role', async () => {
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    await run(
      actions,
      demoEvent({ role: 'member', email: 'x@example.com', password: 'p' }, signIn)
    );
    expect(signIn).toHaveBeenCalledWith({
      email: 'mitglied@demo.administra.ch',
      password: 'administra-demo'
    });
  });

  it('throttles each client address before it reaches auth', async () => {
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    for (let i = 0; i < 10; i++) {
      expect(await run(actions, demoEvent({ role: 'admin' }, signIn))).toMatchObject({
        status: 303
      });
    }
    const blocked = await run(actions, demoEvent({ role: 'admin' }, signIn));
    expect(blocked).toMatchObject({ status: 429, data: { demoError: 'tooManyAttempts' } });
    expect(signIn).toHaveBeenCalledTimes(10);

    const other = await run(actions, demoEvent({ role: 'admin' }, signIn, '198.51.100.1'));
    expect(other).toMatchObject({ status: 303 });
  });

  it('does not count unknown roles against the throttle', async () => {
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    for (let i = 0; i < 20; i++) await run(actions, demoEvent({ role: 'nope' }, signIn));
    expect(await run(actions, demoEvent({ role: 'admin' }, signIn))).toMatchObject({
      status: 303
    });
  });

  it('answers 503 without the raw error when sign-in fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signIn = vi
      .fn()
      .mockResolvedValue({ data: {}, error: new Error('Invalid login credentials') });
    const result = await run(actions, demoEvent({ role: 'admin' }, signIn));
    expect(result).toMatchObject({ status: 503, data: { demoError: 'signInFailed' } });
    expect(JSON.stringify((result as { data: unknown }).data)).not.toContain('Invalid');
    expect(consoleError).toHaveBeenCalled();
  });
});

describe.each(['PROD', 'DEV'])('demo action in %s mode', (mode) => {
  it('answers 404 and never signs in', async () => {
    const actions = await loadActions(mode);
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    const result = await run(actions, demoEvent({ role: 'admin' }, signIn));
    expect(result).toMatchObject({ status: 404 });
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('login action', () => {
  it('stays unavailable in DEMO mode', async () => {
    const actions = await loadActions('DEMO');
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    let result: unknown;
    try {
      result = await actions.login(
        demoEvent({ email: 'vorstand@demo.administra.ch', password: 'administra-demo' }, signIn)
      );
    } catch (thrown) {
      result = thrown;
    }
    expect(result).toMatchObject({ status: 404 });
    expect(signIn).not.toHaveBeenCalled();
  });
});

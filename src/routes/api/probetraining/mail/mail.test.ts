import { describe, expect, it, vi } from 'vitest';

const mailMode = vi.fn(() => 'smtp');
vi.mock('$lib/server/mailer', () => ({ mailMode, sendMail: vi.fn() }));
vi.mock('$lib/server/trialMailContext', () => ({ loadMailSettings: vi.fn() }));

const { GET } = await import('./+server');

const locals = (signedIn = true) => ({
  safeGetSession: async () => ({ session: signedIn ? { user: {} } : null })
});

describe('GET /api/probetraining/mail', () => {
  it('says mails leave only with SMTP, never in the demo', async () => {
    for (const [mode, configured] of [
      ['smtp', true],
      ['demo', false],
      ['off', false]
    ] as const) {
      mailMode.mockReturnValue(mode);
      const res = await GET({ locals: locals() } as never);
      expect(await res.json()).toEqual({ configured });
    }
  });

  it('needs a session', async () => {
    await expect(GET({ locals: locals(false) } as never)).rejects.toMatchObject({ status: 401 });
  });
});

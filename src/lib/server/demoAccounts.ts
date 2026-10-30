/**
 * Sign-in accounts of the public demo (PUBLIC_MODE=DEMO, demo.administra.jacwohlen.ch).
 *
 * These credentials are public by design: the demo login page offers one
 * button per role and the `demo` action of src/routes/+page.server.ts signs
 * in with the matching account. They only exist in the demo's own Supabase
 * project, which supabase/demo/seed.sql resets every week with a made-up
 * club; the club's Dev and Prod projects have no such accounts, so these
 * values open nothing there. See docs/DEMO.md.
 *
 * Kept under $lib/server so client code cannot import it; the browser only
 * ever sends a role name.
 */

export const DEMO_ROLES = ['admin', 'trainer', 'member'] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];

export interface DemoAccount {
  email: string;
  password: string;
}

const DEMO_PASSWORD = 'administra-demo';

export const DEMO_ACCOUNTS: Readonly<Record<DemoRole, Readonly<DemoAccount>>> = Object.freeze({
  // Vorstand: approved admin
  admin: Object.freeze({ email: 'vorstand@demo.administra.jacwohlen.ch', password: DEMO_PASSWORD }),
  // Trainer/in: approved trainer, exam_role examiner
  trainer: Object.freeze({
    email: 'trainer@demo.administra.jacwohlen.ch',
    password: DEMO_PASSWORD
  }),
  // Mitglied/Eltern: member account of two children
  member: Object.freeze({ email: 'mitglied@demo.administra.jacwohlen.ch', password: DEMO_PASSWORD })
});

/**
 * The account for a role sent by the login form, or null for anything that
 * is not exactly one of DEMO_ROLES (also inherited keys like `__proto__`).
 */
export function demoAccountFor(role: unknown): Readonly<DemoAccount> | null {
  if (typeof role !== 'string') return null;
  if (!(DEMO_ROLES as readonly string[]).includes(role)) return null;
  return DEMO_ACCOUNTS[role as DemoRole];
}

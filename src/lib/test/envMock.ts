import { variables } from '../../env';

type EnvValues = Record<string, string | undefined>;

/**
 * A stand-in for `$app/env/public` / `$app/env/private` in unit tests: every
 * variable declared in src/env.ts, unset unless given. A vitest mock throws
 * on an export it does not have, so a module reading an optional variable
 * needs the key present.
 *
 *   vi.mock('$app/env/public', async () =>
 *     (await import('#lib/test/envMock.ts')).envMock({ PUBLIC_MODE: 'DEV' })
 *   );
 */
export function envMock(values: EnvValues = {}): EnvValues {
  const env: EnvValues = {};
  for (const name of Object.keys(variables)) env[name] = undefined;
  return Object.assign(env, values);
}

/** Unsets every variable of a mutable envMock() object, then sets `values`. */
export function resetEnv(env: EnvValues, values: EnvValues = {}): void {
  for (const name of Object.keys(env)) env[name] = undefined;
  Object.assign(env, values);
}

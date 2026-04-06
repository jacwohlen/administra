import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser
      }
    }
  },
  {
    rules: {
      // New rules from eslint-plugin-svelte v3 — disable to maintain parity with
      // previous config. Enable these incrementally in future PRs.
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/require-each-key': 'off',
      'svelte/no-reactive-reassign': 'off',
      'svelte/no-reactive-functions': 'off',
      'svelte/no-immutable-reactive-statements': 'off',
      'svelte/require-event-dispatcher-types': 'off',
      'svelte/no-useless-mustaches': 'off',
      'svelte/valid-prop-names-in-kit-pages': 'off',
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    ignores: ['build/', '.svelte-kit/', 'dist/', 'package/']
  }
);

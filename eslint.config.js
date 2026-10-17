import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

const nodeOnlyGlobals = Object.keys(globals.node).filter(
  (name) => !(name in globals.browser)
);
const browserOnlyGlobals = Object.keys(globals.browser).filter(
  (name) => !(name in globals.node)
);
const serverFiles = [
  'src/lib/server/**',
  'src/**/*.server.{js,mjs,cjs,ts,mts,cts}',
  'src/**/+server.{js,mjs,cjs,ts,mts,cts}',
  'src/**/*.test.{js,mjs,cjs,ts,mts,cts}'
];

export default ts.config(
  {
    ignores: [
      'node_modules/**',
      '.svelte-kit/**',
      'build/**',
      'drizzle/meta/**',
      'playwright-report/**',
      'test-results/**',
      '.ci-reports/**',
      '.fixtures/**'
    ]
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: browserOnlyGlobals,
          checkGlobalObject: true,
          globalObjects: ['global']
        }
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/**/*.{js,mjs,cjs,ts,mts,cts,svelte}'],
    ignores: serverFiles,
    languageOptions: {
      globals: {
        ...Object.fromEntries(nodeOnlyGlobals.map((name) => [name, 'off'])),
        ...globals.browser
      }
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { globals: nodeOnlyGlobals, checkGlobalObject: true }
      ]
    }
  },
  {
    // Playwright files execute in Node and contain browser-side evaluate callbacks.
    files: ['tests/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-restricted-globals': 'off' }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } }
  }
);

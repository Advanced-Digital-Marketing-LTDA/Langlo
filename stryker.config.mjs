// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
    '!src/**/*.gen.ts',
    '!src/lib/server/db/drizzle.config.ts'
  ],
  testRunner: 'command',
  commandRunner: { command: 'npx vitest run' },
  ignorePatterns: ['.claude', '.agents', '.codex'],
  reporters: ['progress', 'clear-text', 'html']
};
export default config;

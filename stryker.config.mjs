// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export const mutationScopes = [
  {
    name: 'prototype-results',
    mutate: ['src/lib/prototype/results.ts'],
    tests: ['tests/prototype-results.test.ts']
  },
  {
    name: 'assessment',
    mutate: ['src/lib/server/assessment.ts'],
    tests: ['tests/assessment.test.ts', 'tests/assessment-routes.test.ts']
  },
  {
    name: 'assessment-answer',
    mutate: ['src/lib/server/assessment-answer.ts'],
    tests: ['tests/assessment-routes.test.ts']
  },
  {
    name: 'mastery',
    mutate: ['src/lib/server/mastery.ts'],
    tests: ['tests/mastery.test.ts', 'tests/mastery.pbt.test.ts']
  },
  {
    name: 'progress',
    mutate: ['src/lib/server/progress.ts'],
    tests: ['tests/progress-routes.test.ts']
  },
  {
    name: 'fallback',
    mutate: ['src/lib/server/evaluation/fallback.ts'],
    tests: [
      'tests/fallback-evaluation.test.ts',
      'tests/fallback-runtime.test.ts',
      'tests/attempt-fallback.test.ts'
    ]
  }
];

const scopeName = process.env.LANGLO_STRYKER_SCOPE ?? mutationScopes[0].name;
const scope = mutationScopes.find(({ name }) => name === scopeName);
if (!scope) throw new Error(`Unknown LANGLO_STRYKER_SCOPE: ${scopeName}`);

const config = {
  mutate: scope.mutate,
  testRunner: 'command',
  commandRunner: { command: `npx vitest run ${scope.tests.join(' ')}` },
  concurrency: 4,
  timeoutMS: 30000,
  thresholds: { break: 80 },
  ignorePatterns: ['.claude', '.agents', '.codex', 'test-results'],
  reporters: ['progress', 'clear-text', 'html'],
  htmlReporter: { fileName: `reports/mutation/${scope.name}.html` }
};
export default config;

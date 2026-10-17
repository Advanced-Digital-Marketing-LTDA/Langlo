import { expect, it } from 'vitest';
import type { MutationTestResult } from 'mutation-testing-report-schema';
import { validateMutationReport } from '../scripts/validate-stryker-report.mjs';

const scope = {
  name: 'example',
  mutate: ['src/example.ts'],
  tests: ['tests/example.test.ts']
};
function report(): MutationTestResult {
  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60 },
    testFiles: {
      'tests/example.test.ts': {
        tests: [{ id: 'test-1', name: 'rejects bad input' }]
      }
    },
    files: {
      'src/example.ts': {
        language: 'typescript',
        source: 'export const valid = true;',
        mutants: [
          {
            id: 'mutant-1',
            mutatorName: 'BooleanLiteral',
            status: 'Killed',
            coveredBy: ['test-1'],
            killedBy: ['test-1'],
            testsCompleted: 1,
            statusReason: 'expected false to be true',
            location: {
              start: { line: 1, column: 22 },
              end: { line: 1, column: 26 }
            }
          }
        ]
      }
    }
  };
}

it('reports individual test coverage and successful execution counts', () => {
  expect(validateMutationReport(report(), scope)).toMatchObject({
    tests: 1,
    mutants: 1,
    killed: 1,
    survived: 0,
    noCoverage: 0,
    ignored: 0
  });
});

it('rejects empty mutant reports instead of accepting a NaN score', () => {
  const value = report();
  value.files['src/example.ts'].mutants = [];
  expect(() => validateMutationReport(value, scope)).toThrow(
    /example.*no mutants/s
  );
});

it.each(['RuntimeError', 'CompileError', 'Pending'] as const)(
  'fails on %s with source location and reason',
  (status) => {
    const value = report();
    Object.assign(value.files['src/example.ts'].mutants[0], {
      status,
      statusReason: 'synthetic failure'
    });
    expect(() => validateMutationReport(value, scope)).toThrow(
      /example.*src\/example.ts:1:22.*mutant-1.*synthetic failure/s
    );
  }
);

it('rejects a survivor with zero completed tests', () => {
  const value = report();
  Object.assign(value.files['src/example.ts'].mutants[0], {
    status: 'Survived',
    testsCompleted: 0
  });
  expect(() => validateMutationReport(value, scope)).toThrow(
    /zero.*tests|no.*tests/s
  );
});

it('rejects missing coverage and dangling test references', () => {
  const value = report();
  value.files['src/example.ts'].mutants[0].coveredBy = [];
  expect(() => validateMutationReport(value, scope)).toThrow(/coverage/s);
  value.files['src/example.ts'].mutants[0].coveredBy = ['missing'];
  expect(() => validateMutationReport(value, scope)).toThrow(/missing/);
});

it('rejects a killed mutant without a named killing test or failure explanation', () => {
  const value = report();
  value.files['src/example.ts'].mutants[0].killedBy = [];
  expect(() => validateMutationReport(value, scope)).toThrow(/killing test/s);
  value.files['src/example.ts'].mutants[0].killedBy = ['test-1'];
  value.files['src/example.ts'].mutants[0].statusReason = '';
  expect(() => validateMutationReport(value, scope)).toThrow(
    /failure explanation/s
  );
});

it('rejects a report from another scope', () => {
  expect(() =>
    validateMutationReport(report(), { ...scope, mutate: ['src/other.ts'] })
  ).toThrow(/source scope/s);
});

it('reports uncovered, ignored and timeout mutants separately', () => {
  const value = report();
  const original = value.files['src/example.ts'].mutants[0];
  value.files['src/example.ts'].mutants.push(
    {
      ...original,
      id: 'uncovered',
      status: 'NoCoverage',
      coveredBy: [],
      killedBy: [],
      testsCompleted: undefined
    },
    {
      ...original,
      id: 'static',
      status: 'Ignored',
      coveredBy: [],
      killedBy: [],
      testsCompleted: undefined,
      statusReason: 'Static mutant (ignoreStatic)'
    },
    {
      ...original,
      id: 'timeout',
      status: 'Timeout',
      killedBy: [],
      testsCompleted: undefined
    }
  );
  expect(validateMutationReport(value, scope)).toMatchObject({
    mutants: 4,
    killed: 1,
    noCoverage: 1,
    ignored: 1,
    timeout: 1
  });
});

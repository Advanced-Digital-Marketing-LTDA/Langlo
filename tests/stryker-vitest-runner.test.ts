import { expect, it, vi } from 'vitest';
import { DryRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';
import { guardVitestRun } from '../scripts/stryker-vitest-runner.mjs';

const file = `${process.cwd()}/tests/example.test.ts`;
const testId =
  'tests/example.test.ts#outer suite inner suite rejects bad input';
const tasks = () => [
  {
    type: 'test',
    name: 'rejects bad input',
    file: { filepath: file },
    suite: {
      type: 'suite',
      name: 'inner suite',
      suite: { type: 'suite', name: 'outer suite' }
    }
  }
];
const success = () => ({
  status: DryRunStatus.Complete,
  tests: [
    {
      id: testId,
      name: 'rejects bad input',
      status: TestStatus.Success,
      timeSpentMs: 1
    }
  ]
});

it('runs the named nested test using Vitest 5 separators without changing coverage IDs', async () => {
  const nativeRun = vi.fn().mockResolvedValue(success());
  const run = guardVitestRun(nativeRun, tasks);
  await run({ relatedFiles: ['src/example.ts'] });
  expect(await run({ testIds: [testId] })).toEqual(success());
  expect(nativeRun).toHaveBeenLastCalledWith({
    testIds: [
      'tests/example.test.ts#outer suite > inner suite > rejects bad input'
    ]
  });
});

it('collects test names for a new parallel worker before its first mutant', async () => {
  const nativeRun = vi.fn().mockResolvedValue(success());
  let files: ReturnType<typeof tasks> = [];
  const collectFiles = vi.fn(async () => {
    files = tasks();
  });
  const run = guardVitestRun(nativeRun, () => files, collectFiles);
  expect(await run({ testIds: [testId] })).toEqual(success());
  expect(collectFiles).toHaveBeenCalledWith(['tests/example.test.ts']);
  expect(nativeRun).toHaveBeenCalledWith({
    testIds: [
      'tests/example.test.ts#outer suite > inner suite > rejects bad input'
    ]
  });
});

it.each([
  { tests: [] },
  { tests: [{ ...success().tests[0], status: TestStatus.Skipped }] }
])('rejects a completed run that executed no tests', async ({ tests }) => {
  const run = guardVitestRun(
    vi.fn().mockResolvedValue({ status: DryRunStatus.Complete, tests }),
    tasks
  );
  const result = await run({ relatedFiles: ['src/example.ts'] });
  expect(result).toMatchObject({
    status: DryRunStatus.Error,
    errorMessage: expect.stringMatching(/zero tests.*src\/example.ts/s)
  });
});

it('rejects an unknown coverage test ID instead of silently running nothing', async () => {
  const nativeRun = vi.fn().mockResolvedValue(success());
  const run = guardVitestRun(nativeRun, tasks);
  await run();
  expect(await run({ testIds: ['missing#test'] })).toMatchObject({
    status: DryRunStatus.Error,
    errorMessage: expect.stringContaining('missing#test')
  });
  expect(nativeRun).toHaveBeenCalledTimes(1);
});

it('keeps native runner errors and adds the affected files', async () => {
  const run = guardVitestRun(
    vi.fn().mockResolvedValue({
      status: DryRunStatus.Error,
      errorMessage: 'synthetic import failure'
    }),
    tasks
  );
  expect(await run({ relatedFiles: ['src/example.ts'] })).toMatchObject({
    status: DryRunStatus.Error,
    errorMessage: expect.stringMatching(
      /src\/example.ts.*synthetic import failure/s
    )
  });
});

it('describes a thrown error with an empty message using its type, test and stack', async () => {
  const run = guardVitestRun(
    vi.fn().mockResolvedValue({
      status: DryRunStatus.Complete,
      tests: [
        {
          ...success().tests[0],
          status: TestStatus.Failed,
          failureMessage: ''
        }
      ]
    }),
    () => [
      {
        ...tasks()[0],
        result: {
          errors: [
            {
              name: 'MalformedDecision',
              message: '',
              stack: 'MalformedDecision\n at src/example.ts:192:9'
            }
          ]
        }
      }
    ]
  );
  expect(await run()).toMatchObject({
    tests: [
      {
        failureMessage: expect.stringMatching(
          /rejects bad input.*MalformedDecision.*without a message.*src\/example.ts:192:9/s
        )
      }
    ]
  });
});

it('rejects a failed test with no error details instead of calling it a valid kill', async () => {
  const run = guardVitestRun(
    vi.fn().mockResolvedValue({
      status: DryRunStatus.Complete,
      tests: [
        {
          ...success().tests[0],
          status: TestStatus.Failed,
          failureMessage: ''
        }
      ]
    }),
    tasks
  );
  expect(await run()).toMatchObject({
    status: DryRunStatus.Error,
    errorMessage: expect.stringMatching(/rejects bad input.*no error details/s)
  });
});

it('propagates unexpected runner exceptions with their cause', async () => {
  const cause = new Error('synthetic worker crash');
  const run = guardVitestRun(vi.fn().mockRejectedValue(cause), tasks);
  await expect(run({ relatedFiles: ['src/example.ts'] })).rejects.toMatchObject(
    {
      message: expect.stringMatching(
        /src\/example.ts.*synthetic worker crash/s
      ),
      cause
    }
  );
});

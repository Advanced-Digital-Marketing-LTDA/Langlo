import { describe, expect, it } from 'vitest';
import { parseVitestEvidence } from '../scripts/validate-vitest-evidence.mjs';

type AssertionStatus =
  'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'disabled';

type Report = {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numPendingTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  success: boolean;
  testResults: Array<{
    assertionResults: Array<{ status: string }>;
    status: string;
    name: string;
  }>;
};

function suiteWith(statuses: AssertionStatus[], status = 'passed') {
  return {
    assertionResults: statuses.map((item) => ({ status: item })),
    status,
    name: '/workspace/tests/example.test.ts'
  };
}

function reportWith(
  statuses: AssertionStatus[] = ['passed'],
  overrides: Partial<Report> = {}
): string {
  const count = (status: AssertionStatus) =>
    statuses.filter((item) => item === status).length;
  const failedTestCount = count('failed');
  const passedTestCount = count('passed');
  const pendingTestCount =
    count('skipped') + count('pending') + count('disabled');
  const todoTestCount = count('todo');
  const suiteStatus = failedTestCount === 0 ? 'passed' : 'failed';
  const report: Report = {
    numTotalTestSuites: 1,
    numPassedTestSuites: failedTestCount === 0 ? 1 : 0,
    numFailedTestSuites: failedTestCount > 0 ? 1 : 0,
    numPendingTestSuites: 0,
    numTotalTests: statuses.length,
    numPassedTests: passedTestCount,
    numFailedTests: failedTestCount,
    numPendingTests: pendingTestCount,
    numTodoTests: todoTestCount,
    success: failedTestCount === 0,
    testResults: [suiteWith(statuses, suiteStatus)],
    ...overrides
  };
  return JSON.stringify(report);
}

function parsedReport(
  statuses: AssertionStatus[] = ['passed'],
  overrides: Partial<Report> = {}
): Report {
  return JSON.parse(reportWith(statuses, overrides)) as Report;
}

describe('Vitest report evidence validation', () => {
  it('accepts a non-empty report and derives counts from its test results', () => {
    expect(parseVitestEvidence(reportWith())).toEqual({
      suiteCount: 1,
      testCount: 1,
      passedTestCount: 1,
      failedTestCount: 0,
      skippedTestCount: 0
    });
  });

  it('accepts a report with failures when it also records passed assertions', () => {
    expect(parseVitestEvidence(reportWith(['passed', 'failed']))).toEqual({
      suiteCount: 1,
      testCount: 2,
      passedTestCount: 1,
      failedTestCount: 1,
      skippedTestCount: 0
    });
  });

  it('accepts a report where every executed assertion failed', () => {
    expect(parseVitestEvidence(reportWith(['failed', 'failed']))).toEqual({
      suiteCount: 1,
      testCount: 2,
      passedTestCount: 0,
      failedTestCount: 2,
      skippedTestCount: 0
    });
  });

  it('accepts partially skipped, pending, todo, and disabled tests', () => {
    expect(
      parseVitestEvidence(
        reportWith(['passed', 'skipped', 'pending', 'todo', 'disabled'])
      )
    ).toEqual({
      suiteCount: 1,
      testCount: 5,
      passedTestCount: 1,
      failedTestCount: 0,
      skippedTestCount: 2
    });
  });

  it.each(['', 'not json', 'null', '[]'])(
    'rejects an invalid report: %s',
    (source) => {
      expect(() => parseVitestEvidence(source)).toThrow();
    }
  );

  it('rejects a report with no executed tests', () => {
    const noAssertions = parsedReport();
    noAssertions.numTotalTests = 0;
    noAssertions.numPassedTests = 0;
    noAssertions.testResults = [];
    expect(() => parseVitestEvidence(JSON.stringify(noAssertions))).toThrow(
      /no test results/u
    );

    expect(() => parseVitestEvidence(reportWith(['skipped', 'todo']))).toThrow(
      /executed/u
    );
    expect(() =>
      parseVitestEvidence(reportWith(['skipped', 'skipped']))
    ).toThrow(/executed/u);
  });

  it('rejects unknown statuses and mismatched assertion counters', () => {
    const invalidStatus = parsedReport();
    const [firstSuite] = invalidStatus.testResults;
    if (!firstSuite) {
      throw new Error('fixture must contain a suite');
    }
    const [firstAssertion] = firstSuite.assertionResults;
    if (!firstAssertion) {
      throw new Error('fixture must contain an assertion');
    }
    firstAssertion.status = 'unknown';
    expect(() => parseVitestEvidence(JSON.stringify(invalidStatus))).toThrow(
      /status/u
    );

    const mismatchedTotal = parsedReport();
    mismatchedTotal.numTotalTests = 2;
    expect(() => parseVitestEvidence(JSON.stringify(mismatchedTotal))).toThrow(
      /does not match/u
    );

    const mismatchedPassed = parsedReport();
    mismatchedPassed.numPassedTests = 0;
    expect(() => parseVitestEvidence(JSON.stringify(mismatchedPassed))).toThrow(
      /numPassedTests count/u
    );

    const mismatchedPending = parsedReport(['passed', 'skipped']);
    mismatchedPending.numPendingTests = 0;
    expect(() =>
      parseVitestEvidence(JSON.stringify(mismatchedPending))
    ).toThrow(/numPendingTests count/u);

    const mismatchedTodo = parsedReport(['passed', 'todo']);
    mismatchedTodo.numTodoTests = 0;
    expect(() => parseVitestEvidence(JSON.stringify(mismatchedTodo))).toThrow(
      /numTodoTests count/u
    );
  });

  it('rejects suite counters that disagree with the test results', () => {
    const fewerSuitesThanFiles = parsedReport(['passed'], {
      numTotalTests: 2,
      numPassedTests: 2
    });
    fewerSuitesThanFiles.testResults.push(suiteWith(['passed']));
    expect(() =>
      parseVitestEvidence(JSON.stringify(fewerSuitesThanFiles))
    ).toThrow(/suite counters/u);

    const missingFailedSuite = parsedReport(['failed']);
    missingFailedSuite.numFailedTestSuites = 0;
    missingFailedSuite.numPassedTestSuites = 1;
    expect(() =>
      parseVitestEvidence(JSON.stringify(missingFailedSuite))
    ).toThrow(/suite counters/u);

    const missingPassedSuite = parsedReport();
    missingPassedSuite.numPassedTestSuites = 0;
    missingPassedSuite.numPendingTestSuites = 1;
    expect(() =>
      parseVitestEvidence(JSON.stringify(missingPassedSuite))
    ).toThrow(/suite counters/u);

    const mismatchedSuiteTotal = parsedReport();
    mismatchedSuiteTotal.numTotalTestSuites = 2;
    expect(() =>
      parseVitestEvidence(JSON.stringify(mismatchedSuiteTotal))
    ).toThrow(/suite counters/u);

    const negativeSuites = parsedReport();
    negativeSuites.numPendingTestSuites = -1;
    expect(() => parseVitestEvidence(JSON.stringify(negativeSuites))).toThrow(
      /suite counters/u
    );
  });

  it('accepts pending suite counters produced by incomplete or todo suites', () => {
    const report = parsedReport();
    report.numTotalTestSuites = 2;
    report.numPendingTestSuites = 1;
    expect(parseVitestEvidence(JSON.stringify(report))).toEqual({
      suiteCount: 1,
      testCount: 1,
      passedTestCount: 1,
      failedTestCount: 0,
      skippedTestCount: 0
    });
  });

  it('rejects success flags and suite statuses that disagree', () => {
    const mismatchedSuiteStatus = parsedReport();
    const [suite] = mismatchedSuiteStatus.testResults;
    if (!suite) {
      throw new Error('fixture must contain a suite');
    }
    suite.status = 'failed';
    expect(() =>
      parseVitestEvidence(JSON.stringify(mismatchedSuiteStatus))
    ).toThrow(/suite counters/u);

    const incorrectSuccessFlag = parsedReport();
    incorrectSuccessFlag.success = false;
    expect(() =>
      parseVitestEvidence(JSON.stringify(incorrectSuccessFlag))
    ).toThrow(/success flag/u);
  });
});

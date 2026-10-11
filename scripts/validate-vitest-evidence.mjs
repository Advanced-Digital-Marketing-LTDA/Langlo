import { error as logError, log } from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readReportFile } from './report-path.mjs';

const ASSERTION_STATUSES = new Set([
  'passed',
  'failed',
  'skipped',
  'pending',
  'todo',
  'disabled'
]);

/** @param {string} source */
function requireReportObject(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('Vitest report is empty');
  }

  let report;
  try {
    report = JSON.parse(source);
  } catch {
    throw new Error('Vitest report is not valid JSON');
  }

  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('Vitest report must be a JSON object');
  }

  if (!Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new TypeError('Vitest report contains no test results');
  }

  if (
    !Number.isSafeInteger(report.numTotalTests) ||
    report.numTotalTests <= 0
  ) {
    throw new TypeError('Vitest report must declare a positive test count');
  }

  return report;
}

/** @param {unknown[]} testResults */
function collectAssertions(testResults) {
  return testResults.flatMap((suite) => {
    if (
      suite === null ||
      typeof suite !== 'object' ||
      !['passed', 'failed'].includes(suite.status) ||
      !Array.isArray(suite.assertionResults)
    ) {
      throw new TypeError(
        'Vitest report contains a suite without assertion results'
      );
    }
    return suite.assertionResults;
  });
}

/** @param {unknown[]} assertions */
function countAssertionStatuses(assertions) {
  const counts = new Map([...ASSERTION_STATUSES].map((status) => [status, 0]));
  for (const assertion of assertions) {
    if (
      assertion === null ||
      typeof assertion !== 'object' ||
      !ASSERTION_STATUSES.has(assertion.status)
    ) {
      throw new TypeError('Vitest report contains an unknown assertion status');
    }
    counts.set(assertion.status, (counts.get(assertion.status) ?? 0) + 1);
  }
  return counts;
}

/** @param {Map<string, number>} counts */
function assertExecutedAssertions(counts) {
  const executed = (counts.get('passed') ?? 0) + (counts.get('failed') ?? 0);
  if (executed === 0) {
    throw new Error('Vitest report contains no executed assertions');
  }
}

/** @param {Map<string, number>} counts */
function assertTestCounters(report, counts) {
  const pendingTestCount =
    (counts.get('skipped') ?? 0) +
    (counts.get('pending') ?? 0) +
    (counts.get('disabled') ?? 0);
  const counters = [
    ['numPassedTests', report.numPassedTests, counts.get('passed') ?? 0],
    ['numFailedTests', report.numFailedTests, counts.get('failed') ?? 0],
    ['numPendingTests', report.numPendingTests, pendingTestCount],
    ['numTodoTests', report.numTodoTests, counts.get('todo') ?? 0]
  ];
  for (const [name, value, expected] of counters) {
    if (!Number.isSafeInteger(value) || value < 0 || value !== expected) {
      throw new Error(
        `Vitest report ${name} count does not match assertion statuses`
      );
    }
  }

  const executedAndTotal =
    (counts.get('passed') ?? 0) +
    (counts.get('failed') ?? 0) +
    pendingTestCount +
    (counts.get('todo') ?? 0);
  if (report.numTotalTests !== executedAndTotal) {
    throw new Error('Vitest report test counters do not add up to the total');
  }
}

/**
 * Tie the declared suite counters to the actual per-file test results. Every
 * file contributes at least itself as a suite, and every file marked failed
 * or passed must be reflected in the matching suite counter.
 */
function assertSuiteCounters(report, testResults) {
  const failedFiles = testResults.filter(
    (suite) => suite.status === 'failed'
  ).length;
  const passedFiles = testResults.length - failedFiles;
  if (
    !Number.isSafeInteger(report.numTotalTestSuites) ||
    report.numTotalTestSuites < testResults.length ||
    !Number.isSafeInteger(report.numFailedTestSuites) ||
    report.numFailedTestSuites < failedFiles ||
    !Number.isSafeInteger(report.numPassedTestSuites) ||
    report.numPassedTestSuites < passedFiles ||
    !Number.isSafeInteger(report.numPendingTestSuites) ||
    report.numPendingTestSuites < 0 ||
    report.numPassedTestSuites +
      report.numFailedTestSuites +
      report.numPendingTestSuites !==
      report.numTotalTestSuites
  ) {
    throw new Error('Vitest report suite counters are missing or inconsistent');
  }
}

function assertSuccessFlag(report, failedTestCount) {
  const expectedSuccess =
    failedTestCount === 0 &&
    report.numFailedTestSuites === 0 &&
    !report.testResults.some((suite) => suite.status === 'failed');
  if (
    typeof report.success !== 'boolean' ||
    report.success !== expectedSuccess
  ) {
    throw new Error(
      'Vitest report success flag does not match its test results'
    );
  }
}

/**
 * Parse the Vitest/Jest-compatible JSON report and reject absent or hollow
 * evidence: reports in which no assertion executed at all. Test failures
 * remain valid evidence; the test step and Merge-Evidence Gate decide
 * whether those failures should fail the workflow.
 *
 * @param {string} source
 * @returns {{ suiteCount: number, testCount: number, passedTestCount: number, failedTestCount: number, skippedTestCount: number }}
 */
export function parseVitestEvidence(source) {
  const report = requireReportObject(source);
  const assertions = collectAssertions(report.testResults);

  if (assertions.length === 0) {
    throw new Error('Vitest report contains no test results');
  }
  if (assertions.length !== report.numTotalTests) {
    throw new Error(
      `Vitest report test count ${report.numTotalTests} does not match ${assertions.length} assertion results`
    );
  }

  const counts = countAssertionStatuses(assertions);
  assertExecutedAssertions(counts);
  assertTestCounters(report, counts);
  assertSuiteCounters(report, report.testResults);
  assertSuccessFlag(report, counts.get('failed') ?? 0);

  return {
    suiteCount: report.testResults.length,
    testCount: assertions.length,
    passedTestCount: counts.get('passed') ?? 0,
    failedTestCount: counts.get('failed') ?? 0,
    skippedTestCount:
      (counts.get('skipped') ?? 0) + (counts.get('disabled') ?? 0)
  };
}

function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error(
      'Usage: node scripts/validate-vitest-evidence.mjs <report-path>'
    );
  }

  const summary = parseVitestEvidence(readReportFile(reportPath));
  log(
    `Validated Vitest evidence: ${summary.passedTestCount}/${summary.testCount} passed across ${summary.suiteCount} suites (${summary.failedTestCount} failed, ${summary.skippedTestCount} skipped/disabled)`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError(`Invalid Vitest evidence: ${message}`);
    process.exitCode = 1;
  }
}

import assert from 'node:assert/strict';

/** Sorted by locale, so both sides of a comparison order paths the same way. */
const sorted = (/** @type {string[]} */ names) =>
  [...names].sort((a, b) => a.localeCompare(b));

/**
 * @param {import('mutation-testing-report-schema').MutationTestResult} report
 * @param {{name: string, mutate: string[], tests: string[]}} scope
 * @param {string} prefix
 */
function assertScope(report, scope, prefix) {
  assert.deepEqual(
    sorted(Object.keys(report.files)),
    sorted(scope.mutate),
    `${prefix}: report source scope does not match the requested files.`
  );
  assert.deepEqual(
    sorted(Object.keys(report.testFiles ?? {})),
    sorted(scope.tests),
    `${prefix}: report test scope does not match the requested files.`
  );
}

/**
 * @param {import('mutation-testing-report-schema').MutationTestResult} report
 * @param {string} prefix
 */
function namedTests(report, prefix) {
  const tests = Object.values(report.testFiles ?? {}).flatMap(
    (file) => file.tests
  );
  assert(
    tests.length && tests.every(({ name }) => name && name !== 'All tests'),
    `${prefix}: no individual named tests in the report.`
  );
  const testIds = new Set(tests.map(({ id }) => id));
  assert.equal(
    testIds.size,
    tests.length,
    `${prefix}: duplicate test IDs in the report.`
  );
  return { tests, testIds };
}

/**
 * Check one tested mutant and return which counter it belongs to.
 * @param {import('mutation-testing-report-schema').MutantResult} mutant
 * @param {(message: string) => string} fail
 */
function testedOutcome(mutant, fail) {
  assert(mutant.coveredBy?.length, fail('missing per-test coverage'));
  if (mutant.status === 'Killed' || mutant.status === 'Survived')
    assert(
      (mutant.testsCompleted ?? 0) > 0,
      fail(
        'zero completed tests; a mutation result cannot pass without executing tests'
      )
    );
  if (mutant.status === 'Killed') {
    assert(mutant.killedBy?.length, fail('missing named killing test'));
    assert(mutant.statusReason?.trim(), fail('missing failure explanation'));
    return 'killed';
  }
  if (mutant.status === 'Survived') return 'survived';
  assert.equal(
    mutant.status,
    'Timeout',
    fail(`unknown result status ${mutant.status}`)
  );
  return 'timeout';
}

/**
 * Check one mutant and return which summary counter it belongs to.
 * @param {import('mutation-testing-report-schema').MutantResult} mutant
 * @param {(message: string) => string} fail
 */
function outcomeOf(mutant, fail) {
  if (mutant.status === 'Ignored') {
    assert(mutant.statusReason, fail('ignored without an explanation'));
    return 'ignored';
  }
  if (mutant.status === 'NoCoverage') return 'noCoverage';
  return testedOutcome(mutant, fail);
}

/**
 * @param {import('mutation-testing-report-schema').MutantResult} mutant
 * @param {(message: string) => string} fail
 * @param {Set<string>} testIds
 */
function assertValidMutant(mutant, fail, testIds) {
  assert(
    !['RuntimeError', 'CompileError', 'Pending'].includes(mutant.status),
    fail(
      `${mutant.status}: ${mutant.statusReason || 'No error reason supplied by the runner.'}`
    )
  );
  for (const id of [...(mutant.coveredBy ?? []), ...(mutant.killedBy ?? [])])
    assert(testIds.has(id), fail(`unknown test reference ${id}`));
}

/**
 * @param {import('mutation-testing-report-schema').MutationTestResult} report
 * @param {{name: string, mutate: string[], tests: string[]}} scope
 */
export function validateMutationReport(report, scope) {
  const prefix = `Stryker scope ${scope.name}`;
  assertScope(report, scope, prefix);
  const { tests, testIds } = namedTests(report, prefix);
  const covering = new Set();
  const killing = new Set();
  const summary = {
    tests: tests.length,
    mutants: 0,
    killed: 0,
    survived: 0,
    timeout: 0,
    noCoverage: 0,
    ignored: 0,
    coveringTests: 0,
    killingTests: 0
  };
  for (const [file, result] of Object.entries(report.files)) {
    for (const mutant of result.mutants) {
      const location = `${prefix}: ${file}:${mutant.location.start.line}:${mutant.location.start.column} mutant ${mutant.id} (${mutant.mutatorName})`;
      const fail = (/** @type {string} */ message) => `${location}: ${message}`;
      assertValidMutant(mutant, fail, testIds);
      mutant.coveredBy?.forEach((id) => covering.add(id));
      mutant.killedBy?.forEach((id) => killing.add(id));
      summary.mutants++;
      summary[outcomeOf(mutant, fail)]++;
    }
  }
  assert(
    summary.mutants > summary.ignored,
    `${prefix}: no mutants were tested (empty or entirely ignored scope).`
  );
  summary.coveringTests = covering.size;
  summary.killingTests = killing.size;
  return summary;
}

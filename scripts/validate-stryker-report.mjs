import assert from 'node:assert/strict';

/**
 * @param {import('mutation-testing-report-schema').MutationTestResult} report
 * @param {{name: string, mutate: string[], tests: string[]}} scope
 */
export function validateMutationReport(report, scope) {
  const prefix = `Stryker scope ${scope.name}`;
  assert.deepEqual(
    Object.keys(report.files).sort(),
    [...scope.mutate].sort(),
    `${prefix}: report source scope does not match the requested files.`
  );
  assert.deepEqual(
    Object.keys(report.testFiles ?? {}).sort(),
    [...scope.tests].sort(),
    `${prefix}: report test scope does not match the requested files.`
  );
  const tests = Object.values(report.testFiles ?? {}).flatMap(
    (file) => file.tests
  );
  const testIds = new Set(tests.map(({ id }) => id));
  assert(
    tests.length && tests.every(({ name }) => name && name !== 'All tests'),
    `${prefix}: no individual named tests in the report.`
  );
  assert.equal(
    testIds.size,
    tests.length,
    `${prefix}: duplicate test IDs in the report.`
  );
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
      assert(
        !['RuntimeError', 'CompileError', 'Pending'].includes(mutant.status),
        fail(
          `${mutant.status}: ${mutant.statusReason || 'No error reason supplied by the runner.'}`
        )
      );
      for (const id of [
        ...(mutant.coveredBy ?? []),
        ...(mutant.killedBy ?? [])
      ])
        assert(testIds.has(id), fail(`unknown test reference ${id}`));
      mutant.coveredBy?.forEach((id) => covering.add(id));
      mutant.killedBy?.forEach((id) => killing.add(id));
      summary.mutants++;
      if (mutant.status === 'Ignored') {
        assert(mutant.statusReason, fail('ignored without an explanation'));
        summary.ignored++;
      } else if (mutant.status === 'NoCoverage') {
        summary.noCoverage++;
      } else {
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
          assert(
            mutant.statusReason?.trim(),
            fail('missing failure explanation')
          );
          summary.killed++;
        } else if (mutant.status === 'Survived') summary.survived++;
        else {
          assert.equal(
            mutant.status,
            'Timeout',
            fail(`unknown result status ${mutant.status}`)
          );
          summary.timeout++;
        }
      }
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

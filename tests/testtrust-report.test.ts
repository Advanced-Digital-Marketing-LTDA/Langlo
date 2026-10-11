import { describe, expect, it } from 'vitest';
import { parseTestTrustReport } from '../scripts/validate-testtrust-report.mjs';

function findingWith(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: 'assertion-weakened',
    severity: 'warn',
    file: 'tests/example.test.ts',
    line: 4,
    message: 'A test assertion was weakened.',
    data: { baseMatcher: 'toEqual', headMatcher: 'toBeTruthy' },
    ...overrides
  };
}

function scoreWith(overrides: Record<string, unknown> = {}) {
  return {
    score: 95,
    verdict: 'neutral',
    failThreshold: 60,
    totalFindings: 1,
    countsBySeverity: { fail: 0, warn: 1, info: 0 },
    breakdown: [{ ruleId: 'assertion-weakened', count: 1, penalty: 5 }],
    ...overrides
  };
}

function reportWith(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: '0.1.9',
    generatedAt: '2026-10-11T00:00:00.000Z',
    mode: 'diff',
    baseRef: 'origin/main',
    filesAnalyzed: 2,
    score: scoreWith(),
    findings: [findingWith()],
    ...overrides
  });
}

const options = {
  baseRef: 'origin/main',
  expectedFileCount: 2,
  cliExitCode: 0,
  failThreshold: 60
};

describe('TestTrust report validation', () => {
  it('accepts a valid report only when it covers every changed unit-test file', () => {
    expect(parseTestTrustReport(reportWith(), options)).toEqual({
      version: '0.1.9',
      filesAnalyzed: 2,
      findingCount: 1,
      verdict: 'neutral',
      score: 95
    });
  });

  it.each(['', 'not json', 'null', '[]'])(
    'rejects an invalid or empty report: %s',
    (source) => {
      expect(() => parseTestTrustReport(source, options)).toThrow();
    }
  );

  it('rejects missing, mismatched, or zero analyzed files', () => {
    expect(() =>
      parseTestTrustReport(reportWith({ filesAnalyzed: 1 }), options)
    ).toThrow(/changed unit-test files/u);
    expect(() =>
      parseTestTrustReport(reportWith({ filesAnalyzed: 0 }), options)
    ).toThrow(/positive number/u);
    expect(() =>
      parseTestTrustReport(reportWith(), { ...options, expectedFileCount: 0 })
    ).toThrow(/skip TestTrust/u);
  });

  it('rejects an unexpected CLI status, base ref, mode, or source version', () => {
    expect(() =>
      parseTestTrustReport(reportWith(), { ...options, cliExitCode: 1 })
    ).toThrow(/exit code/u);
    expect(() =>
      parseTestTrustReport(reportWith({ baseRef: 'origin/other' }), options)
    ).toThrow(/base ref/u);
    expect(() =>
      parseTestTrustReport(reportWith({ mode: 'files' }), options)
    ).toThrow(/diff mode/u);
    expect(() =>
      parseTestTrustReport(reportWith({ version: '0.1.8' }), options)
    ).toThrow(/version/u);
  });

  it('rejects score-only, malformed, and internally inconsistent reports', () => {
    expect(() =>
      parseTestTrustReport(JSON.stringify({ score: { score: 100 } }), options)
    ).toThrow(/report/u);
    expect(() =>
      parseTestTrustReport(
        reportWith({
          score: scoreWith({
            score: 100,
            verdict: 'pass',
            totalFindings: 0,
            countsBySeverity: { fail: 0, warn: 0, info: 0 },
            breakdown: []
          })
        }),
        options
      )
    ).toThrow(/finding count/u);
    expect(() =>
      parseTestTrustReport(
        reportWith({ score: scoreWith({ verdict: 'pass' }) }),
        options
      )
    ).toThrow(/verdict/u);
  });

  it('rejects an inconsistent failure report and invalid findings', () => {
    expect(() =>
      parseTestTrustReport(
        reportWith({
          findings: [findingWith({ ruleId: 'test-skipped', severity: 'fail' })]
        }),
        options
      )
    ).toThrow(/counts|verdict/u);
    expect(() =>
      parseTestTrustReport(
        reportWith({ findings: [{ severity: 'warning' }] }),
        options
      )
    ).toThrow(/finding/u);
  });

  it('rejects a score that is inconsistent with the reported penalties', () => {
    expect(() =>
      parseTestTrustReport(
        reportWith({ score: scoreWith({ score: 100 }) }),
        options
      )
    ).toThrow(/penalty breakdown/u);
  });
});

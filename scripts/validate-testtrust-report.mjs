import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_VERSION = '0.1.9';
const SEVERITIES = ['fail', 'warn', 'info'];

/**
 * Validate TestTrust's CLI status and complete JSON evidence for a diff scan.
 * The report must cover every changed unit-test file selected by the workflow;
 * a score alone or a neutral fallback is never accepted as evidence.
 *
 * @param {string} source
 * @param {{ baseRef: string, expectedFileCount: number, cliExitCode: number, failThreshold: number }} options
 * @returns {{ version: string, filesAnalyzed: number, findingCount: number, verdict: 'pass' | 'neutral' | 'fail', score: number }}
 */
export function parseTestTrustReport(source, options) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('TestTrust report is empty');
  }
  if (
    !Number.isSafeInteger(options.expectedFileCount) ||
    options.expectedFileCount < 1
  ) {
    throw new Error(
      'No changed unit-test files; skip TestTrust instead of validating a report'
    );
  }
  if (options.cliExitCode !== 0) {
    throw new Error(
      `TestTrust CLI did not succeed (exit code ${options.cliExitCode})`
    );
  }
  if (
    !Number.isInteger(options.failThreshold) ||
    options.failThreshold < 0 ||
    options.failThreshold > 100
  ) {
    throw new Error(
      'TestTrust fail threshold must be an integer from 0 to 100'
    );
  }

  let report;
  try {
    report = JSON.parse(source);
  } catch {
    throw new Error('TestTrust report is not valid JSON');
  }

  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('TestTrust report must be a JSON object');
  }
  if (report.version !== EXPECTED_VERSION) {
    throw new Error(`TestTrust report version must be ${EXPECTED_VERSION}`);
  }
  if (report.mode !== 'diff') {
    throw new Error('TestTrust report must be generated in diff mode');
  }
  if (report.baseRef !== options.baseRef) {
    throw new Error(
      'TestTrust report base ref does not match the requested base ref'
    );
  }
  if (
    typeof report.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(report.generatedAt))
  ) {
    throw new Error(
      'TestTrust report must include a valid generation timestamp'
    );
  }
  if (!Number.isSafeInteger(report.filesAnalyzed) || report.filesAnalyzed < 1) {
    throw new Error(
      'TestTrust report must include a positive number of analyzed files'
    );
  }
  if (report.filesAnalyzed !== options.expectedFileCount) {
    throw new Error(
      `TestTrust analyzed ${report.filesAnalyzed} files, but ${options.expectedFileCount} changed unit-test files were selected`
    );
  }
  if (!Array.isArray(report.findings)) {
    throw new Error('TestTrust report must include a findings array');
  }

  const severityCounts = { fail: 0, warn: 0, info: 0 };
  const ruleCounts = new Map();
  for (const finding of report.findings) {
    if (
      finding === null ||
      typeof finding !== 'object' ||
      typeof finding.ruleId !== 'string' ||
      finding.ruleId.length === 0 ||
      !SEVERITIES.includes(finding.severity) ||
      typeof finding.file !== 'string' ||
      finding.file.length === 0 ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      typeof finding.message !== 'string' ||
      finding.message.length === 0
    ) {
      throw new Error('TestTrust report contains an invalid finding');
    }
    severityCounts[finding.severity] += 1;
    ruleCounts.set(finding.ruleId, (ruleCounts.get(finding.ruleId) ?? 0) + 1);
  }

  const score = report.score;
  if (score === null || typeof score !== 'object' || Array.isArray(score)) {
    throw new Error(
      'TestTrust report must include complete score and finding details'
    );
  }
  if (
    !Number.isSafeInteger(score.score) ||
    score.score < 0 ||
    score.score > 100
  ) {
    throw new Error('TestTrust report score must be an integer from 0 to 100');
  }
  if (!['pass', 'neutral', 'fail'].includes(score.verdict)) {
    throw new Error('TestTrust report verdict is invalid');
  }
  if (score.failThreshold !== options.failThreshold) {
    throw new Error(
      'TestTrust report fail threshold does not match the requested threshold'
    );
  }
  if (
    !Number.isSafeInteger(score.totalFindings) ||
    score.totalFindings !== report.findings.length
  ) {
    throw new Error(
      'TestTrust report finding count does not match its findings array'
    );
  }

  if (
    score.countsBySeverity === null ||
    typeof score.countsBySeverity !== 'object'
  ) {
    throw new Error('TestTrust report must include finding counts by severity');
  }
  for (const severity of SEVERITIES) {
    if (score.countsBySeverity[severity] !== severityCounts[severity]) {
      throw new Error(
        'TestTrust report severity counts do not match its findings'
      );
    }
  }

  if (!Array.isArray(score.breakdown)) {
    throw new Error(
      'TestTrust report must include a per-rule findings breakdown'
    );
  }
  const breakdownCounts = new Map();
  let totalPenalty = 0;
  for (const entry of score.breakdown) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.ruleId !== 'string' ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 1 ||
      typeof entry.penalty !== 'number' ||
      !Number.isFinite(entry.penalty) ||
      entry.penalty < 0
    ) {
      throw new Error(
        'TestTrust report contains an invalid per-rule breakdown'
      );
    }
    if (breakdownCounts.has(entry.ruleId)) {
      throw new Error(
        'TestTrust report contains a duplicate per-rule breakdown'
      );
    }
    breakdownCounts.set(entry.ruleId, entry.count);
    totalPenalty += entry.penalty;
  }
  if (
    breakdownCounts.size !== ruleCounts.size ||
    [...ruleCounts].some(
      ([ruleId, count]) => breakdownCounts.get(ruleId) !== count
    )
  ) {
    throw new Error(
      'TestTrust report per-rule breakdown does not match its findings'
    );
  }
  const scoreFromBreakdown = Math.max(
    0,
    Math.min(100, Math.round(100 - totalPenalty))
  );
  if (score.score !== scoreFromBreakdown) {
    throw new Error(
      'TestTrust report score does not match its per-rule penalty breakdown'
    );
  }

  let expectedVerdict = 'pass';
  if (severityCounts.fail > 0 || score.score < options.failThreshold) {
    expectedVerdict = 'fail';
  } else if (severityCounts.warn > 0) {
    expectedVerdict = 'neutral';
  }
  if (score.verdict !== expectedVerdict) {
    throw new Error(
      'TestTrust report verdict is inconsistent with its findings and score'
    );
  }
  if (score.verdict === 'fail') {
    throw new Error('TestTrust reported a failing test-integrity verdict');
  }

  return {
    version: report.version,
    filesAnalyzed: report.filesAnalyzed,
    findingCount: report.findings.length,
    verdict: score.verdict,
    score: score.score
  };
}

function main() {
  const [
    ,
    ,
    reportPath,
    baseRef,
    expectedFilesRaw,
    cliExitRaw,
    failThresholdRaw
  ] = process.argv;
  if (
    !reportPath ||
    !baseRef ||
    !expectedFilesRaw ||
    !cliExitRaw ||
    !failThresholdRaw
  ) {
    throw new Error(
      'Usage: node scripts/validate-testtrust-report.mjs <report> <base-ref> <expected-files> <cli-exit-code> <fail-threshold>'
    );
  }
  const expectedFileCount = Number(expectedFilesRaw);
  const cliExitCode = Number(cliExitRaw);
  const failThreshold = Number(failThresholdRaw);
  const summary = parseTestTrustReport(
    readFileSync(resolve(process.cwd(), reportPath), 'utf8'),
    { baseRef, expectedFileCount, cliExitCode, failThreshold }
  );
  console.log(
    `Validated TestTrust evidence: ${summary.filesAnalyzed} files, ${summary.findingCount} findings, ${summary.verdict} (${summary.score}/100)`
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
    console.error(`Invalid TestTrust evidence: ${message}`);
    process.exitCode = 1;
  }
}

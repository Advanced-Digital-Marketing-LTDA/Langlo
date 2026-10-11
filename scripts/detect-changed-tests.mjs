import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Collection rules mirror the runners exactly: vitest.config.ts includes
// src/**/*.test.ts and tests/**/*.test.ts minus tests/e2e, and Playwright
// collects *.{test,spec}.{js,ts,mjs,cjs} under tests/e2e only. Anything that
// looks like a test but matches no collected pattern fails the gate closed.
const TEST_NAMED = /^(src|tests)\/.*\.(test|spec)\.[cm]?[jt]sx?$/u;
const TESTS_DIR = /^(src|tests)\/(.+\/)?__tests?__\/.*\.[cm]?[jt]sx?$/u;
const VITEST_COLLECTED = /^(src|tests)\/.*\.test\.ts$/u;
const PLAYWRIGHT_COLLECTED = /^tests\/e2e\/.*\.(test|spec)\.[cm]?[jt]s$/u;
const E2E_PREFIX = 'tests/e2e/';

/** @param {string} path */
export const isTestPath = (path) =>
  TEST_NAMED.test(path) || TESTS_DIR.test(path);
/** @param {string} path */
export const isVitestCollectedPath = (path) =>
  VITEST_COLLECTED.test(path) && !path.startsWith(E2E_PREFIX);
/** @param {string} path */
export const isPlaywrightCollectedPath = (path) =>
  PLAYWRIGHT_COLLECTED.test(path);
/** @param {string} path */
export const isCollectedPath = (path) =>
  isVitestCollectedPath(path) || isPlaywrightCollectedPath(path);
export const isTesttrustPath = isVitestCollectedPath;
/** @param {string} path */
export const isUncollectedTestPath = (path) =>
  isTestPath(path) && !isCollectedPath(path);

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
const git = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {boolean}
 */
const gitOk = (args, cwd) => {
  try {
    git(args, cwd);
    return true;
  } catch {
    return false;
  }
};

// Resolve the diff base for the event. A no-divergence push materializes a
// real empty-root commit so every downstream consumer (git diff and the
// TestTrust --base commit argument) receives a commit object, never a bare
// tree hash. Fails closed: an advertised base that does not resolve is an
// error, not a skipped audit.
/**
 * @param {object} options
 * @param {string} options.eventName
 * @param {string | undefined} options.eventBefore
 * @param {string | undefined} options.baseRef
 * @param {string | undefined} options.defaultBranch
 * @param {string} options.cwd
 * @param {string[]} options.notices
 * @returns {string} resolved base ref or commit sha
 */
export function resolveBaseRef({
  eventName,
  eventBefore,
  baseRef,
  defaultBranch,
  cwd,
  notices
}) {
  if (eventName === 'pull_request') return `origin/${baseRef}`;
  let base = '';
  if (eventBefore && !/^0+$/u.test(eventBefore)) {
    if (
      gitOk(['cat-file', '-e', `${eventBefore}^{commit}`], cwd) &&
      gitOk(['merge-base', '--is-ancestor', eventBefore, 'HEAD'], cwd)
    ) {
      base = eventBefore;
    } else {
      notices.push(
        `Push 'before' SHA ${eventBefore} is unreachable or not an ancestor of HEAD (force-push or rebase); using the default-branch merge-base.`
      );
    }
  }
  if (!base) {
    try {
      base = git(
        ['merge-base', `origin/${defaultBranch || 'main'}`, 'HEAD'],
        cwd
      );
    } catch {
      base = '';
    }
  }
  if (!base || base === git(['rev-parse', 'HEAD'], cwd)) {
    notices.push(
      'No divergent merge-base with the default branch; diffing against the empty tree so every test file is scanned.'
    );
    const emptyTree = git(['hash-object', '-t', 'tree', '/dev/null'], cwd);
    base = git(
      [
        '-c',
        'user.name=langlo-ci',
        '-c',
        'user.email=langlo-ci@localhost',
        'commit-tree',
        emptyTree,
        '-m',
        'Synthetic empty diff base'
      ],
      cwd
    );
  }
  return base;
}

// Parse `git diff --name-status -z --find-renames` records into
// { status, path, newPath } entries; renames/copies carry both paths.
/**
 * @param {string[]} records
 * @returns {{ status: string, path: string, newPath?: string }[]}
 */
export function parseNameStatus(records) {
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index];
    if (!status) continue;
    if (/^[RC]/u.test(status)) {
      if (index + 2 >= records.length) {
        throw new Error('Git returned an incomplete rename/copy record');
      }
      entries.push({
        status,
        path: records[index + 1],
        newPath: records[index + 2]
      });
      index += 2;
    } else {
      entries.push({ status, path: records[index + 1] });
      index += 1;
    }
  }
  return entries;
}

/**
 * @param {object} options
 * @param {string} options.eventName
 * @param {string | undefined} options.eventBefore
 * @param {string | undefined} options.baseRef
 * @param {string | undefined} options.defaultBranch
 * @param {string} [options.cwd]
 * @returns {{
 *   baseRef: string,
 *   changedUnitTests: string[],
 *   deletedTestPaths: string[],
 *   uncollectedTestPaths: string[],
 *   renamedTestOutOfScope: number,
 *   notices: string[]
 * }}
 */
export function detectChangedTests({
  eventName,
  eventBefore,
  baseRef,
  defaultBranch,
  cwd = process.cwd()
}) {
  /** @type {string[]} */
  const notices = [];
  const resolvedBase = resolveBaseRef({
    eventName,
    eventBefore,
    baseRef,
    defaultBranch,
    cwd,
    notices
  });
  if (!gitOk(['cat-file', '-e', resolvedBase], cwd)) {
    throw new Error(
      `Unable to resolve diff base '${resolvedBase}' for changed-test detection`
    );
  }
  const diff = execFileSync(
    'git',
    ['diff', '--name-status', '-z', '--find-renames', resolvedBase, 'HEAD'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const entries = parseNameStatus(diff.split('\0'));
  const changedUnitTests = [];
  const deletedTestPaths = [];
  const uncollectedTestPaths = [];
  let renamedTestOutOfScope = 0;
  for (const entry of entries) {
    if (entry.newPath !== undefined) {
      if (isTesttrustPath(entry.newPath)) changedUnitTests.push(entry.newPath);
      if (isUncollectedTestPath(entry.newPath))
        uncollectedTestPaths.push(entry.newPath);
      if (
        /^R/u.test(entry.status) &&
        isTestPath(entry.path) &&
        !isTestPath(entry.newPath)
      ) {
        renamedTestOutOfScope += 1;
      }
    } else if (entry.status === 'D') {
      if (isTestPath(entry.path)) deletedTestPaths.push(entry.path);
    } else {
      if (isTesttrustPath(entry.path)) changedUnitTests.push(entry.path);
      if (isUncollectedTestPath(entry.path))
        uncollectedTestPaths.push(entry.path);
    }
  }
  return {
    baseRef: resolvedBase,
    changedUnitTests,
    deletedTestPaths,
    uncollectedTestPaths,
    renamedTestOutOfScope,
    notices
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [cwd]
 * @returns {number} process exit code
 */
export function main(env = process.env, cwd = process.cwd()) {
  let result;
  try {
    result = detectChangedTests({
      eventName: env.EVENT_NAME ?? '',
      eventBefore: env.EVENT_BEFORE,
      baseRef: env.BASE_REF,
      defaultBranch: env.DEFAULT_BRANCH,
      cwd
    });
  } catch (error) {
    console.log(
      `::error::${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
  for (const notice of result.notices) console.log(`::notice::${notice}`);
  const runnerTemp = env.RUNNER_TEMP;
  if (!runnerTemp) {
    console.log('::error::RUNNER_TEMP is not set for changed-test detection');
    return 1;
  }
  const changedTestsFile = join(runnerTemp, 'testtrust-changed-tests');
  writeFileSync(
    changedTestsFile,
    result.changedUnitTests.length > 0
      ? `${result.changedUnitTests.join('\0')}\0`
      : ''
  );
  const outputLines = [
    `count=${result.changedUnitTests.length}`,
    `deleted_test_paths=${result.deletedTestPaths.length}`,
    `renamed_test_out_of_scope=${result.renamedTestOutOfScope}`,
    `base_ref=${result.baseRef}`
  ];
  const writeOutputs = () => {
    if (env.GITHUB_OUTPUT)
      appendFileSync(env.GITHUB_OUTPUT, `${outputLines.join('\n')}\n`);
  };
  if (result.deletedTestPaths.length > 0) {
    console.log(
      `::notice::Detected ${result.deletedTestPaths.length} deleted test path(s); Overlock evaluates deletions. TestTrust scans surviving changed unit tests only.`
    );
  }
  if (result.renamedTestOutOfScope > 0) {
    console.log(
      `::error::Detected ${result.renamedTestOutOfScope} test file(s) renamed outside a recognized test path. Keep tests in recognized test paths or retain replacement tests so they remain collected.`
    );
    writeOutputs();
    return 1;
  }
  if (result.uncollectedTestPaths.length > 0) {
    for (const path of result.uncollectedTestPaths) {
      console.log(
        `::error file=${path}::Test-named file is not collected by Vitest (src/tests *.test.ts outside tests/e2e) or Playwright (tests/e2e). Move or rename it into a collected pattern, or remove it.`
      );
    }
    writeOutputs();
    return 1;
  }
  if (result.changedUnitTests.length === 0) {
    outputLines.push('has_tests=false');
    console.log(
      result.deletedTestPaths.length > 0
        ? 'Only deleted tests changed; Overlock handles removals and TestTrust will be skipped.'
        : 'No changed Jest/Vitest-style unit tests; TestTrust will be skipped.'
    );
  } else {
    outputLines.push('has_tests=true');
  }
  writeOutputs();
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Collection rules mirror the runners exactly: vitest.config.ts includes
// src/**/*.test.ts and tests/**/*.test.ts minus tests/e2e, and Playwright
// collects *.{test,spec}.{js,ts,mjs,cjs} under tests/e2e only. Anything that
// looks like a test but matches no collected pattern fails the gate closed.
// Predicates use bounded suffix patterns and segment checks rather than
// unbounded wildcards.
const TEST_SUFFIX = /\.(test|spec)\.[cm]?[jt]sx?$/u;
const JS_EXT = /\.[cm]?[jt]sx?$/u;
const E2E_SUFFIX = /\.(test|spec)\.[cm]?[jt]s$/u;
const E2E_PREFIX = 'tests/e2e/';
const TEST_DIRS = new Set(['__test__', '__tests__']);

/** @param {string} path */
const underSrcOrTests = (path) =>
  path.startsWith('src/') || path.startsWith('tests/');

/** @param {string} path */
export const isTestPath = (path) =>
  underSrcOrTests(path) &&
  (TEST_SUFFIX.test(path) ||
    (JS_EXT.test(path) &&
      path.split('/').some((segment) => TEST_DIRS.has(segment))));

/** @param {string} path */
export const isVitestCollectedPath = (path) =>
  underSrcOrTests(path) &&
  path.endsWith('.test.ts') &&
  !path.startsWith(E2E_PREFIX);

/** @param {string} path */
export const isPlaywrightCollectedPath = (path) =>
  path.startsWith(E2E_PREFIX) && E2E_SUFFIX.test(path);

/** @param {string} path */
export const isCollectedPath = (path) =>
  isVitestCollectedPath(path) || isPlaywrightCollectedPath(path);

export const isTesttrustPath = isVitestCollectedPath;

/** @param {string} path */
export const isUncollectedTestPath = (path) =>
  isTestPath(path) && !isCollectedPath(path);

// Absolute-path default avoids PATH lookup; GIT_BIN overrides for
// environments where git lives elsewhere.
const GIT_BIN = process.env.GIT_BIN ?? '/usr/bin/git';

/**
 * Run a git command; argv is always a fixed option array built here, never
 * shell-interpolated.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
const git = (args, cwd) =>
  execFileSync(GIT_BIN, args, {
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

/**
 * @param {string | undefined} eventBefore
 * @param {string} cwd
 * @returns {string} usable before-SHA or ''
 */
const beforeShaBase = (eventBefore, cwd) => {
  if (!eventBefore || /^0+$/u.test(eventBefore)) return '';
  const usable =
    gitOk(['cat-file', '-e', `${eventBefore}^{commit}`], cwd) &&
    gitOk(['merge-base', '--is-ancestor', eventBefore, 'HEAD'], cwd);
  return usable ? eventBefore : '';
};

/**
 * @param {string | undefined} defaultBranch
 * @param {string} cwd
 * @returns {string} merge-base sha or ''
 */
const mergeBaseSha = (defaultBranch, cwd) => {
  try {
    return git(
      ['merge-base', `origin/${defaultBranch || 'main'}`, 'HEAD'],
      cwd
    );
  } catch {
    return '';
  }
};

/**
 * Write a commit containing the empty tree so downstream consumers (git diff
 * and the TestTrust --base commit argument) receive a commit object, never a
 * bare tree hash.
 * @param {string} cwd
 * @returns {string} commit sha
 */
const emptyRootCommit = (cwd) =>
  git(
    [
      '-c',
      'user.name=langlo-ci',
      '-c',
      'user.email=langlo-ci@localhost',
      'commit-tree',
      git(['hash-object', '-t', 'tree', '/dev/null'], cwd),
      '-m',
      'Synthetic empty diff base'
    ],
    cwd
  );

/**
 * Resolve the diff base for the event. Fails closed: an advertised base that
 * does not resolve is an error, not a skipped audit.
 * @param {object} options
 * @param {string} options.eventName
 * @param {string | undefined} options.eventBefore
 * @param {string | undefined} options.baseRef
 * @param {string | undefined} options.defaultBranch
 * @param {string} options.cwd
 * @param {string[]} options.notices
 * @returns {string} resolved base ref or commit sha
 */
export function resolveBaseRef(options) {
  const { eventName, eventBefore, baseRef, defaultBranch, cwd, notices } =
    options;
  if (eventName === 'pull_request') return `origin/${baseRef}`;
  let base = beforeShaBase(eventBefore, cwd);
  if (eventBefore && !base && !/^0+$/u.test(eventBefore)) {
    notices.push(
      `Push 'before' SHA ${eventBefore} is unreachable or not an ancestor of HEAD (force-push or rebase); using the default-branch merge-base.`
    );
  }
  if (!base) base = mergeBaseSha(defaultBranch, cwd);
  if (!base || base === git(['rev-parse', 'HEAD'], cwd)) {
    notices.push(
      'No divergent merge-base with the default branch; diffing against the empty tree so every test file is scanned.'
    );
    base = emptyRootCommit(cwd);
  }
  return base;
}

// Parse `git diff --name-status -z --find-renames` records into
// { status, path, newPath } entries; renames/copies carry both paths.
// Consumed by iterator so no computed member expressions exist for
// object-injection-sink rules to flag.
/**
 * @param {Iterator<string>} iter
 * @returns {string}
 */
const takePath = (iter) => {
  const next = iter.next();
  if (next.done)
    throw new Error('Git returned an incomplete name-status record');
  return next.value;
};

/**
 * @param {string[]} records
 * @returns {{ status: string, path: string, newPath?: string }[]}
 */
export function parseNameStatus(records) {
  /** @type {{ status: string, path: string, newPath?: string }[]} */
  const entries = [];
  const iter = records[Symbol.iterator]();
  for (const status of iter) {
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      entries.push({
        status,
        path: takePath(iter),
        newPath: takePath(iter)
      });
    } else {
      entries.push({ status, path: takePath(iter) });
    }
  }
  return entries;
}

/**
 * @param {{ status: string, path: string, newPath?: string }} entry
 * @param {object} buckets
 * @param {string[]} buckets.changedUnitTests
 * @param {string[]} buckets.uncollectedTestPaths
 * @param {{ count: number }} buckets.renamed
 */
const classifyRename = (
  entry,
  { changedUnitTests, uncollectedTestPaths, renamed }
) => {
  const target = entry.newPath ?? '';
  if (isTesttrustPath(target)) changedUnitTests.push(target);
  if (isUncollectedTestPath(target)) uncollectedTestPaths.push(target);
  if (
    entry.status.startsWith('R') &&
    isTestPath(entry.path) &&
    !isTestPath(target)
  ) {
    renamed.count += 1;
  }
};

/**
 * @param {{ status: string, path: string, newPath?: string }} entry
 * @param {object} buckets
 * @param {string[]} buckets.changedUnitTests
 * @param {string[]} buckets.deletedTestPaths
 * @param {string[]} buckets.uncollectedTestPaths
 * @param {{ count: number }} buckets.renamed
 */
const classifyEntry = (entry, buckets) => {
  const { changedUnitTests, deletedTestPaths, uncollectedTestPaths, renamed } =
    buckets;
  if (entry.newPath !== undefined) {
    classifyRename(entry, { changedUnitTests, uncollectedTestPaths, renamed });
  } else if (entry.status === 'D') {
    if (isTestPath(entry.path)) deletedTestPaths.push(entry.path);
  } else {
    if (isTesttrustPath(entry.path)) changedUnitTests.push(entry.path);
    if (isUncollectedTestPath(entry.path))
      uncollectedTestPaths.push(entry.path);
  }
};

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
    GIT_BIN,
    ['diff', '--name-status', '-z', '--find-renames', resolvedBase, 'HEAD'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  /** @type {string[]} */
  const changedUnitTests = [];
  /** @type {string[]} */
  const deletedTestPaths = [];
  /** @type {string[]} */
  const uncollectedTestPaths = [];
  const renamed = { count: 0 };
  for (const entry of parseNameStatus(diff.split('\0'))) {
    classifyEntry(entry, {
      changedUnitTests,
      deletedTestPaths,
      uncollectedTestPaths,
      renamed
    });
  }
  return {
    baseRef: resolvedBase,
    changedUnitTests,
    deletedTestPaths,
    uncollectedTestPaths,
    renamedTestOutOfScope: renamed.count,
    notices
  };
}

// The script performs no filesystem I/O. Default mode prints workflow
// annotations and the gate verdict; --emit modes print machine-readable
// output on stdout for the workflow to redirect into $GITHUB_OUTPUT or
// the TestTrust candidate file.
/**
 * @param {{ changedUnitTests: string[], deletedTestPaths: string[], renamedTestOutOfScope: number, baseRef: string }} result
 * @returns {string[]}
 */
const outputLines = (result) => [
  `count=${result.changedUnitTests.length}`,
  `deleted_test_paths=${result.deletedTestPaths.length}`,
  `renamed_test_out_of_scope=${result.renamedTestOutOfScope}`,
  `base_ref=${result.baseRef}`,
  `has_tests=${result.changedUnitTests.length > 0 ? 'true' : 'false'}`
];

/**
 * @param {{ renamedTestOutOfScope: number, uncollectedTestPaths: string[], changedUnitTests: string[], deletedTestPaths: string[] }} result
 * @returns {number}
 */
function reportGate(result) {
  if (result.renamedTestOutOfScope > 0) {
    console.log(
      `::error::Detected ${result.renamedTestOutOfScope} test file(s) renamed outside a recognized test path. Keep tests in recognized test paths or retain replacement tests so they remain collected.`
    );
    return 1;
  }
  if (result.uncollectedTestPaths.length > 0) {
    for (const path of result.uncollectedTestPaths) {
      console.log(
        `::error file=${path}::Test-named file is not collected by Vitest (src/tests *.test.ts outside tests/e2e) or Playwright (tests/e2e). Move or rename it into a collected pattern, or remove it.`
      );
    }
    return 1;
  }
  if (result.changedUnitTests.length === 0) {
    console.log(
      result.deletedTestPaths.length > 0
        ? 'Only deleted tests changed; Overlock handles removals and TestTrust will be skipped.'
        : 'No changed Jest/Vitest-style unit tests; TestTrust will be skipped.'
    );
  }
  return 0;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [cwd]
 * @param {'changed-tests' | 'outputs' | null} [emit]
 * @returns {number} process exit code
 */
export function main(env = process.env, cwd = process.cwd(), emit = null) {
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
    const message = error instanceof Error ? error.message : String(error);
    if (emit) {
      console.error(message);
    } else {
      console.log(`::error::${message}`);
    }
    return 1;
  }
  if (emit === 'changed-tests') {
    if (result.changedUnitTests.length > 0) {
      process.stdout.write(`${result.changedUnitTests.join('\0')}\0`);
    }
    return 0;
  }
  if (emit === 'outputs') {
    console.log(outputLines(result).join('\n'));
    return 0;
  }
  for (const notice of result.notices) console.log(`::notice::${notice}`);
  if (result.deletedTestPaths.length > 0) {
    console.log(
      `::notice::Detected ${result.deletedTestPaths.length} deleted test path(s); Overlock evaluates deletions. TestTrust scans surviving changed unit tests only.`
    );
  }
  return reportGate(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const emitArg = process.argv[2] === '--emit' ? process.argv[3] : null;
  const emit =
    emitArg === 'changed-tests' || emitArg === 'outputs' ? emitArg : null;
  if (process.argv[2] === '--emit' && emit === null) {
    console.error(
      'Usage: detect-changed-tests.mjs [--emit changed-tests|outputs]'
    );
    process.exit(2);
  }
  process.exit(main(process.env, process.cwd(), emit));
}

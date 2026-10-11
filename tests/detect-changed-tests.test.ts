import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectChangedTests,
  isCollectedPath,
  isTestPath,
  isUncollectedTestPath
} from '../scripts/detect-changed-tests.mjs';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'detect-changed-tests.mjs'
);

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const commitFile = (cwd: string, path: string, content: string) => {
  const target = join(cwd, path);
  execFileSync('mkdir', ['-p', dirname(target)]);
  writeFileSync(target, content);
  git(cwd, 'add', path);
  git(cwd, 'commit', '-qm', `add ${path}`);
};

const initRepo = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'langlo-detect-'));
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'fixture@example.test');
  git(cwd, 'config', 'user.name', 'Fixture');
  commitFile(cwd, 'file.txt', 'root');
  commitFile(cwd, 'tests/base.test.ts', 'test');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
};

interface DetectEnv {
  eventName: string;
  eventBefore?: string;
  baseRef?: string;
}

const detect = (cwd: string, env: DetectEnv) =>
  detectChangedTests({
    eventName: env.eventName,
    eventBefore: env.eventBefore,
    baseRef: env.baseRef,
    defaultBranch: 'main',
    cwd
  });

describe('test path classification matches runner collection rules', () => {
  const cases: [string, boolean][] = [
    // path, expected collected (vitest include or playwright testDir)
    ['tests/auth.test.ts', true],
    ['tests/sub/deep.test.ts', true],
    ['src/lib/x.test.ts', true],
    ['tests/foo.pbt.test.ts', true],
    ['tests/e2e/auth.spec.ts', true],
    ['tests/e2e/auth.test.ts', true],
    ['tests/e2e/nested/flow.spec.js', true],
    ['tests/__tests__/unit.test.ts', true],
    ['tests/login.spec.ts', false],
    ['tests/helper.test.js', false],
    ['tests/helper.test.tsx', false],
    ['src/lib/x.test.tsx', false],
    ['tests/e2e/flow.spec.tsx', false],
    ['tests/e2e/nested/helper.ts', false],
    ['tests/__tests__/helper.ts', false],
    ['src/__tests__/fixture.mjs', false],
    ['tests/__test__/util.cjs', false]
  ];
  it.each(cases)('%s collected=%s', (path, collected) => {
    expect(isCollectedPath(path)).toBe(collected);
    if (isTestPath(path)) {
      expect(isUncollectedTestPath(path)).toBe(!collected);
    }
  });

  it('treats non-test-looking files as neither collected nor uncollected', () => {
    expect(isTestPath('src/lib/server/mail.ts')).toBe(false);
    expect(isUncollectedTestPath('src/lib/server/mail.ts')).toBe(false);
    expect(isTestPath('tests/fixtures/flashcards.ts')).toBe(false);
  });
});

describe('diff base resolution against disposable git fixtures', () => {
  it('resolves the origin base for a normal pull request', () => {
    const cwd = initRepo();
    try {
      const baseSha = git(cwd, 'rev-parse', 'refs/remotes/origin/main');
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/new.test.ts', 'test');
      const result = detect(cwd, {
        eventName: 'pull_request',
        baseRef: 'main'
      });
      // The emitted base_ref is the resolvable ref the workflow handed
      // TestTrust; it must name the same commit as the PR base.
      expect(git(cwd, 'rev-parse', result.baseRef)).toBe(baseSha);
      expect(result.changedUnitTests).toEqual(['tests/new.test.ts']);
      expect(result.uncollectedTestPaths).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('uses the event before-SHA for a push when it is an ancestor', () => {
    const cwd = initRepo();
    try {
      const before = git(cwd, 'rev-parse', 'HEAD');
      commitFile(cwd, 'tests/push.test.ts', 'test');
      const result = detect(cwd, { eventName: 'push', eventBefore: before });
      expect(result.baseRef).toBe(before);
      expect(result.changedUnitTests).toEqual(['tests/push.test.ts']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('falls back to the default merge-base on a new branch push', () => {
    const cwd = initRepo();
    try {
      const forkPoint = git(cwd, 'rev-parse', 'HEAD');
      git(cwd, 'checkout', '-qb', 'new-branch');
      commitFile(cwd, 'tests/branch.test.ts', 'test');
      const result = detect(cwd, {
        eventName: 'push',
        eventBefore: '0000000000000000000000000000000000000000'
      });
      expect(result.baseRef).toBe(forkPoint);
      expect(result.changedUnitTests).toEqual(['tests/branch.test.ts']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('materializes a real commit when there is no divergent merge-base', () => {
    const cwd = initRepo();
    try {
      // No divergence: origin/main already points at HEAD, so the merge-base
      // equals HEAD. The resolved base must be a commit TestTrust can accept,
      // not an empty-tree object.
      const result = detect(cwd, { eventName: 'push' });
      expect(git(cwd, 'cat-file', '-t', result.baseRef)).toBe('commit');
      expect(
        git(cwd, 'ls-tree', '--name-only', result.baseRef).split('\n')
      ).toEqual(['']);
      // Diff against the empty root scans every file: the seeded test file
      // is reported as changed rather than silently skipped.
      expect(result.changedUnitTests).toEqual(['tests/base.test.ts']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails closed when the advertised PR base is unavailable', () => {
    const cwd = initRepo();
    try {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/x.test.ts', 'test');
      expect(() =>
        detect(cwd, { eventName: 'pull_request', baseRef: 'missing' })
      ).toThrow(/Unable to resolve diff base/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('uncollected-test gate', () => {
  const runCli = (cwd: string, env: Record<string, string>) => {
    const runnerTemp = mkdtempSync(join(tmpdir(), 'langlo-detect-temp-'));
    const outputFile = join(runnerTemp, 'github-output');
    writeFileSync(outputFile, '');
    const proc = spawnSync('node', [SCRIPT], {
      cwd,
      env: {
        ...process.env,
        EVENT_NAME: 'pull_request',
        BASE_REF: 'main',
        DEFAULT_BRANCH: 'main',
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: outputFile,
        ...env
      },
      encoding: 'utf8'
    });
    const outputs = readFileSync(outputFile, 'utf8');
    rmSync(runnerTemp, { recursive: true, force: true });
    return { proc, outputs };
  };

  it('rejects an added test file under a __tests__ directory without a suffix', () => {
    const cwd = initRepo();
    try {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/__tests__/helper.ts', 'export {}');
      const { proc } = runCli(cwd, {});
      expect(proc.status).toBe(1);
      expect(proc.stdout).toContain('::error file=tests/__tests__/helper.ts::');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a spec-named file outside tests/e2e that vitest never collects', () => {
    const cwd = initRepo();
    try {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/stray.spec.ts', 'test');
      const { proc } = runCli(cwd, {});
      expect(proc.status).toBe(1);
      expect(proc.stdout).toContain('::error file=tests/stray.spec.ts::');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('passes collected vitest tests through to TestTrust unchanged', () => {
    const cwd = initRepo();
    try {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/good.test.ts', 'test');
      const { proc, outputs } = runCli(cwd, {});
      expect(proc.status).toBe(0);
      expect(outputs).toContain('has_tests=true');
      expect(outputs).toContain('count=1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

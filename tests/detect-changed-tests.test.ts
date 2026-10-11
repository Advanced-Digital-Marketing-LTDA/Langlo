import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const commitAll = (cwd: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    const target = join(cwd, path);
    execFileSync('mkdir', ['-p', dirname(target)]);
    writeFileSync(target, content);
    git(cwd, 'add', path);
  }
  git(cwd, 'commit', '-qm', 'root commit');
};

const initRepo = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'langlo-detect-'));
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'fixture@example.test');
  git(cwd, 'config', 'user.name', 'Fixture');
  // Both test shapes land in the ROOT commit: a root..HEAD diff omits them,
  // so the no-divergence fallback proves it scans the whole HEAD tree.
  commitAll(cwd, {
    'file.txt': 'root',
    'tests/base.test.ts': 'test',
    'tests/__tests__/seeded-helper.ts': 'export {}'
  });
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
};

// Run a fixture scenario in a fresh disposable repo, always cleaned up.
const withRepo = (fn: (cwd: string) => void) => {
  const cwd = initRepo();
  try {
    fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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

// path, expected collected (vitest include or playwright testDir)
const COLLECTION_CASES: [string, boolean][] = [
  ['tests/auth.test.ts', true],
  ['tests/sub/deep.test.ts', true],
  ['src/lib/x.test.ts', true],
  ['tests/foo.pbt.test.ts', true],
  ['tests/e2e/auth.spec.ts', true],
  ['tests/e2e/auth.test.ts', true],
  ['tests/e2e/nested/flow.spec.js', true],
  ['tests/e2e/flow.spec.tsx', true],
  ['tests/e2e/form.test.jsx', true],
  ['tests/__tests__/unit.test.ts', true],
  ['tests/login.spec.ts', false],
  ['tests/helper.test.js', false],
  ['tests/helper.test.tsx', false],
  ['src/lib/x.test.tsx', false],
  ['tests/e2e/nested/helper.ts', false],
  ['tests/__tests__/helper.ts', false],
  ['src/__tests__/fixture.mjs', false],
  ['tests/__test__/util.cjs', false]
];

describe('test path classification matches runner collection rules', () => {
  it.each(COLLECTION_CASES)('%s collected=%s', (path, collected) => {
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
    withRepo((cwd) => {
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
    });
  });

  it('uses the event before-SHA for a push when it is an ancestor', () => {
    withRepo((cwd) => {
      const before = git(cwd, 'rev-parse', 'HEAD');
      commitFile(cwd, 'tests/push.test.ts', 'test');
      const result = detect(cwd, { eventName: 'push', eventBefore: before });
      expect(result.baseRef).toBe(before);
      expect(result.changedUnitTests).toEqual(['tests/push.test.ts']);
    });
  });

  it('falls back to the default merge-base on a new branch push', () => {
    withRepo((cwd) => {
      const forkPoint = git(cwd, 'rev-parse', 'HEAD');
      git(cwd, 'checkout', '-qb', 'new-branch');
      commitFile(cwd, 'tests/branch.test.ts', 'test');
      const result = detect(cwd, {
        eventName: 'push',
        eventBefore: '0000000000000000000000000000000000000000'
      });
      expect(result.baseRef).toBe(forkPoint);
      expect(result.changedUnitTests).toEqual(['tests/branch.test.ts']);
    });
  });

  it('scans the whole HEAD tree on a no-divergence push', () => {
    withRepo((cwd) => {
      // No divergence: origin/main already points at HEAD, so the merge-base
      // equals HEAD. The reported base must be a real ancestor — TestTrust's
      // diff mode resolves a merge-base, which a disconnected commit lacks.
      const result = detect(cwd, { eventName: 'push' });
      const root = git(cwd, 'rev-list', '--max-parents=0', 'HEAD');
      expect(result.baseRef).toBe(root);
      expect(git(cwd, 'cat-file', '-t', result.baseRef)).toBe('commit');
      git(cwd, 'merge-base', '--is-ancestor', result.baseRef, 'HEAD');
      // The root commit itself holds the test files: only a full-tree scan
      // (not a root..HEAD diff) can classify them.
      expect(result.changedUnitTests).toEqual(['tests/base.test.ts']);
      expect(result.uncollectedTestPaths).toEqual([
        'tests/__tests__/seeded-helper.ts'
      ]);
    });
  });

  it('fails closed when the advertised PR base is unavailable', () => {
    withRepo((cwd) => {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/x.test.ts', 'test');
      expect(() =>
        detect(cwd, { eventName: 'pull_request', baseRef: 'missing' })
      ).toThrow(/Unable to resolve diff base/u);
    });
  });
});

describe('uncollected-test gate', () => {
  const runScript = (
    cwd: string,
    env: Record<string, string>,
    args: string[] = []
  ) =>
    spawnSync('node', [SCRIPT, ...args], {
      cwd,
      env: {
        ...process.env,
        EVENT_NAME: 'pull_request',
        BASE_REF: 'main',
        DEFAULT_BRANCH: 'main',
        ...env
      },
      encoding: 'utf8'
    });

  const runCli = (cwd: string, env: Record<string, string>) => ({
    proc: runScript(cwd, env),
    outputs: runScript(cwd, env, ['--emit', 'outputs']).stdout ?? ''
  });

  const expectRejection = (path: string, content: string) => {
    withRepo((cwd) => {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, path, content);
      const { proc } = runCli(cwd, {});
      expect(proc.status).toBe(1);
      expect(proc.stdout).toContain(`::error file=${path}::`);
    });
  };

  it('rejects an added test file under a __tests__ directory without a suffix', () => {
    expectRejection('tests/__tests__/helper.ts', 'export {}');
  });

  it('rejects a spec-named file outside tests/e2e that vitest never collects', () => {
    expectRejection('tests/stray.spec.ts', 'test');
  });

  it('passes collected vitest tests through to TestTrust unchanged', () => {
    withRepo((cwd) => {
      git(cwd, 'checkout', '-qb', 'feature');
      commitFile(cwd, 'tests/good.test.ts', 'test');
      const { proc, outputs } = runCli(cwd, {});
      expect(proc.status).toBe(0);
      expect(outputs).toContain('has_tests=true');
      expect(outputs).toContain('count=1');
    });
  });
});

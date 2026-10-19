import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adversarial = readFileSync(
  new URL(
    '../.github/workflows/reusable-adversarial-review.yml',
    import.meta.url
  ),
  'utf8'
);
const claude = readFileSync(
  new URL('../.github/workflows/reusable-claude-review.yml', import.meta.url),
  'utf8'
);

const ossar = readFileSync(
  new URL('../.github/workflows/reusable-ossar.yml', import.meta.url),
  'utf8'
);

const ossarTools = (/^\s+tools:\s*(.+)$/mu.exec(ossar)?.[1] ?? '')
  .toLowerCase()
  .split(',')
  .map((tool) => tool.trim());

describe('reusable OSSAR scan', () => {
  it('runs the policy through security-devops-action, not the fixed ossar-action', () => {
    expect(ossar).toContain('microsoft/security-devops-action@');
    expect(ossar).not.toContain('github/ossar-action');
  });

  it('keeps the GitHub OSSAR policy so detections still reach code scanning', () => {
    expect(ossar).toMatch(/^\s+policy:\s*GitHub\s*$/mu);
  });

  it('names exactly the tools that run, so none is added unnoticed', () => {
    expect(ossarTools).toEqual(['templateanalyzer', 'trivy']);
  });

  it.each([
    [
      'eslint',
      'reports every .ts file as ignored when a repo has no .js files'
    ],
    ['binskim', 'aborts the scan when a repo has no binaries'],
    ['bandit', 'aborts the scan when a repo has no Python files']
  ])('leaves out %s, which %s', (tool) => {
    expect(ossarTools).not.toContain(tool);
  });

  it('pins every third-party action to a full commit SHA', () => {
    const uses = [...ossar.matchAll(/^\s+uses:\s*(\S+)/gmu)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const ref of uses) {
      expect(ref).toMatch(/@[0-9a-f]{40}$/u);
    }
  });

  it('uploads the SARIF file the scan step produced', () => {
    expect(ossar).toContain('codeql-action/upload-sarif@');
    expect(ossar).toMatch(
      /sarif_file: \$\{\{ steps\.msdo\.outputs\.sarifFile \}\}/u
    );
    expect(ossar).toMatch(/id: msdo/u);
  });
});

describe('reusable adversarial review gate', () => {
  it('keeps the blocking flags on both providers', () => {
    expect(adversarial.match(/--fail-on high/gu)).toHaveLength(2);
    expect(adversarial.match(/--fail-on-empty/gu)).toHaveLength(2);
    expect(adversarial.match(/--verify/gu)).toHaveLength(2);
    expect(adversarial.match(/--passes "\$PASSES"/gu)).toHaveLength(2);
  });

  it('defaults to two passes and keeps Haiku on both providers', () => {
    expect(adversarial).toMatch(/passes:\n(?:\s+.*\n)*?\s+default: 2\n/u);
    expect(adversarial).toContain('--model haiku');
    expect(adversarial).toContain('--model claude-haiku-5-5');
    expect(adversarial).toContain('CLAUDE_CODE_SUBAGENT_MODEL: haiku');
    expect(adversarial).toContain("CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1'");
  });

  it('rejects a tools-ref that is not a full commit SHA before any checkout', () => {
    const validation = adversarial.indexOf('^[0-9a-f]{40}$');
    const firstCheckout = adversarial.indexOf('actions/checkout@');
    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(firstCheckout);
    expect(adversarial).toContain('exit 1');
  });

  it('checks the tools out inside the workspace, never under runner.temp', () => {
    const checkoutPaths = [...adversarial.matchAll(/^\s+path: (.+)$/gmu)].map(
      (match) => match[1]
    );
    expect(checkoutPaths).toEqual(['.langlo-tools']);
    expect(adversarial).not.toMatch(/path: .*runner\.temp/u);
    expect(adversarial).toContain('rm -rf .langlo-tools');
  });

  it('runs only for same-repository pull requests', () => {
    expect(adversarial).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
  });
});

describe('reusable Claude review gate', () => {
  it('keeps the turn cap, Haiku and the inline-comment guard', () => {
    expect(claude).toContain('--max-turns 60');
    expect(claude).toContain('--model haiku');
    expect(claude).toContain("classify_inline_comments: 'false'");
    expect(claude).toContain('"CLAUDE_CODE_SUBAGENT_MODEL": "haiku"');
    expect(claude).toContain(
      'mcp__github_inline_comment__create_inline_comment'
    );
    expect(claude).toContain('confirmed===true');
    expect(claude).not.toMatch(
      /--model (?:sonnet|opus|claude-sonnet|claude-opus)/u
    );
  });

  it('only allows the review tools and never grants push or edit access', () => {
    const allowed = /--allowedTools "([^"]+)"/u.exec(claude)?.[1] ?? '';
    expect(allowed).toContain('Read');
    expect(allowed).not.toMatch(/\b(?:Edit|Write)\b/u);
    expect(allowed).not.toContain('git push');
    expect(claude).toContain('contents: read');
  });

  it('runs only for same-repository pull requests', () => {
    expect(claude).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
  });
});

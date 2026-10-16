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
    expect(claude).toContain('--max-turns 30');
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

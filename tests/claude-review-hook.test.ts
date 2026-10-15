import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const review = readFileSync(
  new URL('../.github/workflows/claude-review.yml', import.meta.url),
  'utf8'
);
const adversarial = readFileSync(
  new URL('../.github/workflows/adversarial-review.yml', import.meta.url),
  'utf8'
);

function inlineCommentHookCommand(workflow: string): string {
  const lines = workflow.split('\n');
  const index = lines.findIndex((line) => line.trim() === 'settings: |');
  if (index < 0) throw new Error('Missing inline-review hook settings');

  const jsonLines: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (!line.startsWith('            ')) break;
    jsonLines.push(line.slice(12));
  }
  const settings = JSON.parse(jsonLines.join('\n')) as {
    hooks: {
      PreToolUse: Array<{
        matcher: string;
        hooks: Array<{ type: string; command: string }>;
      }>;
    };
  };
  const hook = settings.hooks.PreToolUse[0];
  if (
    hook?.matcher !== 'mcp__github_inline_comment__create_inline_comment' ||
    hook.hooks[0]?.type !== 'command'
  ) {
    throw new Error('Expected the inline-comment PreToolUse guard');
  }
  return hook.hooks[0].command;
}

describe('Haiku-only CI review configuration', () => {
  it('uses Haiku across both providers and forces Haiku for subagents', () => {
    expect(review).toContain('--model haiku');
    expect(adversarial).toContain('--model haiku');
    expect(adversarial).toContain('--model claude-haiku-5-5');
    for (const workflow of [review, adversarial]) {
      expect(workflow).toContain('CLAUDE_CODE_SUBAGENT_MODEL: haiku');
      expect(workflow).toContain("CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1'");
      expect(workflow).not.toMatch(/--model (?:sonnet|opus|claude-sonnet|claude-opus)/u);
    }
    expect(review).toContain("classify_inline_comments: 'false'");
  });

  it.each([
    ['confirmed finding', { tool_input: { confirmed: true } }, 0],
    ['unconfirmed finding', { tool_input: {} }, 2],
    ['explicit probe', { tool_input: { confirmed: false } }, 2],
    ['string confirmation', { tool_input: { confirmed: 'true' } }, 2],
    ['null confirmation', { tool_input: { confirmed: null } }, 2]
  ])('%s returns exit %i or the expected hook status', (_label, input, status) => {
    const result = spawnSync('sh', ['-c', inlineCommentHookCommand(review)], {
      input: JSON.stringify(input),
      encoding: 'utf8'
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
  });

  it('rejects malformed hook input without posting', () => {
    const result = spawnSync('sh', ['-c', inlineCommentHookCommand(review)], {
      input: '{not valid JSON}',
      encoding: 'utf8'
    });
    expect(result.status).toBe(2);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { ConfigError } from '../src/lib/server/config';
import { fallbackEvaluator } from '../src/lib/server/evaluation/runtime';
import { variables } from '../src/env';

const client = {} as Client;

afterEach(() => vi.restoreAllMocks());

describe('fallback runtime wiring', () => {
  it('is off without a key and silent', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(fallbackEvaluator(client, {})).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('is on when a key is set', () => {
    expect(
      typeof fallbackEvaluator(client, { openAiKey: 'k'.repeat(24) })
    ).toBe('function');
  });

  it('is off and logs loudly, without a value, when the key was invalid', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      fallbackEvaluator(client, {
        openAiKeyError: new ConfigError('OPENAI_API_KEY')
      })
    ).toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual({
      level: 'error',
      operation: 'ai-fallback',
      reason: 'invalid-config',
      variable: 'OPENAI_API_KEY'
    });
  });

  it('declares OPENAI_API_KEY so SvelteKit exposes it to the config parser', () => {
    expect(Object.keys(variables)).toContain('OPENAI_API_KEY');
  });
});

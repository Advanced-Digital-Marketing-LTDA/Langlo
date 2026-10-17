import { describe, expect, it, vi } from 'vitest';
import {
  DECISIONS_URL,
  openAiDecisions
} from '../src/lib/server/evaluation/openai-decisions';
import { ProviderError } from '../src/lib/server/evaluation/fallback';

const request = { model: 'gpt-6-luna', input: '{}', questions: [] };
const key = 'sk-synthetic-test-key-000000000000';

describe('OpenAI Decisions adapter', () => {
  it('posts the request with the key to the Decisions endpoint', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })
    );
    const signal = new AbortController().signal;
    await expect(
      openAiDecisions(key, fetchImpl as typeof fetch)(request, signal)
    ).resolves.toEqual({ ok: 1 });
    expect(String(DECISIONS_URL)).toBe('https://api.openai.com/v1/decisions');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit
    ];
    expect(String(url)).toBe('https://api.openai.com/v1/decisions');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(init.headers).toEqual({
      authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    });
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it.each([400, 401, 429, 500])('throws on HTTP %d', async (status) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }));
    const call = openAiDecisions(key, fetchImpl as typeof fetch)(
      request,
      new AbortController().signal
    );
    await expect(call).rejects.toBeInstanceOf(ProviderError);
    await expect(call).rejects.toMatchObject({ status });
  });

  it('throws a network ProviderError when fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      openAiDecisions(key, fetchImpl as typeof fetch)(
        request,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ status: 'network' });
  });

  it('passes an abort through instead of calling it a network failure', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort(new DOMException('late', 'TimeoutError'));
      throw new TypeError('aborted');
    });
    await expect(
      openAiDecisions(key, fetchImpl as typeof fetch)(
        request,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('returns null for an unreadable body so it reads as malformed', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json', { status: 200 })
    );
    await expect(
      openAiDecisions(key, fetchImpl as typeof fetch)(
        request,
        new AbortController().signal
      )
    ).resolves.toBeNull();
  });
});

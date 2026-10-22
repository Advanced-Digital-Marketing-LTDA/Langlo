import { describe, expect, it, vi } from 'vitest';
import {
  SYSTEM_ONE_URL,
  typesafeJev
} from '../src/lib/server/evaluation/typesafe-jev';
import {
  ProviderError,
  type SystemOneRequest
} from '../src/lib/server/evaluation/fallback';

const request = {
  model: 'jev-latest',
  state: {
    language: 'fr',
    format: 'translation',
    prompt: 'We are here.',
    accepted_answers: ['Nous sommes ici.'],
    learner_answer: 'Nous voilà ici.'
  },
  questions: {
    verdict: {
      type: 'noul',
      instructions: 'Does the learner answer fulfill the exercise prompt?'
    }
  }
} satisfies SystemOneRequest;
// Built at runtime so no secret-looking literal is committed.
const key = ['typesafe', 'synthetic', 'test', 'key', '0'.repeat(12)].join('-');

describe('TypeSafe System One adapter', () => {
  it('posts the request with the key to the TypeSafe endpoint', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })
    );
    const signal = new AbortController().signal;
    await expect(
      typesafeJev(key, fetchImpl as typeof fetch)(request, signal)
    ).resolves.toEqual({ ok: 1 });
    expect(String(SYSTEM_ONE_URL)).toBe('https://api.typesafe.ai/v1/systemone');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit
    ];
    expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
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
    const call = typesafeJev(key, fetchImpl as typeof fetch)(
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
      typesafeJev(key, fetchImpl as typeof fetch)(
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
      typesafeJev(key, fetchImpl as typeof fetch)(request, controller.signal)
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('surfaces an unreadable success body as a malformed provider error', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not json', { status: 200 })
    );
    const call = typesafeJev(key, fetchImpl as typeof fetch)(
      request,
      new AbortController().signal
    );
    await expect(call).rejects.toBeInstanceOf(ProviderError);
    await expect(call).rejects.toMatchObject({ status: 'malformed' });
  });
});

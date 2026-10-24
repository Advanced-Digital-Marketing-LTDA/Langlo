import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestLibraryAi } from '../src/lib/server/library-ai';

afterEach(() => vi.unstubAllGlobals());

describe('Library AI', () => {
  it('uses OpenAI gpt-6-luna with low reasoning and only the requested context', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'a financial institution' }
              ]
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      requestLibraryAi('synthetic-openai-test-key', {
        action: 'lookup',
        language: 'en',
        targetLanguage: 'pt',
        sentence: 'The bank approved my loan.',
        previousSentence: 'I applied on Monday.',
        nextSentence: 'The river bank is nearby.',
        term: 'bank'
      })
    ).resolves.toBe('a financial institution');

    const request = fetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(request.headers).toMatchObject({
      authorization: 'Bearer synthetic-openai-test-key'
    });
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      reasoning: { effort: 'low' },
      store: false
    });
    expect(JSON.stringify(body)).toContain('The river bank is nearby.');
    expect(JSON.stringify(body)).not.toContain('full-document-secret');
  });

  it('fails clearly when the key or provider is unavailable without fallback', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const input = {
      action: 'translate' as const,
      language: 'fr' as const,
      targetLanguage: 'en' as const,
      sentence: 'Je lis un livre.',
      previousSentence: '',
      nextSentence: ''
    };

    await expect(requestLibraryAi(undefined, input)).rejects.toMatchObject({
      code: 'LIBRARY_AI_UNAVAILABLE'
    });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValue(
      new Error('provider details must not reach learners')
    );
    await expect(
      requestLibraryAi('synthetic-openai-test-key', input)
    ).rejects.toMatchObject({ code: 'LIBRARY_AI_UNAVAILABLE' });
  });

  it('rejects oversized context before calling the provider', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      requestLibraryAi('synthetic-openai-test-key', {
        action: 'translate',
        language: 'fr',
        targetLanguage: 'en',
        sentence: 'x'.repeat(16_001),
        previousSentence: '',
        nextSentence: ''
      })
    ).rejects.toMatchObject({ code: 'LIBRARY_CONTEXT_TOO_LARGE' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

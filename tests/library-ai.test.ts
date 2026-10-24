import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestLibraryAi } from '../src/lib/server/library-ai';

afterEach(() => vi.unstubAllGlobals());

describe('Library AI', () => {
  it('uses OpenAI gpt-6-luna with low reasoning and only the requested context', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    translation: 'banco',
                    explanation: 'a financial institution'
                  })
                }
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
    ).resolves.toEqual({
      translation: 'banco',
      explanation: 'a financial institution'
    });

    const request = fetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(request.headers).toMatchObject({
      authorization: 'Bearer synthetic-openai-test-key'
    });
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 500,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          schema: { required: ['translation', 'explanation'] }
        }
      }
    });
    expect(JSON.stringify(body)).toContain('The river bank is nearby.');
    expect(JSON.stringify(body)).not.toContain('full-document-secret');
  });

  it.each(['translate', 'lookup'] as const)(
    'rejects token-limited partial %s output without retrying',
    async (action) => {
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'partial unfinished text' }
              ]
            }
          ]
        })
      );
      vi.stubGlobal('fetch', fetch);
      await expect(
        requestLibraryAi('synthetic-openai-test-key', {
          action,
          language: 'fr',
          targetLanguage: 'en',
          sentence: 'Bonjour.',
          previousSentence: '',
          nextSentence: '',
          ...(action === 'lookup' ? { term: 'Bonjour' } : {})
        })
      ).rejects.toMatchObject({ code: 'LIBRARY_AI_UNAVAILABLE' });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    {
      name: 'content-filtered',
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' }
    },
    { name: 'failed', status: 'failed' },
    { name: 'missing completion status' }
  ])('rejects $name responses even when they contain text', async (state) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...state,
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'plausible but unusable text' }
              ]
            }
          ]
        })
      )
    );
    await expect(
      requestLibraryAi('synthetic-openai-test-key', {
        action: 'lookup',
        language: 'fr',
        targetLanguage: 'en',
        sentence: 'Bonjour.',
        previousSentence: '',
        nextSentence: '',
        term: 'Bonjour'
      })
    ).rejects.toMatchObject({ code: 'LIBRARY_AI_UNAVAILABLE' });
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

  it('translates a sentence as plain text without a structured format', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'I read a book.' }]
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      requestLibraryAi('synthetic-openai-test-key', {
        action: 'translate',
        language: 'fr',
        targetLanguage: 'en',
        sentence: 'Je lis un livre.',
        previousSentence: '',
        nextSentence: ''
      })
    ).resolves.toBe('I read a book.');
    const body = JSON.parse(
      String((fetch.mock.calls[0][1] as RequestInit).body)
    );
    expect(body.max_output_tokens).toBe(300);
    expect(body.text).toBeUndefined();
  });

  it.each([
    ['not JSON', 'banco: a financial institution'],
    ['missing explanation', JSON.stringify({ translation: 'banco' })],
    [
      'blank translation',
      JSON.stringify({ translation: ' ', explanation: 'x' })
    ]
  ])('rejects a lookup that is %s without retrying', async (_name, text) => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
      })
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      requestLibraryAi('synthetic-openai-test-key', {
        action: 'lookup',
        language: 'fr',
        targetLanguage: 'en',
        sentence: 'Bonjour.',
        previousSentence: '',
        nextSentence: '',
        term: 'Bonjour'
      })
    ).rejects.toMatchObject({ code: 'LIBRARY_AI_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

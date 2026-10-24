import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { createLibraryDocument } from '../src/lib/server/library';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { createDeck, getNote } from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import * as library from '../src/routes/app/api/library/+server';
import * as documentRoute from '../src/routes/app/api/library/[id]/+server';
import * as studyRoute from '../src/routes/app/api/library/[id]/study/+server';
import * as vocabularyRoute from '../src/routes/app/api/library/[id]/vocabulary/+server';

type Handler = (event: never) => Promise<Response>;
let target: Awaited<ReturnType<typeof fixture>>;
let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  target = await fixture();
  ({ client, close } = await openFixtureDatabase(target));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

function event(
  method: string,
  userId: string | null,
  path: string,
  body?: unknown,
  apiKey?: string
) {
  const config = {
    dataEnabled: true,
    databaseUrl: target.databaseUrl,
    openAiApiKey: apiKey
  } as RuntimeConfig;
  const url = new URL(`http://127.0.0.1${path}`);
  const request = new Request(url, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    request,
    url,
    params: { id: 'library-a' },
    locals: {
      correlationId: 'test',
      config,
      user: userId ? { id: userId, email: `${userId}@x`, name: userId } : null,
      session: userId
        ? { id: `s-${userId}`, userId, expiresAt: new Date(Date.now() + 1e6) }
        : null
    }
  } as never;
}

async function call(handler: Handler, e: never) {
  try {
    const response = await handler(e);
    return { status: response.status, body: await response.json() };
  } catch (thrown) {
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure.status !== 'number') throw thrown;
    return { status: failure.status, body: failure.body };
  }
}

describe('Library API', () => {
  it('returns unavailable instead of partial AI text and counts the provider attempt once', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'Bonjour.'
    });
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'partial unfinished text' }]
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetch);
    const result = await call(
      studyRoute.POST as Handler,
      event(
        'POST',
        'learner-a',
        '/app/api/library/library-a/study',
        { action: 'lookup', sentenceIndex: 0, term: 'Bonjour' },
        'synthetic-openai-test-key'
      )
    );
    expect(result).toMatchObject({ status: 503 });
    expect(JSON.stringify(result.body)).not.toContain(
      'partial unfinished text'
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await client.execute({
          sql: 'SELECT calls FROM library_ai_usage WHERE owner_id = ?',
          args: ['learner-a']
        })
      ).rows
    ).toEqual([{ calls: 1 }]);
  });

  it.each([
    { action: 'invalid', sentenceIndex: 0 },
    { action: 'translate', sentenceIndex: -1 },
    { action: 'translate', sentenceIndex: 1 },
    { action: 'translate', sentenceIndex: 0.5 },
    { action: 'lookup', sentenceIndex: 0, term: '' },
    { action: 'lookup', sentenceIndex: 0, term: 'absent' },
    { action: 'lookup', sentenceIndex: 0, term: 'x'.repeat(257) }
  ])('rejects invalid study input before spending quota: %j', async (body) => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'Bonjour.'
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      await call(
        studyRoute.POST as Handler,
        event(
          'POST',
          'learner-a',
          '/app/api/library/library-a/study',
          body,
          'synthetic-openai-test-key'
        )
      )
    ).toMatchObject({ status: 400 });
    expect(
      (await client.execute('SELECT * FROM library_ai_usage')).rows
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not reserve quota when the AI key is unavailable', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'Bonjour.'
    });
    expect(
      await call(
        studyRoute.POST as Handler,
        event('POST', 'learner-a', '/app/api/library/library-a/study', {
          action: 'translate',
          sentenceIndex: 0
        })
      )
    ).toMatchObject({ status: 503 });
    expect(
      (await client.execute('SELECT * FROM library_ai_usage')).rows
    ).toEqual([]);
  });

  it('keeps progress and deletion owner-scoped and persists valid changes', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'Bonjour.'
    });
    expect(
      await call(
        documentRoute.PATCH as Handler,
        event('PATCH', 'learner-a', '/app/api/library/library-a', {
          progressIndex: 2
        })
      )
    ).toMatchObject({ status: 400 });
    expect(
      await call(
        documentRoute.PATCH as Handler,
        event('PATCH', 'learner-b', '/app/api/library/library-a', {
          progressIndex: 1
        })
      )
    ).toMatchObject({ status: 404 });
    expect(
      await call(
        documentRoute.DELETE as Handler,
        event('DELETE', 'learner-b', '/app/api/library/library-a')
      )
    ).toMatchObject({ status: 404 });
    expect(
      await call(
        documentRoute.PATCH as Handler,
        event('PATCH', 'learner-a', '/app/api/library/library-a', {
          progressIndex: 1
        })
      )
    ).toMatchObject({ status: 200, body: { saved: true } });
    expect(
      await call(
        documentRoute.GET as Handler,
        event('GET', 'learner-a', '/app/api/library/library-a')
      )
    ).toMatchObject({ status: 200, body: { document: { progressIndex: 1 } } });
    expect(
      await call(
        documentRoute.DELETE as Handler,
        event('DELETE', 'learner-a', '/app/api/library/library-a')
      )
    ).toMatchObject({ status: 200, body: { deleted: true } });
    expect(
      await call(
        documentRoute.GET as Handler,
        event('GET', 'learner-a', '/app/api/library/library-a')
      )
    ).toMatchObject({ status: 404 });
  });

  it('lists and reads only the signed-in learner’s documents', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'Bonjour.'
    });

    expect(
      await call(
        library.GET as Handler,
        event('GET', 'learner-a', '/app/api/library')
      )
    ).toMatchObject({
      status: 200,
      body: { documents: [{ id: 'library-a' }] }
    });
    expect(
      await call(
        documentRoute.GET as Handler,
        event('GET', 'learner-b', '/app/api/library/library-a')
      )
    ).toMatchObject({ status: 404 });
  });

  it('sends only the selected sentence and its neighbors to OpenAI', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'Bank senses',
      language: 'en',
      content:
        'First context sentence. The bank approved my loan. I signed the form. FULL_DOCUMENT_SECRET.'
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [{ type: 'output_text', text: 'financial institution' }]
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetch);

    const result = await call(
      studyRoute.POST as Handler,
      event(
        'POST',
        'learner-a',
        '/app/api/library/library-a/study',
        { action: 'lookup', sentenceIndex: 1, term: 'bank' },
        'synthetic-openai-test-key'
      )
    );
    expect(result).toMatchObject({
      status: 200,
      body: { result: 'financial institution' }
    });
    const sent = String((fetch.mock.calls[0][1] as RequestInit).body);
    expect(sent).toContain('The bank approved my loan.');
    expect(sent).toContain('First context sentence.');
    expect(sent).toContain('I signed the form.');
    expect(sent).not.toContain('FULL_DOCUMENT_SECRET');
  });

  it('limits daily AI calls before contacting the provider', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'Bonjour.'
    });
    await client.execute({
      sql: 'INSERT INTO library_ai_usage (day, owner_id, calls) VALUES (?, ?, ?)',
      args: [new Date().toISOString().slice(0, 10), 'learner-a', 100]
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    expect(
      await call(
        studyRoute.POST as Handler,
        event(
          'POST',
          'learner-a',
          '/app/api/library/library-a/study',
          { action: 'translate', sentenceIndex: 0 },
          'synthetic-openai-test-key'
        )
      )
    ).toMatchObject({ status: 429 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves vocabulary through the native draft flow and refuses a different owner', async () => {
    await createLibraryDocument(client, testSession('learner-a'), {
      id: 'library-a',
      title: 'French text',
      language: 'fr',
      content: 'La maison est grande.'
    });
    await createDeck(client, testSession('learner-a'), {
      id: 'deck-a',
      name: 'Français',
      language: 'fr'
    });
    const result = await call(
      vocabularyRoute.POST as Handler,
      event('POST', 'learner-a', '/app/api/library/library-a/vocabulary', {
        deckId: 'deck-a',
        term: 'maison',
        definition: 'house'
      })
    );
    const noteId = String((result.body as { note: { id: string } }).note.id);
    expect(result.status).toBe(200);
    expect(
      await getNote(client, testSession('learner-a'), noteId)
    ).toMatchObject({
      status: 'draft',
      content: { front: 'maison', back: 'house' },
      tags: ['library-vocabulary']
    });
    expect(
      await call(
        vocabularyRoute.POST as Handler,
        event('POST', 'learner-b', '/app/api/library/library-a/vocabulary', {
          deckId: 'deck-a',
          term: 'maison',
          definition: 'house'
        })
      )
    ).toMatchObject({ status: 404 });
  });
});

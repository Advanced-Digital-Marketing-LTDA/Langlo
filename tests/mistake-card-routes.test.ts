import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '../src/lib/server/config';
import { createDeck, getNote } from '../src/lib/server/flashcards';
import { createMistakeDraft } from '../src/lib/server/mistake-cards';
import { disposeFlashcardFixtures } from './fixtures/flashcards';
import {
  attemptId,
  learner,
  noteCounts,
  other,
  setupMistakeCardFixture as setup
} from './fixtures/mistake-cards';
import { POST as createDraft } from '../src/routes/app/api/attempts/[id]/card/+server';
import { PATCH as editDraft } from '../src/routes/app/api/notes/[id]/+server';
import { POST as rejectDraft } from '../src/routes/app/api/notes/[id]/reject/+server';
import { actions as deckActions } from '../src/routes/app/decks/[id]/+page.server';
import {
  actions as resultsActions,
  load as resultsLoad
} from '../src/routes/app/session/[id]/results/+page.server';

let deprecatedErrorWarning = false;

beforeEach(() => {
  deprecatedErrorWarning = false;
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (args.some((arg) => String(arg).includes('error_body_deprecated')))
      deprecatedErrorWarning = true;
  });
});

afterEach(async () => {
  const warned = deprecatedErrorWarning;
  vi.restoreAllMocks();
  await disposeFlashcardFixtures();
  expect(warned).toBe(false);
});

describe('mistake-card draft endpoints', () => {
  function event(
    options: {
      userId?: string;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      method?: string;
      databaseUrl?: string;
    } = {}
  ) {
    return {
      params: options.params ?? {},
      locals: {
        user: { id: options.userId ?? learner.userId },
        session: { userId: options.userId ?? learner.userId },
        config: {
          dataEnabled: true,
          databaseUrl: options.databaseUrl
        } as RuntimeConfig
      },
      request: new Request('http://127.0.0.1/app/api/test', {
        method: options.method ?? 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options.body ?? {})
      })
    } as never;
  }

  it('creates, edits and rejects through the authenticated endpoints', async () => {
    const { db, target } = await setup();
    try {
      const created = await createDraft(
        event({
          params: { id: attemptId },
          body: { format: 'basic' },
          databaseUrl: target.databaseUrl
        })
      );
      expect(created.status).toBe(201);
      const { note } = (await created.json()) as {
        note: { id: string; status: string };
      };
      expect(note.status).toBe('draft');

      const edited = await editDraft(
        event({
          params: { id: note.id },
          method: 'PATCH',
          body: {
            kind: 'basic',
            content: { front: 'Je ___ étudiant.', back: 'suis' },
            explanation: 'Use être.'
          },
          databaseUrl: target.databaseUrl
        })
      );
      expect(edited.status).toBe(200);
      expect(await edited.json()).toMatchObject({
        note: {
          id: note.id,
          content: { front: 'Je ___ étudiant.', back: 'suis' },
          explanation: 'Use être.'
        }
      });

      const rejected = await rejectDraft(
        event({
          params: { id: note.id },
          databaseUrl: target.databaseUrl
        })
      );
      expect(rejected.status).toBe(200);
      expect(await rejected.json()).toMatchObject({
        id: note.id,
        status: 'rejected'
      });

      const foreign = await Promise.resolve()
        .then(() =>
          editDraft(
            event({
              userId: other.userId,
              params: { id: note.id },
              method: 'PATCH',
              body: { kind: 'basic', content: { front: 'a', back: 'b' } },
              databaseUrl: target.databaseUrl
            })
          )
        )
        .catch((thrown: unknown) => thrown);
      expect(foreign).toHaveProperty('status', 404);
      expect(foreign).toHaveProperty('body.message', 'Not found.');
      expect(await noteCounts(db.client)).toEqual([1, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('requires a signed-in learner before reading a request body', async () => {
    const { db, target } = await setup();
    try {
      await expect(
        createDraft({
          params: { id: attemptId },
          locals: { user: null, session: null, config: {} },
          request: new Request('http://127.0.0.1/app/api/test', {
            method: 'POST',
            body: '{not json'
          })
        } as never)
      ).rejects.toMatchObject({
        status: 401,
        body: { message: 'Sign in required.' }
      });
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
      void target;
    }
  });
});

describe('mistake-card pages', () => {
  function formEvent(
    options: {
      userId?: string;
      params?: Record<string, string>;
      fields?: Record<string, string>;
      databaseUrl?: string;
    } = {}
  ) {
    const form = new FormData();
    for (const [key, value] of Object.entries(options.fields ?? {}))
      form.set(key, value);
    const userId = options.userId ?? learner.userId;
    return {
      params: options.params ?? {},
      locals: {
        user: { id: userId },
        session: { userId },
        config: {
          dataEnabled: true,
          databaseUrl: options.databaseUrl
        } as RuntimeConfig
      },
      request: new Request('http://127.0.0.1/app', {
        method: 'POST',
        body: form
      })
    } as never;
  }

  it('rejects missing deck form fields before touching notes', async () => {
    const { db, target } = await setup();
    try {
      const event = (fields: Record<string, string>) =>
        formEvent({
          params: { id: 'deck-missing' },
          fields,
          databaseUrl: target.databaseUrl
        });
      expect(await deckActions.edit(event({}))).toMatchObject({ status: 400 });
      expect(
        await deckActions.edit(event({ kind: 'basic', noteId: 'note-missing' }))
      ).toMatchObject({ status: 404 });
      expect(
        await deckActions.edit(event({ kind: 'cloze', noteId: 'note-missing' }))
      ).toMatchObject({ status: 404 });
      expect(await deckActions.approve(event({}))).toMatchObject({
        status: 404
      });
      expect(await deckActions.reject(event({}))).toMatchObject({
        status: 404
      });
      expect(await deckActions.addNote(event({}))).toMatchObject({
        status: 400
      });
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('keeps a results-page mistake and edits it on the deck page', async () => {
    const { db, target } = await setup();
    try {
      const loaded = (await resultsLoad(
        formEvent({
          params: { id: 'study-a' },
          databaseUrl: target.databaseUrl
        })
      )) as { mistakes: Array<{ attemptId: string }> };
      expect(loaded.mistakes).toEqual([expect.objectContaining({ attemptId })]);
      expect(
        await resultsActions.keep(
          formEvent({
            fields: { attemptId, format: 'basic' },
            databaseUrl: target.databaseUrl
          })
        )
      ).toEqual({ saved: true });
      expect(
        await resultsActions.keep(
          formEvent({ databaseUrl: target.databaseUrl })
        )
      ).toMatchObject({ status: 404, data: { message: 'Not found.' } });

      const noteRow = (
        await db.client.execute(
          'SELECT id, deck_id FROM native_flashcard_notes WHERE owner_id = ?',
          [learner.userId]
        )
      ).rows[0];
      const noteId = String(noteRow.id);
      const deckId = String(noteRow.deck_id);
      expect(
        await deckActions.edit(
          formEvent({
            params: { id: deckId },
            fields: {
              noteId,
              kind: 'basic',
              front: 'Je ___ étudiant.',
              back: 'suis',
              explanation: 'Use être.'
            },
            databaseUrl: target.databaseUrl
          })
        )
      ).toEqual({ saved: true });
      expect((await getNote(db.client, learner, noteId)).explanation).toBe(
        'Use être.'
      );
      expect(
        await deckActions.edit(
          formEvent({
            params: { id: deckId },
            fields: { noteId, kind: 'other' },
            databaseUrl: target.databaseUrl
          })
        )
      ).toMatchObject({
        status: 400,
        data: { message: 'Choose a basic front/back card or a cloze card.' }
      });
    } finally {
      db.close();
    }
  });

  it('adds and edits a cloze note on the deck page', async () => {
    const { db, target } = await setup();
    try {
      const deckId = 'deck-page-cloze';
      await createDeck(db.client, learner, { id: deckId, name: 'Cloze' });
      expect(
        await deckActions.addNote(
          formEvent({
            params: { id: deckId },
            fields: {
              kind: 'cloze',
              text: 'Je {{c1::suis}} ici',
              explanation: 'Cloze note'
            },
            databaseUrl: target.databaseUrl
          })
        )
      ).toEqual({ saved: true });
      const noteId = String(
        (
          await db.client.execute(
            "SELECT id FROM native_flashcard_notes WHERE owner_id = ? AND kind = 'cloze'",
            [learner.userId]
          )
        ).rows[0].id
      );
      expect(
        await deckActions.edit(
          formEvent({
            params: { id: deckId },
            fields: {
              noteId,
              kind: 'cloze',
              text: 'Je {{c1::suis}} ici.',
              explanation: 'Cloze note edited'
            },
            databaseUrl: target.databaseUrl
          })
        )
      ).toEqual({ saved: true });
      expect((await getNote(db.client, learner, noteId)).content).toEqual({
        text: 'Je {{c1::suis}} ici.'
      });
    } finally {
      db.close();
    }
  });

  it('rejects a kept mistake on the deck page', async () => {
    const { db, target } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      const note = await getNote(db.client, learner, draft.id);
      expect(
        await deckActions.reject(
          formEvent({
            params: { id: note.deckId },
            fields: { noteId: draft.id },
            databaseUrl: target.databaseUrl
          })
        )
      ).toEqual({ saved: true });
      expect((await getNote(db.client, learner, draft.id)).status).toBe(
        'rejected'
      );
    } finally {
      db.close();
    }
  });
});

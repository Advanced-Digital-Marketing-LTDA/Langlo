import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  approveNote,
  getNote,
  submitReview
} from '../src/lib/server/flashcards';
import {
  approveOwnNote,
  countDueCards,
  listDueCards
} from '../src/lib/server/flashcard-views';
import {
  createMistakeDraft,
  listMistakeCandidates,
  updateNote,
  rejectNote
} from '../src/lib/server/mistake-cards';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { POST as createDraft } from '../src/routes/app/api/attempts/[id]/card/+server';
import { PATCH as editDraft } from '../src/routes/app/api/notes/[id]/+server';
import { POST as rejectDraft } from '../src/routes/app/api/notes/[id]/reject/+server';
import { actions as deckActions } from '../src/routes/app/decks/[id]/+page.server';
import {
  actions as resultsActions,
  load as resultsLoad
} from '../src/routes/app/session/[id]/results/+page.server';

afterEach(disposeFlashcardFixtures);

const learner = testSession('learner-a');
const other = testSession('learner-b');
const attemptId = 'attempt-a';

/**
 * The seeded practice attempt is given a checked prompt, answer and lesson so
 * a contextual draft can be generated. The seeded evaluation is `incorrect`.
 */
async function setup() {
  const target = await fixture();
  const db = await openFixtureDatabase(target);
  await db.client.execute(
    "UPDATE questions SET prompt = 'Je ___ étudiant.', answer = 'suis' WHERE id = 'question-1'"
  );
  await db.client.execute({
    sql: "INSERT INTO lessons (content_version_id, skill_id, language, title, explanation, examples, refs, fingerprint) VALUES ('content-v1', 'fr-articles', 'fr', 'Le présent', ?, '[]', '[]', ?)",
    args: [
      'Use the present tense of être: je suis. The blank needs the conjugated form, not the infinitive.',
      'a'.repeat(64)
    ]
  });
  return { db, target };
}

async function noteCounts(client: Client) {
  const result = await client.batch(
    [
      'SELECT count(*) AS total FROM native_flashcard_notes',
      'SELECT count(*) AS total FROM native_flashcards',
      'SELECT count(*) AS total FROM native_flashcard_review_events'
    ],
    'read'
  );
  return result.map((query) => Number(query.rows[0].total));
}

describe('mistake-card draft generation', () => {
  it('creates a contextual draft only from a confirmed incorrect practice answer', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect(draft).toMatchObject({ status: 'draft', duplicate: false });

      const note = await getNote(db.client, learner, draft.id);
      expect(note).toMatchObject({
        kind: 'basic',
        status: 'draft',
        content: { front: 'Je ___ étudiant.', back: 'suis' },
        explanation:
          'Use the present tense of être: je suis. The blank needs the conjugated form, not the infinitive.',
        source: {
          attemptId,
          skillId: 'fr-articles',
          contentVersionId: 'content-v1'
        }
      });
      expect(note.id).toMatch(/^note:/u);
      expect(note.card.id).toBe(`card:${note.id}`);

      // A draft is editable content, not schedulable study material.
      expect(await listDueCards(db.client, learner)).toEqual([]);
      expect(await countDueCards(db.client, learner)).toBe(0);
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
    } finally {
      db.close();
    }
  });

  it('refuses drafts for pending, correct, uncertain, unsure, assessment and foreign answers', async () => {
    const { db } = await setup();
    try {
      const attempts = [
        {
          name: 'pending evaluation',
          change: 'DELETE FROM evaluations',
          code: 'NOT_CONFIRMED'
        },
        {
          name: 'correct answer',
          change: "UPDATE evaluations SET outcome = 'correct'",
          code: 'NOT_A_MISTAKE'
        },
        {
          name: 'uncertain answer',
          change: "UPDATE evaluations SET outcome = 'uncertain'",
          code: 'NOT_ELIGIBLE'
        },
        {
          name: 'AI refusal',
          change:
            "UPDATE evaluations SET evaluator_version = 'decisions-1', outcome = 'uncertain'",
          code: 'NOT_ELIGIBLE'
        },
        {
          name: 'not-sure answer',
          change: 'UPDATE attempts SET not_sure = 1',
          code: 'NOT_ELIGIBLE'
        },
        {
          name: 'assessment answer before results',
          change:
            "UPDATE study_sessions SET mode = 'assessment' WHERE id = 'study-a'",
          code: 'NOT_ELIGIBLE'
        },
        {
          name: 'hidden holdout',
          change: "UPDATE questions SET holdout = 1 WHERE id = 'question-1'",
          code: 'NOT_ELIGIBLE'
        },
        {
          name: 'withdrawn content',
          change:
            "UPDATE content_versions SET status = 'quarantined' WHERE id = 'content-v1'",
          code: 'CONTENT_UNAVAILABLE'
        },
        {
          name: 'missing checked payload',
          change: "UPDATE questions SET prompt = NULL WHERE id = 'question-1'",
          code: 'CONTENT_UNAVAILABLE'
        }
      ];
      for (const { name, change, code } of attempts) {
        const fresh = await setup();
        try {
          await fresh.db.client.execute(change);
          await expect(
            createMistakeDraft(fresh.db.client, learner, {
              attemptId,
              format: 'basic'
            }),
            name
          ).rejects.toMatchObject({ code });
          expect(await noteCounts(fresh.db.client), name).toEqual([0, 0, 0]);
        } finally {
          fresh.db.close();
        }
      }

      // The attempt exists, but it is not the caller's answer.
      await expect(
        createMistakeDraft(db.client, other, {
          attemptId,
          format: 'basic'
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('replays a duplicate request as the same native note and card', async () => {
    const { db } = await setup();
    try {
      const first = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      const replay = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect(replay).toMatchObject({
        id: first.id,
        cardId: first.cardId,
        duplicate: true
      });
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
    } finally {
      db.close();
    }
  });

  it('generates the T003 restricted Cloze form from a blank prompt only', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'cloze'
      });
      expect((await getNote(db.client, learner, draft.id)).content).toEqual({
        text: 'Je {{c1::suis}} étudiant.'
      });
    } finally {
      db.close();
    }

    // A prompt with no blank cannot become the supported Cloze form. Use a
    // fresh fixture so the earlier draft is not replayed as a duplicate.
    const noBlank = await setup();
    try {
      await noBlank.db.client.execute(
        "UPDATE questions SET prompt = 'Translate: I am a student.', answer = 'Je suis étudiant.' WHERE id = 'question-1'"
      );
      await expect(
        createMistakeDraft(noBlank.db.client, learner, {
          attemptId,
          format: 'cloze'
        })
      ).rejects.toMatchObject({ code: 'INVALID_CLOZE' });
      expect(await noteCounts(noBlank.db.client)).toEqual([0, 0, 0]);
    } finally {
      noBlank.db.close();
    }
  });

  it('lists only confirmed practice mistakes and links an existing draft', async () => {
    const { db } = await setup();
    try {
      expect(
        await listMistakeCandidates(db.client, learner, 'study-a')
      ).toEqual([
        {
          attemptId,
          skillId: 'fr-articles',
          prompt: 'Je ___ étudiant.',
          answer: 'suis',
          draftNoteId: null
        }
      ]);
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect(
        await listMistakeCandidates(db.client, learner, 'study-a')
      ).toEqual([expect.objectContaining({ draftNoteId: draft.id })]);
      await expect(
        listMistakeCandidates(db.client, other, 'study-a')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      db.close();
    }
  });
});

describe('mistake-card editing and rejection', () => {
  it('edits the same native note and generated card without duplicating identity', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      const before = await getNote(db.client, learner, draft.id);
      const edited = await updateNote(db.client, learner, draft.id, {
        kind: 'basic',
        content: { front: 'Je ___ étudiant.', back: 'suis (être)' },
        explanation: 'Être is irregular.'
      });
      expect(edited).toMatchObject({
        id: before.id,
        content: { front: 'Je ___ étudiant.', back: 'suis (être)' },
        explanation: 'Être is irregular.',
        status: 'draft'
      });
      expect((await getNote(db.client, learner, draft.id)).card.id).toBe(
        before.card.id
      );
      expect((await getNote(db.client, learner, draft.id)).sourceId).toBe(
        before.sourceId
      );

      // Approval keeps the identity, and a later content edit keeps it too.
      await approveOwnNote(db.client, learner, draft.id);
      const approved = await getNote(db.client, learner, draft.id);
      expect(approved.status).toBe('approved');
      expect(approved.card.id).toBe(before.card.id);
      await updateNote(db.client, learner, draft.id, {
        kind: 'basic',
        content: { front: 'Je ___ étudiant.', back: 'suis' },
        explanation: 'Use the present tense of être.'
      });
      const after = await getNote(db.client, learner, draft.id);
      expect(after).toMatchObject({
        id: before.id,
        status: 'approved',
        content: { front: 'Je ___ étudiant.', back: 'suis' },
        sourceId: before.sourceId
      });
      expect(after.card.id).toBe(before.card.id);
      expect(after.card.revision).toBe(1);
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
      expect(await listDueCards(db.client, learner)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('invalidates an open review form when an approved note changes', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      await approveOwnNote(db.client, learner, draft.id);
      expect((await getNote(db.client, learner, draft.id)).card.revision).toBe(
        0
      );

      await updateNote(db.client, learner, draft.id, {
        kind: 'basic',
        content: { front: 'Je ___ étudiant.', back: 'suis (être)' }
      });
      const edited = await getNote(db.client, learner, draft.id);
      expect(edited.card.revision).toBe(1);

      // The form loaded before the edit carries revision 0 and must not apply.
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: 'review-stale-after-edit',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: 'review-after-edit',
          expectedRevision: 1,
          rating: 'good'
        })
      ).resolves.toMatchObject({ revision: 2, duplicate: false });
      expect(await noteCounts(db.client)).toEqual([1, 1, 1]);
    } finally {
      db.close();
    }
  });

  it('uses the enrollment explanation language, falling back to English', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "UPDATE enrollments SET explanation_language = 'pt' WHERE owner_id = 'learner-a' AND language = 'fr'"
      );
      await db.client.execute({
        sql: "INSERT INTO lesson_translations (content_version_id, explanation_language, title, explanation, examples, refs, fingerprint) VALUES ('content-v1', 'pt', 'O presente', ?, '[]', '[]', ?)",
        args: ['Use o presente do verbo être: je suis.', 'b'.repeat(64)]
      });
      const translated = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect(
        (await getNote(db.client, learner, translated.id)).explanation
      ).toBe('Use o presente do verbo être: je suis.');

      await db.client.execute(
        "DELETE FROM lesson_translations WHERE content_version_id = 'content-v1'"
      );
      await db.client.execute(
        'DELETE FROM native_flashcard_notes WHERE owner_id = ?',
        [learner.userId]
      );
      const fallback = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect((await getNote(db.client, learner, fallback.id)).explanation).toBe(
        'Use the present tense of être: je suis. The blank needs the conjugated form, not the infinitive.'
      );
    } finally {
      db.close();
    }
  });

  it('inserts dollar sequences in a cloze answer literally', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "UPDATE questions SET answer = '$&' WHERE id = 'question-1'"
      );
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'cloze'
      });
      expect((await getNote(db.client, learner, draft.id)).content).toEqual({
        text: 'Je {{c1::$&}} étudiant.'
      });
    } finally {
      db.close();
    }
  });

  it('keeps the fallback verdict authoritative over a newer prepared one', async () => {
    const { db } = await setup();
    try {
      // The prepared verdict is newer, but the fallback verdict is the one the
      // results summary counts, so it also decides draft eligibility.
      await db.client.execute(
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('evaluation-fallback', 'learner-a', 'attempt-a', 'decisions-1', 'fallback-rubric-1', 'correct', unixepoch() * 1000 - 60000)"
      );
      await expect(
        createMistakeDraft(db.client, learner, {
          attemptId,
          format: 'basic'
        })
      ).rejects.toMatchObject({ code: 'NOT_A_MISTAKE' });
      expect(
        await listMistakeCandidates(db.client, learner, 'study-a')
      ).toEqual([]);
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('rejects partially persisted source metadata from direct SQL', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES ('deck-direct', 'learner-a', 'Direct')"
      );
      await expect(
        db.client.execute({
          sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, status, source_attempt_id) VALUES ('note-direct-partial', ?, 'learner-a', 'deck-direct', 'basic', '{\"front\":\"a\",\"back\":\"b\"}', 'draft', 'attempt-a')",
          args: [`langlo:v1:${'2'.repeat(64)}`]
        })
      ).rejects.toThrow(/source fields/u);

      await db.client.execute({
        sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json) VALUES ('note-direct-null', ?, 'learner-a', 'deck-direct', 'basic', '{\"front\":\"a\",\"back\":\"b\"}')",
        args: [`langlo:v1:${'3'.repeat(64)}`]
      });
      await expect(
        db.client.execute(
          "UPDATE native_flashcard_notes SET source_skill_id = 'fr-articles' WHERE id = 'note-direct-null'"
        )
      ).rejects.toThrow(/source fields/u);
      expect(
        (
          await db.client.execute(
            'SELECT count(*) AS count FROM native_flashcard_notes WHERE source_attempt_id IS NOT NULL AND (source_skill_id IS NULL OR source_content_version_id IS NULL)'
          )
        ).rows[0].count
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it('rejects a draft and removes it from the queue, recall events and further edits', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect(await rejectNote(db.client, learner, draft.id)).toMatchObject({
        id: draft.id,
        status: 'rejected'
      });
      expect(await rejectNote(db.client, learner, draft.id)).toMatchObject({
        id: draft.id,
        status: 'rejected'
      });
      expect(await listDueCards(db.client, learner)).toEqual([]);
      expect(await countDueCards(db.client, learner)).toBe(0);
      await expect(
        updateNote(db.client, learner, draft.id, {
          kind: 'basic',
          content: { front: 'a', back: 'b' }
        })
      ).rejects.toMatchObject({ code: 'NOT_EDITABLE' });
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: 'review-rejected',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
    } finally {
      db.close();
    }
  });

  it('rejects a review after an approved card is rejected and keeps history empty', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      await approveOwnNote(db.client, learner, draft.id);
      expect(await listDueCards(db.client, learner)).toHaveLength(1);
      await rejectNote(db.client, learner, draft.id);
      expect(await listDueCards(db.client, learner)).toEqual([]);
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: 'review-rejected-approved',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
    } finally {
      db.close();
    }
  });

  it('never edits, rejects or reveals another learner’s draft', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      await expect(getNote(db.client, other, draft.id)).rejects.toMatchObject({
        code: 'NOT_FOUND'
      });
      await expect(
        updateNote(db.client, other, draft.id, {
          kind: 'basic',
          content: { front: 'a', back: 'b' }
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        rejectNote(db.client, other, draft.id)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await getNote(db.client, learner, draft.id)).status).toBe(
        'draft'
      );
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
    } finally {
      db.close();
    }
  });

  it('deduplicates explicit approval without creating another card', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      await approveOwnNote(db.client, learner, draft.id);
      await approveOwnNote(db.client, learner, draft.id);
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
      expect((await getNote(db.client, learner, draft.id)).status).toBe(
        'approved'
      );
      // The lower-level transition is still a one-way draft -> approved move.
      await expect(
        approveNote(db.client, learner, draft.id)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      db.close();
    }
  });
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

      let foreign: unknown;
      try {
        foreign = await editDraft(
          event({
            userId: other.userId,
            params: { id: note.id },
            method: 'PATCH',
            body: {
              kind: 'basic',
              content: { front: 'a', back: 'b' }
            },
            databaseUrl: target.databaseUrl
          })
        );
      } catch (thrown) {
        foreign = thrown;
      }
      expect(foreign).toMatchObject({ status: 404 });
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
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
      ).rejects.toMatchObject({ status: 401 });
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

  it('keeps a results-page mistake and edits or rejects it on the deck page', async () => {
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
        data: { message: expect.stringContaining('basic front/back') }
      });
      expect(
        await deckActions.reject(
          formEvent({
            params: { id: deckId },
            fields: { noteId },
            databaseUrl: target.databaseUrl
          })
        )
      ).toEqual({ saved: true });
      expect((await getNote(db.client, learner, noteId)).status).toBe(
        'rejected'
      );
    } finally {
      db.close();
    }
  });
});

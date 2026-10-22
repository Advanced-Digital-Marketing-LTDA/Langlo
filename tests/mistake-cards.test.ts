import { afterEach, describe, expect, it } from 'vitest';
import {
  approveNote,
  createDeck,
  createNote,
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
import { disposeFlashcardFixtures } from './fixtures/flashcards';
import {
  attemptId,
  learner,
  noteCounts,
  other,
  setupMistakeCardFixture as setup
} from './fixtures/mistake-cards';

afterEach(disposeFlashcardFixtures);

const refusalCases = [
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

async function expectDraftRefusal(name: string, change: string, code: string) {
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
      expect(note.card).toBeNull();

      // A draft is editable content, not schedulable study material.
      expect((await listDueCards(db.client, learner)).cards).toEqual([]);
      expect(await countDueCards(db.client, learner)).toBe(0);
      expect(await noteCounts(db.client)).toEqual([1, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('refuses drafts for pending, correct, uncertain, unsure, assessment and foreign answers', async () => {
    const { db } = await setup();
    try {
      for (const { name, change, code } of refusalCases)
        await expectDraftRefusal(name, change, code);

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
      expect(await noteCounts(db.client)).toEqual([1, 0, 0]);
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
          draftNoteId: null,
          draftStatus: null
        }
      ]);
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect(
        await listMistakeCandidates(db.client, learner, 'study-a')
      ).toEqual([
        expect.objectContaining({
          draftNoteId: draft.id,
          draftStatus: 'draft'
        })
      ]);
      await approveOwnNote(db.client, learner, draft.id);
      expect(
        await listMistakeCandidates(db.client, learner, 'study-a')
      ).toEqual([
        expect.objectContaining({
          draftNoteId: draft.id,
          draftStatus: 'approved'
        })
      ]);
      await rejectNote(db.client, learner, draft.id);
      expect(
        await listMistakeCandidates(db.client, learner, 'study-a')
      ).toEqual([
        expect.objectContaining({
          draftNoteId: draft.id,
          draftStatus: 'rejected'
        })
      ]);
      await expect(
        listMistakeCandidates(db.client, other, 'study-a')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      db.close();
    }
  });
});

describe('mistake-card validation and explanation fallbacks', () => {
  it('validates draft input before querying', async () => {
    const { db } = await setup();
    try {
      for (const input of [
        { attemptId: '' },
        { attemptId: 7 },
        { attemptId, format: 'other' },
        { attemptId, format: 5 }
      ]) {
        await expect(
          createMistakeDraft(db.client, learner, input as never)
        ).rejects.toMatchObject({
          code: input.attemptId === attemptId ? 'INVALID_FORMAT' : 'NOT_FOUND'
        });
      }
      await expect(
        listMistakeCandidates(db.client, learner, '')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('falls back to the answer text when the lesson has no explanation', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "DELETE FROM lessons WHERE content_version_id = 'content-v1'"
      );
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      expect((await getNote(db.client, learner, draft.id)).explanation).toBe(
        'Correct answer: suis.'
      );
    } finally {
      db.close();
    }
  });

  it('truncates a long lesson explanation to the short-card bound', async () => {
    const { db } = await setup();
    try {
      await db.client.execute({
        sql: "UPDATE lessons SET explanation = ? WHERE content_version_id = 'content-v1'",
        args: ['x'.repeat(700)]
      });
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      const explanation = (await getNote(db.client, learner, draft.id))
        .explanation;
      expect(Array.from(explanation)).toHaveLength(601);
      expect(explanation.endsWith('…')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('rejects a cloze prompt that already contains another numbered group', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "UPDATE questions SET prompt = 'Je ___ {{c2::suis}} étudiant.' WHERE id = 'question-1'"
      );
      await expect(
        createMistakeDraft(db.client, learner, {
          attemptId,
          format: 'cloze'
        })
      ).rejects.toMatchObject({ code: 'INVALID_CLOZE' });
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('serves one draft when duplicate requests race', async () => {
    const { db } = await setup();
    try {
      const [first, second] = await Promise.all([
        createMistakeDraft(db.client, learner, {
          attemptId,
          format: 'basic'
        }),
        createMistakeDraft(db.client, learner, {
          attemptId,
          format: 'basic'
        })
      ]);
      expect(second.id).toBe(first.id);
      expect(first.duplicate).not.toBe(second.duplicate);
      expect(await noteCounts(db.client)).toEqual([1, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('validates note content, source metadata and explanation bounds', async () => {
    const { db } = await setup();
    try {
      const deckId = 'deck-validation';
      await createDeck(db.client, learner, { id: deckId, name: 'Validation' });
      const validContent = { front: 'Bonjour', back: 'Hello' };

      await expect(
        createNote(db.client, learner, {
          id: 'note-invalid-explanation',
          sourceId: `langlo:v1:${'4'.repeat(64)}`,
          deckId,
          kind: 'basic',
          content: validContent,
          explanation: 'x'.repeat(1001)
        })
      ).rejects.toMatchObject({ code: 'INVALID_EXPLANATION' });
      await expect(
        createNote(db.client, learner, {
          id: 'note-invalid-source',
          sourceId: `langlo:v1:${'5'.repeat(64)}`,
          deckId,
          kind: 'basic',
          content: validContent,
          source: { attemptId: '', skillId: '', contentVersionId: '' }
        })
      ).rejects.toMatchObject({ code: 'INVALID_SOURCE' });

      const manual = await createNote(db.client, learner, {
        id: 'note-manual',
        sourceId: `langlo:v1:${'6'.repeat(64)}`,
        deckId,
        kind: 'basic',
        content: validContent
      });
      expect((await getNote(db.client, learner, manual.id)).source).toBeNull();

      await expect(
        updateNote(db.client, learner, 'note-missing', { kind: 'basic' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        updateNote(db.client, learner, manual.id, { kind: 'other' })
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(
        updateNote(db.client, learner, manual.id, {
          kind: 'basic',
          content: { front: '', back: 'Hello' }
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(
        updateNote(db.client, learner, manual.id, {
          kind: 'basic',
          content: validContent,
          explanation: 'x'.repeat(1001)
        })
      ).rejects.toMatchObject({ code: 'INVALID_EXPLANATION' });
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
      expect((await getNote(db.client, learner, draft.id)).card).toBeNull();
      expect((await getNote(db.client, learner, draft.id)).sourceId).toBe(
        before.sourceId
      );

      // Approval keeps the identity, and a later content edit keeps it too.
      await approveOwnNote(db.client, learner, draft.id);
      const approved = await getNote(db.client, learner, draft.id);
      expect(approved.status).toBe('approved');
      expect(approved.card?.id).toBe(draft.cardId);
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
      expect(after.card?.id).toBe(draft.cardId);
      expect(after.card?.revision).toBe(1);
      expect(await noteCounts(db.client)).toEqual([1, 1, 0]);
      expect((await listDueCards(db.client, learner)).cards).toHaveLength(1);
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
      expect((await getNote(db.client, learner, draft.id)).card?.revision).toBe(
        0
      );

      await updateNote(db.client, learner, draft.id, {
        kind: 'basic',
        content: { front: 'Je ___ étudiant.', back: 'suis (être)' }
      });
      const edited = await getNote(db.client, learner, draft.id);
      expect(edited.card?.revision).toBe(1);

      // The form loaded before the edit carries revision 0 and must not apply.
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: '10000000-0000-4000-8000-000000000100',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: '10000000-0000-4000-8000-000000000101',
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

  it('rejects a cloze answer containing a hint separator', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "UPDATE questions SET answer = 'suis::hint' WHERE id = 'question-1'"
      );
      await expect(
        createMistakeDraft(db.client, learner, {
          attemptId,
          format: 'cloze'
        })
      ).rejects.toMatchObject({ code: 'INVALID_CLOZE' });
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('keeps the fallback verdict authoritative over a newer prepared one', async () => {
    const { db } = await setup();
    try {
      // The prepared verdict is newer, but the Jev verdict is the one the
      // results summary counts, so it also decides draft eligibility.
      await db.client.execute(
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('evaluation-fallback', 'learner-a', 'attempt-a', 'jev-1', 'jev-rubric-1', 'correct', unixepoch() * 1000 - 60000)"
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

  it('rejects source metadata that does not match an owner-bound attempt', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES ('deck-prov', 'learner-a', 'Prov')"
      );
      await db.client.execute(
        "INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES ('deck-prov-b', 'learner-b', 'Prov B')"
      );
      const insert = (
        id: string,
        sourceId: string,
        owner: string,
        deck: string,
        skill: string
      ) =>
        db.client.execute({
          sql: 'INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, source_attempt_id, source_skill_id, source_content_version_id) VALUES (?, ?, ?, ?, \'basic\', \'{"front":"a","back":"b"}\', \'attempt-a\', ?, \'content-v1\')',
          args: [id, `langlo:v1:${sourceId}`, owner, deck, skill]
        });
      await expect(
        insert(
          'note-prov-skill',
          '7'.repeat(64),
          'learner-a',
          'deck-prov',
          'other-skill'
        )
      ).rejects.toThrow(/owner attempt/u);
      await expect(
        insert(
          'note-prov-owner',
          '8'.repeat(64),
          'learner-b',
          'deck-prov-b',
          'fr-articles'
        )
      ).rejects.toThrow(/owner attempt/u);
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('rejects a direct insert with a mismatched source content version', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES ('deck-version', 'learner-a', 'Version')"
      );
      await expect(
        db.client.execute({
          sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, source_attempt_id, source_skill_id, source_content_version_id) VALUES ('note-version', ?, 'learner-a', 'deck-version', 'basic', '{\"front\":\"a\",\"back\":\"b\"}', 'attempt-a', 'fr-articles', 'content-v2')",
          args: [`langlo:v1:${'9'.repeat(64)}`]
        })
      ).rejects.toThrow(/owner attempt/u);
      expect(await noteCounts(db.client)).toEqual([0, 0, 0]);
    } finally {
      db.close();
    }
  });

  it('rejects source updates to owner-, skill- or content-mismatched attempts', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      await db.client.execute(
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('attempt-b', 'learner-b', 'study-b', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-b', 'independent', 'un')"
      );
      for (const update of [
        "UPDATE native_flashcard_notes SET source_skill_id = 'other-skill' WHERE id = ?",
        "UPDATE native_flashcard_notes SET source_content_version_id = 'content-v2' WHERE id = ?",
        "UPDATE native_flashcard_notes SET source_attempt_id = 'attempt-b' WHERE id = ?"
      ]) {
        await expect(db.client.execute(update, [draft.id])).rejects.toThrow(
          /owner attempt/u
        );
      }
      expect((await getNote(db.client, learner, draft.id)).source).toEqual({
        attemptId,
        skillId: 'fr-articles',
        contentVersionId: 'content-v1'
      });
    } finally {
      db.close();
    }
  });

  it('accepts valid source metadata after migration 0021', async () => {
    const { db } = await setup();
    try {
      await db.client.execute(
        "INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES ('deck-valid', 'learner-a', 'Valid')"
      );
      await db.client.execute({
        sql: "INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json, source_attempt_id, source_skill_id, source_content_version_id) VALUES ('note-valid', ?, 'learner-a', 'deck-valid', 'basic', '{\"front\":\"a\",\"back\":\"b\"}', 'attempt-a', 'fr-articles', 'content-v1')",
        args: [`langlo:v1:${'a'.repeat(64)}`]
      });
      expect(
        (
          await db.client.execute(
            "SELECT source_attempt_id, source_skill_id, source_content_version_id FROM native_flashcard_notes WHERE id = 'note-valid'"
          )
        ).rows[0]
      ).toEqual({
        source_attempt_id: attemptId,
        source_skill_id: 'fr-articles',
        source_content_version_id: 'content-v1'
      });
    } finally {
      db.close();
    }
  });

  it('revalidates provenance when a note owner is reassigned', async () => {
    const { db } = await setup();
    try {
      const draft = await createMistakeDraft(db.client, learner, {
        attemptId,
        format: 'basic'
      });
      await expect(
        db.client.execute(
          'UPDATE native_flashcard_notes SET owner_id = ? WHERE id = ?',
          [other.userId, draft.id]
        )
      ).rejects.toThrow(/owner attempt/u);
      expect(
        (await getNote(db.client, learner, draft.id)).source
      ).toMatchObject({ attemptId });
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
      ).rejects.toThrow(/source fields|owner attempt/u);

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
      expect((await listDueCards(db.client, learner)).cards).toEqual([]);
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
          submissionId: '10000000-0000-4000-8000-000000000102',
          expectedRevision: 0,
          rating: 'good'
        })
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      expect(await noteCounts(db.client)).toEqual([1, 0, 0]);
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
      expect((await listDueCards(db.client, learner)).cards).toHaveLength(1);
      await rejectNote(db.client, learner, draft.id);
      expect((await listDueCards(db.client, learner)).cards).toEqual([]);
      await expect(
        submitReview(db.client, learner, {
          cardId: draft.cardId,
          submissionId: '10000000-0000-4000-8000-000000000103',
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
      await expect(
        approveOwnNote(db.client, other, draft.id)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await getNote(db.client, learner, draft.id)).status).toBe(
        'draft'
      );
      expect(await noteCounts(db.client)).toEqual([1, 0, 0]);
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

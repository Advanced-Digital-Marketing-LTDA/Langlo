import { afterEach, describe, expect, it } from 'vitest';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  approveNote,
  createDeck,
  createNote,
  getNote,
  submitReview
} from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession,
  testSourceId
} from './fixtures/flashcards';
import {
  isNonEmptyBoundedText,
  normalizeTags,
  validateContent,
  validateExplanation
} from '../src/lib/server/flashcard-validation';

afterEach(disposeFlashcardFixtures);

describe('native flashcard content feasibility', () => {
  it('rejects malformed note metadata at the validation boundary', () => {
    for (const value of [
      42,
      {},
      Array(21).fill('x'),
      ['x'.repeat(65)],
      ['x\0y'],
      [1]
    ]) {
      expect(() => normalizeTags(value)).toThrowError('INVALID_TAGS');
    }
    expect(normalizeTags(' Grammar,grammar, ,verbs')).toEqual([
      'Grammar',
      'verbs'
    ]);
    expect(() =>
      validateContent('unsupported', { front: 'a', back: 'b' })
    ).toThrowError('INVALID_CONTENT');
    expect(() => validateContent('basic', null)).toThrowError(
      'INVALID_CONTENT'
    );
    expect(() => validateExplanation(42)).toThrowError('INVALID_EXPLANATION');
    expect(() => validateExplanation('x\0y')).toThrowError(
      'INVALID_EXPLANATION'
    );
    expect(isNonEmptyBoundedText(42, 64)).toBe(false);
    expect(isNonEmptyBoundedText(' ', 64)).toBe(false);
  });

  it('counts supplementary-plane card text and deck names as Unicode code points at storage limits', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    const supplementaryCharacter = '𐐷';
    try {
      await createDeck(db.client, learner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000010',
        name: 'French'
      });
      await createDeck(db.client, learner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000020',
        name: supplementaryCharacter.repeat(160)
      });
      await expect(
        createDeck(db.client, learner, {
          language: 'fr',
          id: 'deck-10000000-0000-4000-8000-000000000021',
          name: supplementaryCharacter.repeat(161)
        })
      ).rejects.toMatchObject({ code: 'INVALID_DECK' });
      for (const [id, name] of [
        ['deck-10000000-0000-4000-8000-000000000022', '\t\u00a0'],
        ['deck-10000000-0000-4000-8000-000000000023', 'x' + ' '.repeat(160)],
        ['deck-10000000-0000-4000-8000-000000000024', 'French\u0000hidden']
      ]) {
        await expect(
          db.client.execute({
            sql: 'INSERT INTO native_flashcard_decks (id, owner_id, name) VALUES (?, ?, ?)',
            args: [id, learner.userId, name]
          })
        ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
      }
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000010',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000010'),
          deckId: 'deck-10000000-0000-4000-8000-000000000010',
          kind: 'basic',
          content: {
            front: supplementaryCharacter.repeat(4096),
            back: 'valid'
          }
        })
      ).resolves.toMatchObject({ status: 'draft' });
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000011',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000011'),
          deckId: 'deck-10000000-0000-4000-8000-000000000010',
          kind: 'basic',
          content: {
            front: supplementaryCharacter.repeat(4097),
            back: 'valid'
          }
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });

      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000012',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000012'),
          deckId: 'deck-10000000-0000-4000-8000-000000000010',
          kind: 'cloze',
          content: {
            text: `{{c1::${supplementaryCharacter.repeat(4088)}}}`
          }
        })
      ).resolves.toMatchObject({ status: 'draft' });
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000013',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000013'),
          deckId: 'deck-10000000-0000-4000-8000-000000000010',
          kind: 'cloze',
          content: {
            text: `{{c1::${supplementaryCharacter.repeat(4089)}}}`
          }
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    } finally {
      db.close();
    }
  });

  it('stores one restricted Cloze card per note and rejects unsupported Cloze syntax', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000004',
        name: 'French'
      });
      const note = await createNote(db.client, learner, {
        id: 'note-10000000-0000-4000-8000-000000000004',
        sourceId: testSourceId('10000000-0000-4000-8000-000000000004'),
        deckId: 'deck-10000000-0000-4000-8000-000000000004',
        kind: 'cloze',
        content: { text: '{{c1::je}} {{c1::suis}} prêt.' }
      });
      await approveNote(db.client, learner, note.id);
      expect(note.cardId).toBeTruthy();
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000005',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000005'),
          deckId: 'deck-10000000-0000-4000-8000-000000000004',
          kind: 'cloze',
          content: { text: '{{c1::je}} {{c2::suis}} prêt.' }
        })
      ).rejects.toMatchObject({ code: 'INVALID_CLOZE' });
      const reloaded = await openFixtureDatabase(target);
      const learnerReloaded = testSession(learner.userId);
      try {
        await submitReview(reloaded.client, learnerReloaded, {
          cardId: note.cardId,
          submissionId: '10000000-0000-4000-8000-000000000009',
          expectedRevision: 0,
          rating: 'again'
        });
        await expect(
          getNote(reloaded.client, learnerReloaded, note.id)
        ).resolves.toMatchObject({
          status: 'approved',
          card: { revision: 1, schedulerVersion: 'ts-fsrs@5.4.2' }
        });
      } finally {
        reloaded.close();
      }
    } finally {
      db.close();
    }
  });

  it.each([
    ['Basic with Cloze fields', 'basic', { text: '{{c1::bonjour}}' }],
    [
      'Basic with an embedded NUL',
      'basic',
      { front: 'Hello\u0000 hidden', back: 'Bonjour' }
    ],
    ['Cloze with Basic fields', 'cloze', { front: 'Bonjour', back: 'Hello' }],
    ['oversized Cloze text', 'cloze', { text: `{{c1::${'x'.repeat(4090)}}}` }]
  ] as const)('rejects %s before persistence', async (_case, kind, content) => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000010',
        name: 'French'
      });
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000010',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000010'),
          deckId: 'deck-10000000-0000-4000-8000-000000000010',
          kind,
          content
        } as unknown as Parameters<typeof createNote>[2])
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    } finally {
      db.close();
    }
  });

  it.each([
    [
      'extra Basic fields',
      'basic',
      { front: 'Hello', back: 'Bonjour', extra: 'x' },
      ''
    ],
    [
      'an embedded NUL in the source ID',
      'basic',
      { front: 'Bonjour', back: 'Hello' },
      '\u0000'
    ],
    [
      'an embedded NUL in Basic text',
      'basic',
      { front: 'Hello\u0000 hidden', back: 'Bonjour' },
      ''
    ],
    [
      'Unicode-whitespace-only text',
      'basic',
      { front: '\t\n\u00a0\ufeff', back: 'Hello' },
      ''
    ],
    [
      'oversized Basic text',
      'basic',
      { front: 'x'.repeat(4097), back: 'Hello' },
      ''
    ],
    [
      'oversized padded Basic text',
      'basic',
      { front: `x${' '.repeat(4096)}`, back: 'Hello' },
      ''
    ],
    [
      'oversized padded Cloze text',
      'cloze',
      { text: `{{c1::x}}${' '.repeat(4088)}` },
      ''
    ]
  ] as const)(
    'rejects %s in direct SQL note writes',
    async (_case, kind, content, sourceIdSuffix) => {
      const target = await fixture();
      const learner = testSession('learner-a');
      const db = await openFixtureDatabase(target);
      try {
        await createDeck(db.client, learner, {
          language: 'fr',
          id: 'deck-10000000-0000-4000-8000-000000000010',
          name: 'French'
        });
        await expect(
          db.client.execute({
            sql: 'INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json) VALUES (?, ?, ?, ?, ?, ?)',
            args: [
              'note-10000000-0000-4000-8000-000000000015',
              testSourceId('10000000-0000-4000-8000-000000000015') +
                sourceIdSuffix,
              learner.userId,
              'deck-10000000-0000-4000-8000-000000000010',
              kind,
              JSON.stringify(content)
            ]
          })
        ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
      } finally {
        db.close();
      }
    }
  );

  it('rejects oversized Basic text before attempting persistence', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000013',
        name: 'French'
      });
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000018',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000018'),
          deckId: 'deck-10000000-0000-4000-8000-000000000013',
          kind: 'basic',
          content: { front: 'x'.repeat(4097), back: 'y' }
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    } finally {
      db.close();
    }
  });

  it('validates runtime create inputs and returns NOT_FOUND for another learner deck', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const otherLearner = testSession('learner-b');
    const db = await openFixtureDatabase(target);
    try {
      await expect(
        createDeck(db.client, learner, {
          language: 'fr',
          id: 'deck-invalid',
          name: null
        } as never)
      ).rejects.toMatchObject({ code: 'INVALID_DECK' });
      await createDeck(db.client, otherLearner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000032',
        name: 'Other learner'
      });
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000032',
          sourceId: testSourceId('10000000-0000-4000-8000-000000000032'),
          deckId: 'deck-10000000-0000-4000-8000-000000000032',
          kind: 'basic',
          content: { front: 'Bonjour', back: 'Hello' }
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      db.close();
    }
  });

  it('requires source IDs to use the persistent Langlo identity format', async () => {
    const target = await fixture();
    const learner = testSession('learner-a');
    const db = await openFixtureDatabase(target);
    try {
      await createDeck(db.client, learner, {
        language: 'fr',
        id: 'deck-10000000-0000-4000-8000-000000000020',
        name: 'French'
      });
      await expect(
        createNote(db.client, learner, {
          id: 'note-10000000-0000-4000-8000-000000000020',
          sourceId: 'not-a-persistent-source-id',
          deckId: 'deck-10000000-0000-4000-8000-000000000020',
          kind: 'basic',
          content: { front: 'Bonjour', back: 'Hello' }
        })
      ).rejects.toMatchObject({ code: 'INVALID_SOURCE_ID' });
      await expect(
        db.client.execute({
          sql: 'INSERT INTO native_flashcard_notes (id, source_id, owner_id, deck_id, kind, content_json) VALUES (?, ?, ?, ?, ?, ?)',
          args: [
            'note-10000000-0000-4000-8000-000000000021',
            'not-a-persistent-source-id',
            learner.userId,
            'deck-10000000-0000-4000-8000-000000000020',
            'basic',
            JSON.stringify({ front: 'Bonjour', back: 'Hello' })
          ]
        })
      ).rejects.toThrow(/CHECK|CONSTRAINT/iu);
    } finally {
      db.close();
    }
  });
});

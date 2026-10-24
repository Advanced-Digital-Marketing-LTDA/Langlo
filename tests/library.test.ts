import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import {
  createLibraryDocument,
  deleteLibraryDocument,
  getLibraryDocument,
  listLibraryDocuments,
  listLibraryVocabulary,
  renameLibraryDocument,
  saveLibraryVocabulary,
  updateLibraryProgress
} from '../src/lib/server/library';
import { getNote, createDeck, updateNote } from '../src/lib/server/flashcards';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';

const ownerA = testSession('learner-a');
const ownerB = testSession('learner-b');
let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

describe('Library documents', () => {
  async function vocabularyFixture() {
    await createLibraryDocument(client, ownerA, {
      id: 'vocabulary-document',
      title: 'Words',
      language: 'fr',
      content: 'La maison est grande.'
    });
    for (const id of ['deck-one', 'deck-two'])
      await createDeck(client, ownerA, { id, name: id, language: 'fr' });
    return {
      documentId: 'vocabulary-document',
      deckId: 'deck-one',
      term: 'maison',
      definition: 'house'
    };
  }

  it('saves the same vocabulary to the selected deck', async () => {
    const input = await vocabularyFixture();
    const first = await saveLibraryVocabulary(client, ownerA, input);
    const second = await saveLibraryVocabulary(client, ownerA, {
      ...input,
      deckId: 'deck-two'
    });
    expect(second.id).not.toBe(first.id);
    expect(await getNote(client, ownerA, second.id)).toMatchObject({
      deckId: 'deck-two'
    });
  });

  it('returns the same note for concurrent duplicate saves', async () => {
    const input = await vocabularyFixture();
    const notes = await Promise.all(
      Array.from({ length: 4 }, () =>
        saveLibraryVocabulary(client, ownerA, input)
      )
    );
    expect(new Set(notes.map((note) => note.id)).size).toBe(1);
    expect(
      (await client.execute('SELECT id FROM native_flashcard_notes')).rows
    ).toHaveLength(1);
  });

  it.each([
    { name: 'moved', edit: { deckId: 'deck-two' } },
    {
      name: 'edited',
      edit: { content: { front: 'maison', back: 'my edited definition' } }
    },
    { name: 'untagged', edit: { tags: [] } }
  ])(
    'reports a $name card instead of claiming an unchanged vocabulary save',
    async ({ edit }) => {
      const input = await vocabularyFixture();
      const saved = await saveLibraryVocabulary(client, ownerA, input);
      await updateNote(client, ownerA, saved.id, edit);
      const edited = await getNote(client, ownerA, saved.id);
      await expect(
        saveLibraryVocabulary(client, ownerA, input)
      ).rejects.toMatchObject({ code: 'LIBRARY_VOCABULARY_CHANGED' });
      expect(await getNote(client, ownerA, saved.id)).toEqual(edited);
      expect(
        (await client.execute('SELECT id FROM native_flashcard_notes')).rows
      ).toHaveLength(1);
    }
  );

  it('accepts a definition at the advertised length limit', async () => {
    const input = await vocabularyFixture();
    const note = await saveLibraryVocabulary(client, ownerA, {
      ...input,
      definition: 'a'.repeat(4096)
    });
    expect(await getNote(client, ownerA, note.id)).toMatchObject({
      content: { back: 'a'.repeat(4096) }
    });
  });

  it('keeps documents, progress, and vocabulary private to the owner', async () => {
    const document = {
      id: 'library-doc-a',
      title: 'Mon livre',
      language: 'fr' as const,
      content: 'La maison est grande. Voici une maison.'
    };
    await createLibraryDocument(client, ownerA, document);

    expect(await listLibraryDocuments(client, ownerA)).toMatchObject([
      { id: document.id, title: 'Mon livre', language: 'fr', sentenceCount: 2 }
    ]);
    expect(await listLibraryDocuments(client, ownerB)).toEqual([]);
    await expect(
      getLibraryDocument(client, ownerB, document.id)
    ).rejects.toThrow('NOT_FOUND');

    await expect(
      updateLibraryProgress(client, ownerB, document.id, 1)
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      renameLibraryDocument(client, ownerB, document.id, 'Stolen')
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      deleteLibraryDocument(client, ownerB, document.id)
    ).rejects.toThrow('NOT_FOUND');

    await createDeck(client, ownerA, {
      id: 'library-deck-a',
      name: 'Français',
      language: 'fr'
    });
    const saved = await saveLibraryVocabulary(client, ownerA, {
      documentId: document.id,
      deckId: 'library-deck-a',
      term: 'maison',
      definition: 'house'
    });
    expect(await getNote(client, ownerA, saved.id)).toMatchObject({
      status: 'draft',
      content: { front: 'maison', back: 'house' },
      tags: ['library-vocabulary']
    });
    expect(await listLibraryVocabulary(client, ownerA, 'fr')).toContain(
      'maison'
    );
    expect(await listLibraryVocabulary(client, ownerB, 'fr')).toEqual([]);

    await updateLibraryProgress(client, ownerA, document.id, 1);
    await renameLibraryDocument(client, ownerA, document.id, 'Le livre');
    expect(await getLibraryDocument(client, ownerA, document.id)).toMatchObject(
      {
        title: 'Le livre',
        progressIndex: 1
      }
    );
  });

  it('deletes documents with their owner account', async () => {
    await createLibraryDocument(client, ownerA, {
      id: 'library-doc-cascade',
      title: 'À supprimer',
      language: 'fr',
      content: 'Bonjour.'
    });
    await client.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [ownerA.userId]
    });

    expect(
      (await client.execute('SELECT id FROM library_documents')).rows
    ).toEqual([]);
  });
});

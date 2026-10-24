import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import {
  createLibraryDocument,
  deleteLibraryDocument,
  getLibraryDocument,
  getLibraryDocumentFile,
  listLibraryDocuments,
  listLibraryVocabulary,
  renameLibraryDocument,
  saveLibraryVocabulary,
  updateLibraryProgress
} from '../src/lib/server/library';
import {
  beginWrite,
  getNote,
  createDeck,
  updateNote
} from '../src/lib/server/flashcards';
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
  it.each(['create', 'rename', 'progress', 'delete'] as const)(
    'queues a Library %s behind an open transaction',
    async (operation) => {
      const document = {
        id: 'queued-document',
        title: 'Original',
        language: 'fr' as const,
        content: 'Bonjour.'
      };
      if (operation !== 'create')
        await createLibraryDocument(client, ownerA, document);
      const holder = await beginWrite(client);
      const operations = {
        create: () => createLibraryDocument(client, ownerA, document),
        rename: () =>
          renameLibraryDocument(client, ownerA, document.id, 'Renamed'),
        progress: () =>
          updateLibraryProgress(client, ownerA, document.id, 'page:1', 1),
        delete: () => deleteLibraryDocument(client, ownerA, document.id)
      };
      let finished = false;
      const write = operations[operation]().then(
        () => {
          finished = true;
          return null;
        },
        (error: unknown) => {
          finished = true;
          return error;
        }
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(finished).toBe(false);
      } finally {
        await holder.commit();
        holder.close();
      }
      expect(await write).toBeNull();
      if (operation === 'delete') {
        await expect(
          getLibraryDocument(client, ownerA, document.id)
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } else {
        expect(
          await getLibraryDocument(client, ownerA, document.id)
        ).toMatchObject({
          title: operation === 'rename' ? 'Renamed' : 'Original',
          progressIndex: operation === 'progress' ? 1 : 0
        });
      }
    }
  );

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
      updateLibraryProgress(client, ownerB, document.id, 'page:1', 0.5)
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

    await updateLibraryProgress(client, ownerA, document.id, 'page:1', 0.5);
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

  it('stores the original file with the document and removes it with the document', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await createLibraryDocument(client, ownerA, {
      id: 'library-original',
      title: 'Book',
      language: 'fr',
      content: 'Bonjour.',
      original: { format: 'epub', bytes }
    });
    expect(
      await getLibraryDocument(client, ownerA, 'library-original')
    ).toMatchObject({ originalFormat: 'epub', progressLocation: null });
    expect(
      await getLibraryDocumentFile(client, ownerA, 'library-original')
    ).toEqual({ format: 'epub', bytes });
    await expect(
      getLibraryDocumentFile(client, ownerB, 'library-original')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await deleteLibraryDocument(client, ownerA, 'library-original');
    expect(
      (await client.execute('SELECT * FROM library_document_files')).rows
    ).toEqual([]);
  });

  it('does not keep a document whose original file cannot be stored', async () => {
    await expect(
      createLibraryDocument(client, ownerA, {
        id: 'library-empty-original',
        title: 'Book',
        language: 'fr',
        content: 'Bonjour.',
        original: { format: 'pdf', bytes: new Uint8Array() }
      })
    ).rejects.toThrow();
    expect(await listLibraryDocuments(client, ownerA)).toEqual([]);
  });

  it.each([
    ['', 0.5],
    ['page:1', -0.1],
    ['page:1', 1.1],
    ['page:1', Number.NaN],
    ['x'.repeat(513), 0.5]
  ])('rejects the position %j at %j', async (location, fraction) => {
    await createLibraryDocument(client, ownerA, {
      id: 'library-position',
      title: 'Book',
      language: 'fr',
      content: 'Bonjour.'
    });
    await expect(
      updateLibraryProgress(
        client,
        ownerA,
        'library-position',
        location,
        fraction
      )
    ).rejects.toMatchObject({ code: 'INVALID_LIBRARY_PROGRESS' });
  });
});

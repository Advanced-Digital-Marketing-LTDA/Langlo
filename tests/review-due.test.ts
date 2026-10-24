import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  countDueCards,
  flashcardDueGroups,
  listDueCards,
  type DueScope
} from '../src/lib/server/flashcard-views';
import {
  approveNote,
  createDeck,
  createNote,
  listDecks,
  type DeckLanguage
} from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession,
  testSourceId
} from './fixtures/flashcards';

afterEach(disposeFlashcardFixtures);

const learner = testSession('learner-a');
const day = { start: 10_000, end: 20_000 };
const now = 15_000;
let serial = 0;

async function dueCard(
  client: Client,
  deckId: string,
  front: string,
  dueAt: number
) {
  serial += 1;
  const id = `note-review-due-${serial}`;
  await createNote(client, learner, {
    id,
    sourceId: testSourceId(
      `10000000-0000-4000-8000-${String(serial).padStart(12, '0')}`
    ),
    deckId,
    kind: 'basic',
    content: { front, back: 'x' }
  });
  await approveNote(client, learner, id);
  await client.execute({
    sql: 'UPDATE native_flashcards SET due_at = ? WHERE note_id = ? AND owner_id = ?',
    args: [dueAt, id, learner.userId]
  });
}

async function deck(client: Client, id: string, language: DeckLanguage) {
  await createDeck(client, learner, { id, name: id, language });
}

async function withDatabase(run: (client: Client) => Promise<void>) {
  const db = await openFixtureDatabase(await fixture());
  try {
    await run(db.client);
  } finally {
    db.close();
  }
}

describe('due flashcards on the Review tab', () => {
  it('stores the language chosen for a new deck and rejects an unknown one', async () => {
    await withDatabase(async (client) => {
      await deck(client, 'deck-pt', 'pt');
      expect(await listDecks(client, learner)).toMatchObject([
        { id: 'deck-pt', language: 'pt' }
      ]);
      await expect(
        createDeck(client, learner, {
          id: 'deck-xx',
          name: 'Unknown',
          language: 'xx' as DeckLanguage
        })
      ).rejects.toMatchObject({ code: 'INVALID_DECK_LANGUAGE' });
    });
  });

  it('splits each language into overdue, due now and due later today', async () => {
    await withDatabase(async (client) => {
      await deck(client, 'deck-fr', 'fr');
      await deck(client, 'deck-de', 'de');
      await deck(client, 'deck-legacy', 'fr');
      // A deck from before decks had a language, with no source content.
      await client.execute(
        "UPDATE native_flashcard_decks SET language = NULL WHERE id = 'deck-legacy'"
      );
      await dueCard(client, 'deck-fr', 'fr overdue', day.start - 1);
      await dueCard(client, 'deck-fr', 'fr today', day.start);
      await dueCard(client, 'deck-fr', 'fr now', now);
      await dueCard(client, 'deck-fr', 'fr later', 18_000);
      await dueCard(client, 'deck-fr', 'fr tomorrow', day.end);
      await dueCard(client, 'deck-de', 'de overdue', 0);
      await dueCard(client, 'deck-legacy', 'legacy today', 12_000);

      expect(await flashcardDueGroups(client, learner, day, now)).toEqual([
        {
          language: null,
          overdue: 0,
          todayReady: 1,
          todayLater: 0,
          nextDueAt: null
        },
        {
          language: 'de',
          overdue: 1,
          todayReady: 0,
          todayLater: 0,
          nextDueAt: null
        },
        {
          language: 'fr',
          overdue: 1,
          todayReady: 2,
          todayLater: 1,
          nextDueAt: 18_000
        }
      ]);
    });
  });

  it('serves only due cards of the chosen language and part of the day', async () => {
    await withDatabase(async (client) => {
      await deck(client, 'deck-fr', 'fr');
      await deck(client, 'deck-de', 'de');
      await deck(client, 'deck-legacy', 'fr');
      await client.execute(
        "UPDATE native_flashcard_decks SET language = NULL WHERE id = 'deck-legacy'"
      );
      await dueCard(client, 'deck-fr', 'fr overdue', day.start - 1);
      await dueCard(client, 'deck-fr', 'fr now', now);
      await dueCard(client, 'deck-fr', 'fr later', 18_000);
      await dueCard(client, 'deck-de', 'de now', now);
      await dueCard(client, 'deck-legacy', 'legacy now', now);
      const scope = (
        language: DeckLanguage | null,
        bucket: DueScope['bucket']
      ): DueScope => ({ language, bucket, day });
      const fronts = async (chosen: DueScope) =>
        (await listDueCards(client, learner, now, 20, chosen)).cards.map(
          (card) => card.content.front
        );

      expect(await fronts(scope('fr', 'overdue'))).toEqual(['fr overdue']);
      // No early review: the card due later today is not served yet.
      expect(await fronts(scope('fr', 'today'))).toEqual(['fr now']);
      expect(await fronts(scope('de', 'today'))).toEqual(['de now']);
      expect(await fronts(scope(null, 'today'))).toEqual(['legacy now']);
      expect(await fronts(scope(null, 'overdue'))).toEqual([]);
      expect(
        await countDueCards(client, learner, now, scope('fr', 'today'))
      ).toBe(1);
      expect(
        await countDueCards(client, learner, now, scope('de', 'overdue'))
      ).toBe(0);
    });
  });
});

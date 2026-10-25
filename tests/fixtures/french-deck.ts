import { createDeck as createLanguageDeck } from '../../src/lib/server/flashcards';

/** A French deck, for tests that do not depend on the deck's language. */
export function createDeck(
  client: Parameters<typeof createLanguageDeck>[0],
  session: Parameters<typeof createLanguageDeck>[1],
  deck: { id: string; name: string }
) {
  return createLanguageDeck(client, session, { ...deck, language: 'fr' });
}

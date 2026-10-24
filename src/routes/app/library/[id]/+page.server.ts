import type { PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import {
  getLibraryDocument,
  listLibraryVocabulary
} from '../../../../lib/server/library';
import { listDecks } from '../../../../lib/server/flashcards';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const { content, ...document } = await getLibraryDocument(
      client,
      learner,
      event.params.id
    );
    const [decks, savedTerms] = await Promise.all([
      listDecks(client, learner),
      listLibraryVocabulary(client, learner, document.language)
    ]);
    return {
      document,
      // The original file is fetched by the reader; only text-only documents
      // are read from the extracted text.
      text: document.originalFormat ? null : content,
      decks: decks.filter((deck) => deck.language === document.language),
      savedTerms
    };
  });

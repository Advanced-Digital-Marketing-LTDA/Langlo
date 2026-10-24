import type { PageServerLoad } from './$types';
import { studyPage } from '../../../../lib/server/learner-api';
import {
  getLibraryDocument,
  libraryTargetLanguage,
  listLibraryVocabulary
} from '../../../../lib/server/library';
import { listDecks } from '../../../../lib/server/flashcards';
import { splitSentences } from '../../../../lib/library-text';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const document = await getLibraryDocument(client, learner, event.params.id);
    const [decks, savedTerms, targetLanguage] = await Promise.all([
      listDecks(client, learner),
      listLibraryVocabulary(client, learner, document.language),
      libraryTargetLanguage(client, learner, document.language)
    ]);
    return {
      document,
      sentences: splitSentences(document.content),
      decks: decks.filter((deck) => deck.language === document.language),
      savedTerms,
      targetLanguage
    };
  });

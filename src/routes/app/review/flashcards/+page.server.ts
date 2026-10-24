import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { studyForm, studyPage } from '../../../../lib/server/learner-api';
import {
  DECK_LANGUAGES,
  submitReview,
  type DeckLanguage
} from '../../../../lib/server/flashcards';
import {
  countDueCards,
  currentStudyDay,
  listDueCards,
  type DueScope
} from '../../../../lib/server/flashcard-views';
import { StudyError } from '../../../../lib/server/study-error';
import {
  reviewLanguageParam,
  UNASSIGNED_LANGUAGE
} from '../../../../lib/review-due';

type ReviewRating = Parameters<typeof submitReview>[2]['rating'];

/** The language and part of the study day chosen on the Review tab. */
function requestedScope(url: URL): Omit<DueScope, 'day'> {
  const language = url.searchParams.get('language');
  const bucket = url.searchParams.get('due');
  if (bucket !== 'overdue' && bucket !== 'today')
    throw new StudyError('NOT_FOUND');
  if (language === UNASSIGNED_LANGUAGE) return { language: null, bucket };
  if (!(DECK_LANGUAGES as readonly (string | null)[]).includes(language))
    throw new StudyError('NOT_FOUND');
  return { language: language as DeckLanguage, bucket };
}

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const now = Date.now();
    const scope: DueScope = {
      ...requestedScope(event.url),
      day: await currentStudyDay(client, learner, now)
    };
    return {
      ...(await listDueCards(client, learner, now, 20, scope)),
      total: await countDueCards(client, learner, now, scope),
      language: reviewLanguageParam(scope.language),
      due: scope.bucket,
      submissionKey: randomUUID()
    };
  });

export const actions: Actions = {
  rate: async (event) => {
    const form = await event.request.formData();
    return studyForm(
      event,
      (client, learner) =>
        submitReview(client, learner, {
          cardId: String(form.get('cardId') ?? ''),
          submissionId: String(form.get('submissionKey') ?? ''),
          expectedRevision: Number(form.get('revision')),
          expectedScheduleKey: String(form.get('scheduleKey') ?? ''),
          rating: String(form.get('rating') ?? '') as ReviewRating
        }),
      { reviewed: true }
    );
  }
};

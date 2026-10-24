import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { formResult, studyPage } from '../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../lib/server/learner-session';
import { listEnrollments } from '../../../lib/server/enrollment';
import {
  currentStudyDay,
  flashcardDueGroups
} from '../../../lib/server/flashcard-views';
import { grammarDueToday } from '../../../lib/server/grammar-retention';
import { startGrammarReview } from '../../../lib/server/practice';
import { StudyError } from '../../../lib/server/study-error';
import {
  reviewLanguageParam,
  UNASSIGNED_LANGUAGE
} from '../../../lib/review-due';

/** A grammar review session takes at most this many topics. */
const grammarSessionLimit = 5;

function timeOfDay(timestamp: number | null, timezone: string) {
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);
}

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const now = Date.now();
    const day = await currentStudyDay(client, learner, now);
    const [enrollments, groups] = await Promise.all([
      listEnrollments(client, learner),
      flashcardDueGroups(client, learner, day, now)
    ]);
    const unassigned = groups.find((group) => group.language === null);
    const languages: string[] = enrollments.map((item) => item.language);
    if (unassigned) languages.push(UNASSIGNED_LANGUAGE);
    const requested = event.url.searchParams.get('language');
    if (requested !== null && !languages.includes(requested))
      throw new StudyError('NOT_FOUND');
    const language = requested ?? languages[0] ?? null;
    if (language === null) return { languages, language, submissionKey: '' };
    // A language with no card due before the day ends has no group.
    const flashcards = groups.find(
      (group) => reviewLanguageParam(group.language) === language
    ) ?? { overdue: 0, todayReady: 0, todayLater: 0, nextDueAt: null };
    const grammar =
      language === UNASSIGNED_LANGUAGE
        ? null
        : await grammarDueToday(client, learner, language, day, now);
    const laterToday = (items: { dueAt: number; ready: boolean }[]) =>
      items.find((item) => !item.ready)?.dueAt ?? null;
    return {
      languages,
      language,
      submissionKey: randomUUID(),
      flashcards: {
        overdue: flashcards.overdue,
        today: flashcards.todayReady + flashcards.todayLater,
        todayReady: flashcards.todayReady,
        nextDueAt: timeOfDay(flashcards.nextDueAt, day.timezone)
      },
      grammar: grammar && {
        overdue: grammar.overdue,
        today: grammar.today,
        nextDueAt: timeOfDay(laterToday(grammar.today), day.timezone)
      }
    };
  });

/** Start a grammar review of the oldest ready topics of one part of the day. */
async function startDueGrammarReview(
  event: Parameters<Actions[string]>[0],
  form: FormData
) {
  const language = String(form.get('language') ?? '');
  const bucket = form.get('due');
  return studyPage(event, async (client, learner) => {
    if (bucket !== 'overdue' && bucket !== 'today')
      throw new StudyError('NOT_FOUND');
    const now = Date.now();
    const day = await currentStudyDay(client, learner, now);
    const due = await grammarDueToday(client, learner, language, day, now);
    const skillIds = due[bucket]
      .filter((skill) => skill.ready)
      .slice(0, grammarSessionLimit)
      .map((skill) => skill.skillId);
    if (!skillIds.length) throw new StudyError('STALE_GRAMMAR_REVIEW');
    return startGrammarReview(client, learner, {
      language,
      submissionKey: form.get('submissionKey'),
      skillIds
    });
  });
}

export const actions: Actions = {
  grammar: async (event) => {
    requireLearnerApi(event);
    const form = await event.request.formData();
    let reviewId = '';
    const failed = await formResult(async () => {
      reviewId = (await startDueGrammarReview(event, form)).id;
    }, null);
    if (failed) return failed;
    redirect(303, `/app/session/${encodeURIComponent(reviewId)}`);
  }
};

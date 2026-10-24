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

type DueGroup = Awaited<ReturnType<typeof flashcardDueGroups>>[number];
type DueTopic = { dueAt: number; ready: boolean };

/**
 * The switcher's choices and the chosen one; an unknown choice is not found.
 * Unassigned is offered while its cards are due and stays valid once chosen,
 * so returning from its emptied queue still works.
 */
function chosenLanguage(
  enrolled: string[],
  groups: DueGroup[],
  requested: string | null
) {
  const languages =
    requested === UNASSIGNED_LANGUAGE ||
    groups.some((group) => group.language === null)
      ? [...enrolled, UNASSIGNED_LANGUAGE]
      : enrolled;
  if (requested !== null && !languages.includes(requested))
    throw new StudyError('NOT_FOUND');
  return { languages, language: requested ?? languages[0] ?? null };
}

/** The chosen language's card counts; no group means nothing is due today. */
function flashcardSummary(
  groups: DueGroup[],
  language: string,
  timezone: string
) {
  const group = groups.find(
    (item) => reviewLanguageParam(item.language) === language
  ) ?? { overdue: 0, todayReady: 0, todayLater: 0, nextDueAt: null };
  return {
    overdue: group.overdue,
    today: group.todayReady + group.todayLater,
    todayReady: group.todayReady,
    nextDueAt: timeOfDay(group.nextDueAt, timezone)
  };
}

function grammarSummary(
  grammar: { overdue: DueTopic[]; today: DueTopic[] },
  timezone: string
) {
  const later = grammar.today.find((topic) => !topic.ready);
  return {
    overdue: grammar.overdue,
    today: grammar.today,
    nextDueAt: later ? timeOfDay(later.dueAt, timezone) : null
  };
}

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => {
    const now = Date.now();
    const day = await currentStudyDay(client, learner, now);
    const [enrollments, groups] = await Promise.all([
      listEnrollments(client, learner),
      flashcardDueGroups(client, learner, day, now)
    ]);
    const { languages, language } = chosenLanguage(
      enrollments.map((item) => item.language),
      groups,
      event.url.searchParams.get('language')
    );
    if (language === null) return { languages, language, submissionKey: '' };
    const grammar =
      language === UNASSIGNED_LANGUAGE
        ? null
        : await grammarDueToday(client, learner, language, { ...day, now });
    return {
      languages,
      language,
      submissionKey: randomUUID(),
      flashcards: flashcardSummary(groups, language, day.timezone),
      grammar: grammar && grammarSummary(grammar, day.timezone)
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
    const due = await grammarDueToday(client, learner, language, {
      ...day,
      now
    });
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

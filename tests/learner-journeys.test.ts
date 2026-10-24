import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  enroll,
  listEnrollments,
  setExplanationLanguage
} from '../src/lib/server/enrollment';
import { getTimezone, setTimezone } from '../src/lib/server/preferences';
import { pauseStudySession, recordAttempt } from '../src/lib/server/study';
import { recordAnswer } from '../src/lib/server/lesson-practice';
import type { FallbackResult } from '../src/lib/server/evaluation/fallback';
import {
  discardPractice,
  finishPractice,
  finishReviewedGrammarReview,
  practiceResultsPath,
  practiceSummary,
  startPractice,
  startPracticeOver,
  unfinishedGrammarReview,
  unfinishedPractice
} from '../src/lib/server/practice';
import {
  addNoteFromForm,
  countDueCards,
  exportDeckForAnki,
  listDueCards,
  listNotes,
  searchNotes
} from '../src/lib/server/flashcard-views';
import {
  approveNote,
  createNote,
  getStudySchedule,
  getNote,
  listReviewEvents,
  rejectNote,
  saveStudySchedule,
  setCardSuspended,
  submitReview,
  updateNote
} from '../src/lib/server/flashcards';
import { createDeck } from './fixtures/french-deck';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import {
  actions as enrollActions,
  load as enrollLoad
} from '../src/routes/app/enroll/+page.server';
import {
  actions as settingsActions,
  load as settingsLoad
} from '../src/routes/app/settings/+page.server';
import {
  actions as practiceActions,
  load as practiceLoad
} from '../src/routes/app/practice/[language]/+page.server';
import { load as sessionLoad } from '../src/routes/app/session/[id]/+page.server';
import { actions as sessionActions } from '../src/routes/app/session/[id]/+page.server';
import { load as resultsLoad } from '../src/routes/app/session/[id]/results/+page.server';
import {
  actions as decksActions,
  load as decksLoad
} from '../src/routes/app/decks/+page.server';
import {
  actions as deckActions,
  load as deckLoad
} from '../src/routes/app/decks/[id]/+page.server';
import { GET as exportDeck } from '../src/routes/app/decks/[id]/export/+server';
import {
  actions as reviewActions,
  load as reviewLoad
} from '../src/routes/app/review/flashcards/+page.server';
import {
  actions as reviewTabActions,
  load as reviewTabLoad
} from '../src/routes/app/review/+page.server';

import { importContent } from '../src/lib/server/content-import';
import { approvedPackage } from './fixtures/content-package';
import {
  actions as lessonActions,
  load as lessonLoad
} from '../src/routes/app/learn/[language]/lesson/[skill]/+page.server';
import { actions as dashboardActions } from '../src/routes/app/+page.server';
import { load as analyticsLoad } from '../src/routes/app/analytics/+page.server';
import * as authRuntime from '../src/lib/server/auth-runtime';
import { studyDayStart } from '../src/lib/server/study-days';

const learner = testSession('learner-a');
const other = testSession('learner-b');
let client: Client;
let close: () => void;
let databaseUrl: string;

beforeEach(async () => {
  const target = await fixture();
  databaseUrl = target.databaseUrl;
  ({ client, close } = await openFixtureDatabase(target));
  await client.execute("INSERT INTO users (id) VALUES ('fresh')");
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  close?.();
  await disposeFlashcardFixtures();
});

function event(
  options: {
    userId?: string | null;
    params?: Record<string, string>;
    fields?: Record<string, string>;
    query?: string;
    config?: RuntimeConfig | undefined;
  } = {}
) {
  const userId = options.userId === undefined ? 'learner-a' : options.userId;
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields ?? {}))
    form.set(key, value);
  const url = `http://127.0.0.1/app${options.query ?? ''}`;
  return {
    params: options.params ?? {},
    url: new URL(url),
    locals: {
      correlationId: '12345678-1234-4123-8123-123456789abc',
      user: userId ? { id: userId } : null,
      session: userId ? { userId } : null,
      config: Object.hasOwn(options, 'config')
        ? options.config
        : ({ dataEnabled: true, databaseUrl } as RuntimeConfig)
    },
    request: new Request(
      url,
      options.fields ? { method: 'POST', body: form } : undefined
    )
  } as never;
}

/** The flashcard reviewer opened for today's French cards. */
const todaysCards = () =>
  event({ query: '/review/flashcards?language=fr&due=today' });

async function seedReviewAnalyticsNotes() {
  await createDeck(client, learner, {
    id: 'analytics-deck-a',
    name: 'Analytics'
  });
  await createDeck(client, other, { id: 'analytics-deck-b', name: 'Other' });
  const notes = [
    { id: 'analytics-overdue', owner: learner, deck: 'analytics-deck-a' },
    { id: 'analytics-today', owner: learner, deck: 'analytics-deck-a' },
    { id: 'analytics-boundary', owner: learner, deck: 'analytics-deck-a' },
    { id: 'analytics-tomorrow', owner: learner, deck: 'analytics-deck-a' },
    { id: 'analytics-suspended', owner: learner, deck: 'analytics-deck-a' },
    { id: 'analytics-rejected', owner: learner, deck: 'analytics-deck-a' },
    { id: 'analytics-other-owner', owner: other, deck: 'analytics-deck-b' },
    { id: 'analytics-outside', owner: learner, deck: 'analytics-deck-a' }
  ];
  for (const [index, note] of notes.entries()) {
    await createNote(client, note.owner, {
      id: note.id,
      sourceId: `langlo:v1:${String(index + 1).padStart(64, '0')}`,
      deckId: note.deck,
      kind: 'basic',
      content: { front: 'Front', back: 'Back' }
    });
    await approveNote(client, note.owner, note.id);
  }
  await rejectNote(client, learner, 'analytics-rejected');
  await client.execute({
    sql: 'UPDATE native_flashcards SET suspended = 1 WHERE note_id = ?',
    args: ['analytics-suspended']
  });
}

async function setReviewAnalyticsDueTimes(
  now: Date,
  timezone: string
): Promise<string[]> {
  const today = studyDayStart(now, timezone);
  const tomorrow = studyDayStart(now, timezone, 1);
  const outside = studyDayStart(now, timezone, 7);
  const dueTimes = [
    ['analytics-overdue', today.getTime() - 1],
    ['analytics-today', today.getTime()],
    ['analytics-boundary', tomorrow.getTime() - 2 * 60 * 60 * 1000],
    ['analytics-tomorrow', tomorrow.getTime()],
    ['analytics-suspended', today.getTime()],
    ['analytics-rejected', today.getTime()],
    ['analytics-other-owner', today.getTime()],
    ['analytics-outside', outside.getTime()]
  ] as const;
  for (const [id, dueAt] of dueTimes) {
    const owner = id === 'analytics-other-owner' ? other : learner;
    await client.execute({
      sql: 'UPDATE native_flashcards SET due_at = ? WHERE note_id = ? AND owner_id = ?',
      args: [dueAt, id, owner.userId]
    });
  }
  return Array.from({ length: 8 }, (_, index) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(studyDayStart(now, timezone, index));
    const date = Object.fromEntries(
      parts.map(({ type, value }) => [type, value])
    );
    return `${date.year}-${date.month}-${date.day}`;
  });
}

it.each([
  { timezone: 'America/Sao_Paulo', today: 3, tomorrow: 1 },
  { timezone: 'UTC', today: 2, tomorrow: 2 }
])(
  'counts fixed due times with saved $timezone: $today today and $tomorrow tomorrow',
  async ({ timezone, today, tomorrow }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const now = new Date();
    await setTimezone(client, learner, timezone);
    await seedReviewAnalyticsNotes();
    // Keep due instants fixed so changing the saved timezone changes grouping.
    const dates = await setReviewAnalyticsDueTimes(now, 'America/Sao_Paulo');
    const before = await client.execute(
      'SELECT id, due_at FROM native_flashcards ORDER BY id'
    );

    const analytics = (await analyticsLoad(event())) as {
      days: {
        date: string;
        flashcardsCompleted: number | null;
        grammarCompleted: number | null;
        flashcardsScheduled: number | null;
        grammarScheduled: number | null;
      }[];
    };

    // Today, tomorrow, five empty days, and the analytics-outside card on the eighth day.
    const scheduled = [today, tomorrow, 0, 0, 0, 0, 0, 1];
    expect(analytics.days).toHaveLength(8);
    expect(analytics.days).toEqual(
      dates.map((date, index) => ({
        date,
        flashcardsCompleted: index === 0 ? 0 : null,
        grammarCompleted: index === 0 ? 0 : null,
        flashcardsScheduled: scheduled[index],
        grammarScheduled: 0
      }))
    );
    expect(
      await client.execute(
        'SELECT id, due_at FROM native_flashcards ORDER BY id'
      )
    ).toEqual(before);
  }
);

it('reports a sign-out exception safely and returns a retryable failure', async () => {
  vi.spyOn(authRuntime, 'resolveAuth').mockRejectedValue(
    new Error('synthetic private credential must not be logged')
  );
  const warn = vi.spyOn(console, 'warn');

  expect(await dashboardActions.signOut(event())).toMatchObject({
    status: 503,
    data: { message: 'Sign out is temporarily unavailable. Try again.' }
  });
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      operation: 'auth',
      kind: 'unexpected',
      correlationId: '12345678-1234-4123-8123-123456789abc'
    })
  );
});

const enrollFields = {
  language: 'de',
  startingLevel: 'A2',
  explanationLanguage: 'pt'
};

describe('enrollment', () => {
  it('stores the chosen track for the caller only', async () => {
    const fresh = testSession('fresh');
    expect(await listEnrollments(client, fresh)).toEqual([]);
    await enroll(client, fresh, enrollFields);
    expect(await listEnrollments(client, fresh)).toEqual([
      { language: 'de', startingLevel: 'A2', explanationLanguage: 'pt' }
    ]);
    expect(await listEnrollments(client, learner)).toHaveLength(1);
  });

  it('refuses a second enrollment in the same language without changing the first', async () => {
    await expect(
      enroll(client, learner, {
        ...enrollFields,
        language: 'fr',
        startingLevel: 'A1'
      })
    ).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' });
    expect(await listEnrollments(client, learner)).toEqual([
      { language: 'fr', startingLevel: 'A1', explanationLanguage: 'en' }
    ]);
  });

  it.each([
    { language: 'xx' },
    { startingLevel: 'C2' },
    { explanationLanguage: 'es' },
    { language: undefined },
    // French is offered at A1 only; the database would otherwise abort.
    { language: 'fr', startingLevel: 'A2' }
  ])('rejects invalid input %j', async (bad) => {
    await expect(
      enroll(client, testSession('fresh'), { ...enrollFields, ...bad })
    ).rejects.toMatchObject({ code: 'INVALID_ENROLLMENT' });
    expect(await listEnrollments(client, testSession('fresh'))).toEqual([]);
  });

  it('changes the lesson language of an own enrollment only', async () => {
    await setExplanationLanguage(client, learner, {
      language: 'fr',
      explanationLanguage: 'pt'
    });
    expect((await listEnrollments(client, learner))[0]).toMatchObject({
      explanationLanguage: 'pt'
    });
    expect((await listEnrollments(client, other))[0]).toMatchObject({
      explanationLanguage: 'en'
    });
    await expect(
      setExplanationLanguage(client, learner, {
        language: 'de',
        explanationLanguage: 'pt'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enrolls through the page action and redirects home', async () => {
    await expect(
      enrollActions.enroll(event({ userId: 'fresh', fields: enrollFields }))
    ).rejects.toMatchObject({ status: 303, location: '/app' });
    expect(await listEnrollments(client, testSession('fresh'))).toHaveLength(1);
  });

  it('shows a conflict on the form and rejects signed-out posts', async () => {
    const duplicate = await enrollActions.enroll(
      event({
        fields: { ...enrollFields, language: 'fr', startingLevel: 'A1' }
      })
    );
    expect(duplicate).toMatchObject({
      status: 409,
      data: { message: 'You are already enrolled in this track.' }
    });
    await expect(
      enrollActions.enroll(event({ userId: null, fields: enrollFields }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('lists only the tracks still open to enroll in', async () => {
    expect(await enrollLoad(event())).toMatchObject({ enrolled: ['fr'] });
    await expect(enrollLoad(event({ userId: null }))).rejects.toMatchObject({
      status: 303,
      location: '/login'
    });
  });
});

describe('settings', () => {
  it('saves and replaces a valid timezone, and rejects an unknown one', async () => {
    expect(await getTimezone(client, learner)).toBeNull();
    await setTimezone(client, learner, 'Europe/Lisbon');
    await setTimezone(client, learner, 'America/Chicago');
    expect(await getTimezone(client, learner)).toBe('America/Chicago');
    expect(await getTimezone(client, other)).toBeNull();
    expect(practiceResultsPath('study-a')).toBe('/app/session/study-a/results');
    for (const bad of ['Mars/Base', '', '   ', 7, 'x'.repeat(65)])
      await expect(setTimezone(client, learner, bad)).rejects.toMatchObject({
        code: 'INVALID_TIMEZONE'
      });
    expect(await getTimezone(client, learner)).toBe('America/Chicago');
  });

  it('serves and saves settings through the page', async () => {
    expect(await settingsLoad(event())).toMatchObject({
      enrollments: [{ language: 'fr' }],
      timezone: null,
      studySchedule: {
        desiredRetention: 90,
        newCardPreset: '1m+10m',
        relearningPreset: '10m'
      }
    });
    expect(
      await settingsActions.timezone(
        event({ fields: { timezone: 'Europe/Lisbon' } })
      )
    ).toEqual({ saved: 'Timezone saved.' });
    expect(
      await settingsActions.timezone(
        event({ fields: { timezone: 'Nowhere/City' } })
      )
    ).toMatchObject({ status: 400 });
    expect(
      await settingsActions.explanationLanguage(
        event({ fields: { language: 'fr', explanationLanguage: 'pt' } })
      )
    ).toEqual({ saved: 'Lesson language saved.' });
    expect(
      await settingsActions.explanationLanguage(
        event({ fields: { language: 'de', explanationLanguage: 'pt' } })
      )
    ).toMatchObject({ status: 404 });
  });

  it('saves selected schedule controls without a simulated preview action', async () => {
    const fields = {
      desiredRetention: '94',
      newCardPreset: '30m',
      relearningPreset: '1h'
    };
    expect(settingsActions).not.toHaveProperty('previewStudySchedule');
    expect(await getStudySchedule(client, learner)).toEqual({
      desiredRetention: 90,
      newCardPreset: '1m+10m',
      relearningPreset: '10m'
    });
    expect(await settingsActions.saveStudySchedule(event({ fields }))).toEqual({
      saved: 'Study schedule saved.'
    });
    expect(await getStudySchedule(client, learner)).toEqual({
      desiredRetention: 94,
      newCardPreset: '30m',
      relearningPreset: '1h'
    });
    expect(
      await settingsActions.saveStudySchedule(
        event({
          fields: { ...fields, desiredRetention: '98' }
        })
      )
    ).toMatchObject({ status: 400 });
  });
});

// The shared fixture leaves learner-a an unfinished practice; starting practice
// continues an unfinished one, so these tests begin without it.
async function closeSeededPractice() {
  await client.execute(
    "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-a'"
  );
}

describe('practice sessions', () => {
  it('starts one idempotent session per submission key in an enrolled track', async () => {
    await closeSeededPractice();
    const key = randomUUID();
    const first = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: key
    });
    expect(
      await startPractice(client, learner, {
        language: 'fr',
        submissionKey: key
      })
    ).toEqual(first);
    const rows = await client.execute({
      sql: 'SELECT mode, state FROM study_sessions WHERE id = ?',
      args: [first.id]
    });
    expect(rows.rows[0]).toMatchObject({ mode: 'practice', state: 'active' });
    // Another learner cannot reuse the key, and an unenrolled language fails.
    await expect(
      startPractice(client, other, { language: 'fr', submissionKey: key })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      startPractice(client, learner, {
        language: 'de',
        submissionKey: randomUUID()
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      startPractice(client, learner, { language: 'fr', submissionKey: 'nope' })
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_KEY' });
  });

  it('uses a matching historical Decisions verdict ahead of prepared feedback', async () => {
    const before = await practiceSummary(client, learner, 'study-a');
    await client.batch(
      [
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('attempt-history', 'learner-a', 'study-a', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-history', 'assisted', 'un')",
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('prepared-history', 'learner-a', 'attempt-history', 'prepared-1', 'content-v1', 'incorrect', unixepoch() * 1000 + 120000)",
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('decisions-history', 'learner-a', 'attempt-history', 'decisions-1', 'fallback-rubric-1:content-v1', 'correct', unixepoch() * 1000)",
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('decisions-wrong-rubric', 'learner-a', 'attempt-history', 'decisions-1', 'old-rubric:content-v1', 'incorrect', unixepoch() * 1000 + 180000)"
      ],
      'write'
    );

    const summary = await practiceSummary(client, learner, 'study-a');
    expect(summary).toMatchObject({
      answered: before.answered + 1,
      correct: before.correct + 1,
      incorrect: before.incorrect
    });
  });

  it('counts the fallback verdict over the preliminary one written in the same second', async () => {
    const stamp = Date.now() + 120_000;
    await client.batch(
      [
        `INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('attempt-f', 'learner-a', 'study-a', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-attempt-f', 'assisted', 'un')`,
        // The preliminary row's id sorts after the fallback row's id, so an
        // id tie-break alone would pick the wrong one.
        {
          sql: 'INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [
            'zzz-prepared',
            'learner-a',
            'attempt-f',
            'prepared-1',
            'content-v1',
            'uncertain',
            stamp
          ]
        },
        {
          sql: 'INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [
            'aaa-fallback',
            'learner-a',
            'attempt-f',
            'jev-1',
            'jev-rubric-1:content-v1',
            'correct',
            stamp
          ]
        }
      ],
      'write'
    );
    const summary = await practiceSummary(client, learner, 'study-a');
    expect(summary).toMatchObject({ answered: 2, correct: 1, uncertain: 0 });
  });

  it('keeps a historical Decisions verdict in the practice summary', async () => {
    await client.batch(
      [
        "UPDATE evaluations SET evaluator_version = 'prepared-1', rubric_version = 'content-v1', outcome = 'uncertain' WHERE attempt_id = 'attempt-a'",
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES ('evaluation-decisions', 'learner-a', 'attempt-a', 'decisions-1', 'fallback-rubric-1:content-v1', 'correct')"
      ],
      'write'
    );
    expect(await practiceSummary(client, learner, 'study-a')).toMatchObject({
      answered: 1,
      correct: 1,
      uncertain: 0
    });
  });

  it('summarises answers by newest evaluation and finishes only own practice sessions', async () => {
    // attempt-a already has an older "incorrect" evaluation; a newer one says
    // "correct". Two assisted attempts add an uncertain and an unevaluated one.
    const attempt = (id: string) =>
      `INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('${id}', 'learner-a', 'study-a', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-${id}', 'assisted', 'un')`;
    await client.batch(
      [
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('evaluation-a2', 'learner-a', 'attempt-a', 'prepared-v2', 'rubric-v1', 'correct', unixepoch() * 1000 + 60000)",
        attempt('attempt-b'),
        "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES ('evaluation-b', 'learner-a', 'attempt-b', 'prepared-v1', 'rubric-v1', 'uncertain')",
        attempt('attempt-c')
      ],
      'write'
    );
    const summary = await practiceSummary(client, learner, 'study-a');
    expect(summary).toMatchObject({
      answered: 3,
      correct: 1,
      incorrect: 0,
      uncertain: 1,
      pending: 1,
      skills: ['fr-articles'],
      state: 'active'
    });
    await finishPractice(client, learner, 'study-a');
    expect((await practiceSummary(client, learner, 'study-a')).state).toBe(
      'completed'
    );
    await expect(
      finishPractice(client, other, 'study-a')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // study-b is an assessment: practice reads and finishes treat it as missing.
    await expect(
      practiceSummary(client, other, 'study-b')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      finishPractice(client, other, 'study-b')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only builds a results path for a safe session id', () => {
    const id = 'practice:0b9f6f64-1f0a-4d5e-9a57-3c1d3a8f2e11';
    expect(practiceResultsPath(id)).toBe(
      `/app/session/${encodeURIComponent(id)}/results`
    );
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '../../x',
      `${id}/../x`,
      'a b',
      'a?b=c',
      'a#b',
      ''
    ])
      expect(() => practiceResultsPath(bad)).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' })
      );
  });

  it('resumes a paused practice session from its page, for its owner only', async () => {
    await closeSeededPractice();
    const { id } = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: '5b0c7a52-3f0e-4c2e-8f6e-0d6a3c9b7e10'
    });
    await pauseStudySession(client, learner, id);
    expect(await sessionLoad(event({ params: { id } }))).toMatchObject({
      summary: { id, state: 'paused' }
    });
    expect(
      await sessionActions.resume(
        event({ userId: 'learner-b', params: { id }, fields: {} })
      )
    ).toMatchObject({ status: 404 });
    expect(await sessionLoad(event({ params: { id } }))).toMatchObject({
      summary: { state: 'paused' }
    });
    expect(
      await sessionActions.resume(event({ params: { id }, fields: {} }))
    ).toEqual({ resumed: true });
    expect(await sessionLoad(event({ params: { id } }))).toMatchObject({
      summary: { state: 'active' }
    });
  });

  it('runs start, session, finish and results through the pages', async () => {
    await closeSeededPractice();
    const { submissionKey } = (await practiceLoad(
      event({ params: { language: 'fr' } })
    )) as { submissionKey: string };
    const started = practiceActions.start(
      event({
        params: { language: 'fr' },
        fields: { submissionKey }
      })
    );
    await expect(started).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(`practice:${submissionKey}`)}`
    });
    const id = `practice:${submissionKey}`;
    expect(await sessionLoad(event({ params: { id } }))).toMatchObject({
      summary: { id, answered: 0, state: 'active' }
    });
    await expect(
      sessionActions.finish(event({ params: { id }, fields: {} }))
    ).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(id)}/results`
    });
    // A finished session sends the learner on to its results.
    await expect(sessionLoad(event({ params: { id } }))).rejects.toMatchObject({
      status: 303
    });
    expect(await resultsLoad(event({ params: { id } }))).toMatchObject({
      summary: { id, state: 'completed' }
    });
    await expect(
      resultsLoad(event({ userId: 'learner-b', params: { id } }))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      practiceLoad(event({ params: { language: 'de' } }))
    ).rejects.toMatchObject({ status: 404 });
  });

  it('continues the unfinished practice instead of starting another', async () => {
    await closeSeededPractice();
    const first = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    // A fresh page load brings a new key; the same practice comes back.
    expect(
      await startPractice(client, learner, {
        language: 'fr',
        submissionKey: randomUUID()
      })
    ).toEqual(first);
    await pauseStudySession(client, learner, first.id);
    expect(
      await startPractice(client, learner, {
        language: 'fr',
        submissionKey: randomUUID()
      })
    ).toEqual(first);
    // Continuing a paused practice resumes it.
    expect((await practiceSummary(client, learner, first.id)).state).toBe(
      'active'
    );
    // Another learner is never handed this session.
    await expect(unfinishedPractice(client, other, 'fr')).resolves.toBeNull();
    // Another learner starting or starting over never touches this session.
    await startPractice(client, other, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await startPracticeOver(client, other, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    expect((await practiceSummary(client, learner, first.id)).state).toBe(
      'active'
    );
    expect(await unfinishedPractice(client, learner, 'fr')).toEqual({
      id: first.id,
      answered: 0
    });
    await finishPractice(client, learner, first.id);
    expect(await unfinishedPractice(client, learner, 'fr')).toBeNull();
    const next = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    expect(next.id).not.toBe(first.id);
    const rows = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM study_sessions WHERE owner_id = ? AND id LIKE 'practice:%'",
      args: [learner.userId]
    });
    expect(Number(rows.rows[0].n)).toBe(2);
  });

  // An unfinished practice left from before starting continued one.
  const seedUnfinished = (id: string, createdAt: number) =>
    client.execute({
      sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode, created_at) SELECT ?, owner_id, id, language, 'practice', ? FROM enrollments WHERE owner_id = ? AND language = 'fr'",
      args: [id, createdAt, learner.userId]
    });
  const seedRatedAnswer = (sessionId: string, id: string, rating: string) =>
    client.execute({
      sql: `INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, grammar_rating) VALUES (?, 'learner-a', ?, 'question-1', 'content-v1', 'fr-articles', 'fr', ?, 'assisted', 'un', ?)`,
      args: [id, sessionId, `submit-${id}`, rating]
    });
  const loadKey = async () =>
    (await practiceLoad(event({ params: { language: 'fr' } }))) as {
      submissionKey: string;
      unfinished: unknown;
    };
  const startOverAs = (submissionKey: string) =>
    practiceActions.startOver(
      event({ params: { language: 'fr' }, fields: { submissionKey } })
    );

  it('loads the unfinished practice only once one was started', async () => {
    await closeSeededPractice();
    const before = await loadKey();
    expect(before.unfinished).toBeNull();
    await expect(
      practiceActions.start(
        event({
          params: { language: 'fr' },
          fields: { submissionKey: before.submissionKey }
        })
      )
    ).rejects.toMatchObject({ status: 303 });
    expect((await loadKey()).unfinished).toEqual({
      id: `practice:${before.submissionKey}`,
      answered: 0
    });
  });

  it('keeps answers on Continue but deletes every answer on Start over', async () => {
    await closeSeededPractice();
    const { id } = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await seedRatedAnswer(id, 'rated-answer', 'good');
    await seedRatedAnswer(id, 'plain-answer', 'again');
    const count = async (table: string) =>
      Number(
        (
          await client.execute({
            sql: `SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ? AND study_session_id = ?`,
            args: [learner.userId, id]
          })
        ).rows[0].n
      );
    // Continuing keeps every answer.
    await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    expect(await count('attempts')).toBe(2);
    // Start over deletes them and commits nothing to the review schedule.
    const fresh = randomUUID();
    await startPracticeOver(client, learner, {
      language: 'fr',
      submissionKey: fresh
    });
    expect(await count('attempts')).toBe(0);
    expect(await count('grammar_retention_events')).toBe(0);
    expect((await practiceSummary(client, learner, id)).state).toBe(
      'completed'
    );
    expect(await unfinishedPractice(client, learner, 'fr')).toEqual({
      id: `practice:${fresh}`,
      answered: 0
    });
  });

  it('never deletes the answers of a practice another tab already finished', async () => {
    await closeSeededPractice();
    const { id } = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await seedRatedAnswer(id, 'kept-answer', 'good');
    // Start over chose this practice, then the other tab finished it.
    await finishPractice(client, learner, id);
    await discardPractice(client, learner, id);
    const kept = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM attempts WHERE owner_id = ? AND study_session_id = ?',
      args: [learner.userId, id]
    });
    expect(Number(kept.rows[0].n)).toBe(1);
  });

  it('closes every unfinished practice on Start over and begins a new one', async () => {
    await closeSeededPractice();
    const { submissionKey: key } = await loadKey();
    await startPractice(client, learner, {
      language: 'fr',
      submissionKey: key
    });
    await seedUnfinished('older-practice', 1);
    const fresh = (await loadKey()).submissionKey;
    await expect(startOverAs(fresh)).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(`practice:${fresh}`)}`
    });
    for (const old of [`practice:${key}`, 'older-practice'])
      expect((await practiceSummary(client, learner, old)).state).toBe(
        'completed'
      );
    expect(await unfinishedPractice(client, learner, 'fr')).toEqual({
      id: `practice:${fresh}`,
      answered: 0
    });
  });

  it('keeps a repeated Start over idempotent and never finishes a newer practice on replay', async () => {
    await closeSeededPractice();
    const key = randomUUID();
    const over = () =>
      startPracticeOver(client, learner, {
        language: 'fr',
        submissionKey: key
      });
    expect(await over()).toEqual({ id: `practice:${key}` });
    // A repeated tap keeps the new practice open and finishes strays beside it.
    await seedUnfinished('stray-practice', 2);
    expect(await over()).toEqual({ id: `practice:${key}` });
    expect(await unfinishedPractice(client, learner, 'fr')).toMatchObject({
      id: `practice:${key}`
    });
    expect(
      (await practiceSummary(client, learner, 'stray-practice')).state
    ).toBe('completed');
    // Replaying it once finished leaves whatever began since untouched.
    await finishPractice(client, learner, `practice:${key}`);
    const since = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    expect(await over()).toEqual({ id: `practice:${key}` });
    expect(await unfinishedPractice(client, learner, 'fr')).toMatchObject({
      id: since.id
    });
  });
});

const noteForm = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

describe('decks, review and Anki export', () => {
  const deckId = 'deck-journey';

  beforeEach(async () => {
    await createDeck(client, learner, { id: deckId, name: 'French basics' });
  });

  it('adds basic and cloze notes as drafts and lists them for the owner only', async () => {
    await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Merci', back: 'Thank you' })
    );
    await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'cloze', text: 'Je {{c1::suis}} ici' })
    );
    const { deck, notes } = await listNotes(client, learner, deckId);
    expect(deck.name).toBe('French basics');
    expect(notes.map((note) => [note.kind, note.status])).toEqual([
      ['basic', 'draft'],
      ['cloze', 'draft']
    ]);
    await expect(listNotes(client, other, deckId)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    await expect(
      addNoteFromForm(
        client,
        other,
        deckId,
        noteForm({ kind: 'basic', front: 'a', back: 'b' })
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      addNoteFromForm(client, learner, deckId, noteForm({ kind: 'other' }))
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    await expect(
      addNoteFromForm(
        client,
        learner,
        deckId,
        noteForm({ kind: 'cloze', text: 'no hidden part' })
      )
    ).rejects.toMatchObject({ code: 'INVALID_CLOZE' });
  });

  it('queues only approved due cards and reviews them through the page', async () => {
    const draft = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Merci', back: 'Thank you' })
    );
    expect((await listDueCards(client, learner)).cards).toEqual([]);
    await approveNote(client, learner, draft.id);
    const due = (await listDueCards(client, learner)).cards;
    expect(due).toMatchObject([
      { id: draft.cardId, kind: 'basic', deck: 'French basics', revision: 0 }
    ]);
    expect((await listDueCards(client, other)).cards).toEqual([]);
    expect((await listDueCards(client, learner, 0)).cards).toEqual([]);

    const { submissionKey, cards } = (await reviewLoad(todaysCards())) as {
      submissionKey: string;
      cards: { scheduleKey: string }[];
    };
    const rate = (revision: string, rating = 'good', key = submissionKey) =>
      reviewActions.rate(
        event({
          fields: {
            cardId: draft.cardId,
            revision,
            rating,
            submissionKey: key,
            scheduleKey: cards[0].scheduleKey
          }
        })
      );
    expect(await rate('0')).toEqual({ reviewed: true });
    // The card is rescheduled out of today's queue and a stale revision conflicts.
    expect((await listDueCards(client, learner)).cards).toEqual([]);
    // Same key, different rating: an idempotency conflict, not a stale revision.
    expect(await rate('0', 'easy')).toMatchObject({ status: 409 });
    // A fresh key against the old revision reaches the stale-revision check,
    // which tells the learner to reload instead of silently overwriting.
    expect(
      await rate('0', 'easy', 'b0000000-0000-4000-8000-000000000001')
    ).toMatchObject({
      status: 409,
      data: { message: expect.stringContaining('Reload') }
    });
    await expect(
      submitReview(client, learner, {
        cardId: draft.cardId,
        submissionId: 'b0000000-0000-4000-8000-000000000002',
        expectedRevision: 0,
        rating: 'easy'
      })
    ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
    expect(await rate('1', 'nonsense')).toMatchObject({ status: 400 });
    const events = await client.execute(
      'SELECT count(*) AS total FROM native_flashcard_review_events'
    );
    expect(events.rows[0].total).toBe(1);
  });

  it('rejects a review when its displayed schedule changed in another tab', async () => {
    const draft = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Schedule', back: 'Changed' })
    );
    await approveNote(client, learner, draft.id);
    const page = (await reviewLoad(todaysCards())) as {
      cards: { scheduleKey: string }[];
      submissionKey: string;
    };
    const before = await getNote(client, learner, draft.id);
    await saveStudySchedule(client, learner, {
      desiredRetention: 95,
      newCardPreset: '30m',
      relearningPreset: '30m'
    });
    const stale = await reviewActions.rate(
      event({
        fields: {
          cardId: draft.cardId,
          revision: '0',
          rating: 'good',
          submissionKey: page.submissionKey,
          scheduleKey: page.cards[0].scheduleKey
        }
      })
    );
    expect(stale).toMatchObject({ status: 409 });
    expect(await getNote(client, learner, draft.id)).toEqual(before);
    expect(await listReviewEvents(client, learner, draft.cardId)).toEqual([]);
    const refreshed = (await reviewLoad(todaysCards())) as {
      cards: { scheduleKey: string }[];
      submissionKey: string;
    };
    expect(refreshed.cards[0].scheduleKey).not.toBe(page.cards[0].scheduleKey);
    expect(
      await reviewActions.rate(
        event({
          fields: {
            cardId: draft.cardId,
            revision: '0',
            rating: 'good',
            submissionKey: refreshed.submissionKey,
            scheduleKey: refreshed.cards[0].scheduleKey
          }
        })
      )
    ).toEqual({ reviewed: true });
  });

  it('refuses a foreign review without writing history', async () => {
    const draft = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Foreign', back: 'No' })
    );
    await approveNote(client, learner, draft.id);
    const events = () =>
      client.execute(
        'SELECT count(*) AS total FROM native_flashcard_review_events'
      );
    const before = (await events()).rows[0].total;
    expect(
      await reviewActions.rate(
        event({
          userId: 'learner-b',
          fields: {
            cardId: draft.cardId,
            revision: '0',
            rating: 'good',
            submissionKey: 'b0000000-0000-4000-8000-000000000003'
          }
        })
      )
    ).toMatchObject({ status: 404 });
    expect((await events()).rows[0].total).toBe(before);
  });

  it('counts every due card even when the list is capped', async () => {
    for (const front of ['One', 'Two', 'Three']) {
      const note = await addNoteFromForm(
        client,
        learner,
        deckId,
        noteForm({ kind: 'basic', front, back: 'x' })
      );
      await approveNote(client, learner, note.id);
    }
    expect(
      (await listDueCards(client, learner, Date.now(), 2)).cards
    ).toHaveLength(2);
    expect(await countDueCards(client, learner)).toBe(3);
    expect(await countDueCards(client, other)).toBe(0);
    expect(await reviewLoad(todaysCards())).toMatchObject({ total: 3 });
  });

  it('stores the chosen rating for every rating button', async () => {
    const ratings = ['again', 'hard', 'good', 'easy'];
    for (const rating of ratings) {
      const note = await addNoteFromForm(
        client,
        learner,
        deckId,
        noteForm({ kind: 'basic', front: `Q ${rating}`, back: 'A' })
      );
      await approveNote(client, learner, note.id);
      const scheduleKey = (await listDueCards(client, learner)).cards.find(
        (card) => card.id === note.cardId
      )?.scheduleKey;
      if (!scheduleKey) throw new Error('Missing due card schedule');
      expect(
        await reviewActions.rate(
          event({
            fields: {
              cardId: note.cardId,
              revision: '0',
              rating,
              scheduleKey,
              submissionKey: `10000000-0000-4000-8000-00000000002${ratings.indexOf(rating)}`
            }
          })
        )
      ).toEqual({ reviewed: true });
    }
    const stored = await client.execute(
      "SELECT id, rating FROM native_flashcard_review_events WHERE owner_id = 'learner-a' ORDER BY id"
    );
    expect(stored.rows.map((row) => [row.id, row.rating])).toEqual(
      ratings
        .map((rating, index) => [
          `10000000-0000-4000-8000-00000000002${index}`,
          rating
        ])
        .sort()
    );
  });

  it('approves through the deck page and exports only approved notes for Anki', async () => {
    const approved = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Say "hi"', back: 'Dis\tbonjour' })
    );
    await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'cloze', text: 'Je {{c1::suis}} ici' })
    );
    expect(
      await deckActions.approve(
        event({
          params: { id: deckId },
          fields: { noteId: approved.id }
        })
      )
    ).toEqual({ saved: true });
    // A second approval of the same note (double click) is not an error.
    expect(
      await deckActions.approve(
        event({ params: { id: deckId }, fields: { noteId: approved.id } })
      )
    ).toEqual({ saved: true });
    expect(
      await deckActions.approve(
        event({ params: { id: deckId }, fields: { noteId: 'missing' } })
      )
    ).toMatchObject({ status: 404 });
    // Another learner cannot approve this learner's draft.
    const draft = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Draft', back: 'Only' })
    );
    expect(
      await deckActions.approve(
        event({
          userId: 'learner-b',
          params: { id: deckId },
          fields: { noteId: draft.id }
        })
      )
    ).toMatchObject({ status: 404 });
    expect(
      (await listNotes(client, learner, deckId)).notes.at(-1)
    ).toMatchObject({ id: draft.id, status: 'draft' });
    expect(await deckLoad(event({ params: { id: deckId } }))).toMatchObject({
      notes: [{ status: 'approved' }, { status: 'draft' }, { status: 'draft' }]
    });

    const text = await exportDeckForAnki(client, learner, deckId);
    const source = (
      await client.execute({
        sql: 'SELECT source_id FROM native_flashcard_notes WHERE id = ?',
        args: [approved.id]
      })
    ).rows[0].source_id;
    expect(text).toBe(
      [
        '#separator:tab',
        '#html:false',
        '#guid column:1',
        '#notetype column:2',
        '#deck column:3',
        `${source}\tBasic\tFrench basics\t"Say ""hi"""\t"Dis\tbonjour"`,
        ''
      ].join('\n')
    );
    const response = await exportDeck(event({ params: { id: deckId } }));
    expect(response.headers.get('content-type')).toContain('tab-separated');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe(text);
    await expect(
      exportDeck(event({ userId: 'learner-b', params: { id: deckId } }))
    ).rejects.toMatchObject({ status: 404 });
  });

  it('gives notes with the same front different Anki identities', async () => {
    const first = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Same', back: 'One' })
    );
    const second = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Same', back: 'Two' })
    );
    await approveNote(client, learner, first.id);
    await approveNote(client, learner, second.id);
    const rows = (await exportDeckForAnki(client, learner, deckId))
      .split('\n')
      .filter((line) => line.includes('Same'));
    expect(rows).toHaveLength(2);
    const guids = rows.map((line) => line.split('\t')[0]);
    expect(new Set(guids).size).toBe(2);
    for (const guid of guids) expect(guid).toMatch(/^langlo:v1:[0-9a-f]{64}$/);
  });

  it('explains invalid notes on the deck page', async () => {
    const add = (fields: Record<string, string>) =>
      deckActions.addNote(event({ params: { id: deckId }, fields }));
    expect(await add({ kind: 'cloze', text: 'no hidden part' })).toMatchObject({
      status: 400,
      data: { message: expect.stringContaining('cloze note needs one hidden') }
    });
    expect(await add({ kind: 'basic', front: '', back: 'x' })).toMatchObject({
      status: 400,
      data: { message: expect.stringContaining('Fill in both sides') }
    });
    expect(
      await add({ kind: 'basic', front: 'Merci', back: 'Thanks' })
    ).toEqual({ saved: true });
  });

  it('refuses a deck language the learner is not enrolled in', async () => {
    expect(
      await decksActions.createDeck(
        event({ fields: { name: 'German', language: 'de' } })
      )
    ).toMatchObject({
      status: 400,
      data: { message: 'Choose one of your languages for the deck.' }
    });
    expect(
      await decksActions.createDeck(event({ fields: { name: 'German' } }))
    ).toMatchObject({ status: 400 });
    expect(await decksLoad(event())).toMatchObject({ languages: ['fr'] });
  });

  it('lists due flashcards and grammar per language on the Review tab', async () => {
    const note = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Today', back: 'x' })
    );
    await approveNote(client, learner, note.id);
    expect(await reviewTabLoad(event())).toMatchObject({
      languages: ['fr'],
      language: 'fr',
      flashcards: { overdue: 0, today: 1, todayReady: 1, nextDueAt: null },
      grammar: { overdue: [], today: [], nextDueAt: null }
    });
    await expect(
      reviewTabLoad(event({ query: '/review?language=de' }))
    ).rejects.toMatchObject({ status: 404 });
    // Nothing is due, so no grammar review can start.
    expect(
      await reviewTabActions.grammar(
        event({
          fields: {
            language: 'fr',
            due: 'today',
            submissionKey: 'b0000000-0000-4000-8000-000000000009'
          }
        })
      )
    ).toMatchObject({ status: 409 });
  });

  it('shows when the next card is due and an empty tab without enrollments', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
    const note = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Later', back: 'x' })
    );
    await approveNote(client, learner, note.id);
    await client.execute({
      sql: 'UPDATE native_flashcards SET due_at = ? WHERE note_id = ?',
      args: [Date.UTC(2026, 9, 24, 15, 30), note.id]
    });
    expect(await reviewTabLoad(event())).toMatchObject({
      flashcards: { overdue: 0, today: 1, todayReady: 0, nextDueAt: '15:30' }
    });
    expect(await reviewTabLoad(event({ userId: 'fresh' }))).toEqual({
      languages: [],
      language: null,
      submissionKey: ''
    });
    await expect(
      reviewLoad(event({ query: '/review/flashcards?language=xx&due=today' }))
    ).rejects.toMatchObject({ status: 404 });
  });

  it('shows cards without a deck or source language under Unassigned', async () => {
    const note = await addNoteFromForm(
      client,
      learner,
      deckId,
      noteForm({ kind: 'basic', front: 'Loose', back: 'x' })
    );
    await approveNote(client, learner, note.id);
    await client.execute({
      sql: 'UPDATE native_flashcard_decks SET language = NULL WHERE id = ?',
      args: [deckId]
    });
    const page = await reviewTabLoad(
      event({ query: '/review?language=unassigned' })
    );
    expect(page).toMatchObject({
      languages: ['fr', 'unassigned'],
      language: 'unassigned',
      flashcards: { today: 1, todayReady: 1 },
      grammar: null
    });
    expect(
      await reviewLoad(
        event({ query: '/review/flashcards?language=unassigned&due=today' })
      )
    ).toMatchObject({ total: 1, language: 'unassigned' });
    await expect(
      reviewLoad(event({ query: '/review/flashcards?language=fr&due=soon' }))
    ).rejects.toMatchObject({ status: 404 });
    // Back from the emptied Unassigned queue, the tab still opens on it.
    await client.execute({
      sql: 'UPDATE native_flashcards SET due_at = ? WHERE note_id = ?',
      args: [Date.now() + 7 * 86_400_000, note.id]
    });
    expect(
      await reviewTabLoad(event({ query: '/review?language=unassigned' }))
    ).toMatchObject({
      languages: ['fr', 'unassigned'],
      language: 'unassigned',
      flashcards: { overdue: 0, today: 0 }
    });
  });

  it('creates a deck through the page and rejects a blank name on the form', async () => {
    await expect(
      decksActions.createDeck(
        event({ fields: { name: 'German', language: 'fr' } })
      )
    ).rejects.toMatchObject({ status: 303 });
    const names = (
      await client.execute(
        "SELECT name FROM native_flashcard_decks WHERE owner_id = 'learner-a' ORDER BY name"
      )
    ).rows.map((row) => row.name);
    expect(names).toEqual(['French basics', 'German']);
    expect(
      await decksActions.createDeck(
        event({ fields: { name: '   ', language: 'fr' } })
      )
    ).toMatchObject({ status: 400 });
  });

  it('persists validated account-wide study schedule without rescheduling existing cards', async () => {
    const deckId = 'deck-fsrs-settings';
    await createDeck(client, learner, { id: deckId, name: 'Schedule' });
    await createNote(client, learner, {
      id: 'note-fsrs-settings',
      sourceId: `langlo:v1:${'a'.repeat(64)}`,
      deckId,
      kind: 'basic',
      content: { front: 'Front', back: 'Back' }
    });
    await approveNote(client, learner, 'note-fsrs-settings');
    await submitReview(client, learner, {
      cardId: 'card:note-fsrs-settings',
      submissionId: 'f2000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
      rating: 'good'
    });
    const before = await getNote(client, learner, 'note-fsrs-settings');
    const beforeEvents = await listReviewEvents(
      client,
      learner,
      'card:note-fsrs-settings'
    );
    expect(await getStudySchedule(client, learner)).toEqual({
      desiredRetention: 90,
      newCardPreset: '1m+10m',
      relearningPreset: '10m'
    });
    await saveStudySchedule(client, learner, {
      desiredRetention: 96,
      newCardPreset: '30m',
      relearningPreset: '1h'
    });
    expect(await getStudySchedule(client, other)).toEqual({
      desiredRetention: 90,
      newCardPreset: '1m+10m',
      relearningPreset: '10m'
    });
    expect(await getNote(client, learner, 'note-fsrs-settings')).toEqual(
      before
    );
    expect(
      await listReviewEvents(client, learner, 'card:note-fsrs-settings')
    ).toEqual(beforeEvents);
    await expect(
      saveStudySchedule(client, learner, {
        desiredRetention: 98,
        newCardPreset: '30m',
        relearningPreset: '1h'
      })
    ).rejects.toMatchObject({ code: 'INVALID_STUDY_SCHEDULE' });
    await expect(
      saveStudySchedule(client, learner, {
        desiredRetention: 90.5,
        newCardPreset: '30m',
        relearningPreset: '1h'
      })
    ).rejects.toMatchObject({ code: 'INVALID_STUDY_SCHEDULE' });
    await expect(
      saveStudySchedule(client, learner, {
        desiredRetention: 90,
        newCardPreset: 'custom',
        relearningPreset: '1h'
      })
    ).rejects.toMatchObject({ code: 'INVALID_STUDY_SCHEDULE' });
    for (const desiredRetention of [70, 97])
      await expect(
        saveStudySchedule(client, learner, {
          desiredRetention,
          newCardPreset: '10m',
          relearningPreset: '30m'
        })
      ).resolves.toMatchObject({ desiredRetention });
  });

  it('uses newly saved parameters for new cards and the next rating only', async () => {
    const deckId = 'deck-fsrs-deferred';
    await createDeck(client, learner, { id: deckId, name: 'Deferred' });
    const makeNote = async (id: string) => {
      await createNote(client, learner, {
        id,
        sourceId: `langlo:v1:${id.endsWith('1') ? '1' : '2'}${'b'.repeat(63)}`,
        deckId,
        kind: 'basic',
        content: { front: 'Front', back: 'Back' }
      });
      await approveNote(client, learner, id);
    };
    await makeNote('note-fsrs-existing1');
    const existingBefore = await getNote(
      client,
      learner,
      'note-fsrs-existing1'
    );
    await saveStudySchedule(client, learner, {
      desiredRetention: 95,
      newCardPreset: '30m',
      relearningPreset: '30m'
    });
    await makeNote('note-fsrs-new2');
    const created = await getNote(client, learner, 'note-fsrs-new2');
    expect(created.card?.parameters).toMatchObject({
      request_retention: 0.95,
      learning_steps: ['30m'],
      enable_fuzz: true
    });
    expect(
      (await getNote(client, learner, 'note-fsrs-existing1')).card
    ).toEqual(existingBefore.card);
    await submitReview(client, learner, {
      cardId: 'card:note-fsrs-existing1',
      submissionId: 'f0000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
      rating: 'good'
    });
    expect(
      (await getNote(client, learner, 'note-fsrs-existing1')).card?.parameters
    ).toMatchObject({
      request_retention: 0.95,
      learning_steps: ['30m'],
      enable_fuzz: true
    });
    expect(
      await listReviewEvents(client, learner, 'card:note-fsrs-existing1')
    ).toMatchObject([
      { parameters: { request_retention: 0.95, learning_steps: ['30m'] } }
    ]);
  });

  it('searches every status across owned decks and returns tags and deck labels', async () => {
    const firstDeck = 'deck-search-first';
    const secondDeck = 'deck-search-second';
    await createDeck(client, learner, { id: firstDeck, name: 'First' });
    await createDeck(client, learner, { id: secondDeck, name: 'Second' });
    await createDeck(client, other, { id: 'deck-search-other', name: 'Other' });
    for (const [id, deckId, status, tags] of [
      ['note-search-approved', secondDeck, 'approved', 'shared, grammar'],
      ['note-search-draft', firstDeck, 'draft', 'shared'],
      ['note-search-rejected', firstDeck, 'rejected', 'shared']
    ] as const) {
      await createNote(client, learner, {
        id,
        sourceId: `langlo:v1:${id.endsWith('approved') ? '1' : id.endsWith('draft') ? '2' : '3'}${'c'.repeat(63)}`,
        deckId,
        kind: 'basic',
        content: { front: `shared ${id}`, back: 'Definition' },
        tags: tags.split(',')
      });
      if (status === 'approved') await approveNote(client, learner, id);
      if (status === 'rejected')
        await client.execute({
          sql: "UPDATE native_flashcard_notes SET status = 'rejected' WHERE id = ?",
          args: [id]
        });
    }
    const search = await searchNotes(client, learner, 'shared');
    const results = search.results;
    expect(results.map((item) => item.id).sort()).toEqual([
      'note-search-approved',
      'note-search-draft',
      'note-search-rejected'
    ]);
    expect(
      results.find((item) => item.id === 'note-search-approved')
    ).toMatchObject({
      deck: { id: secondDeck, name: 'Second' },
      status: 'approved',
      tags: ['shared', 'grammar']
    });
    expect(await searchNotes(client, other, 'shared')).toMatchObject({
      results: []
    });
    const searchPage = await decksLoad(event({ query: '?q=shared' }));
    if (!searchPage) throw new Error('Deck search returned no page data');
    expect(searchPage.query).toBe('shared');
    expect(
      (searchPage.results as { status: string }[])
        .map((item) => item.status)
        .sort()
    ).toEqual(['approved', 'draft', 'rejected']);
    const approvedCursor = await client.execute({
      sql: 'SELECT rowid AS cursor FROM native_flashcard_notes WHERE id = ?',
      args: ['note-search-approved']
    });
    const laterSearchPage = await decksLoad(
      event({ query: `?q=shared&after=${approvedCursor.rows[0].cursor}` })
    );
    expect(
      (laterSearchPage?.results as { id: string }[])
        .map((item) => item.id)
        .sort()
    ).toEqual(['note-search-draft', 'note-search-rejected']);
    expect(
      await deckLoad(
        event({
          params: { id: secondDeck },
          query: '?note=note-search-approved#note-note-search-approved'
        })
      )
    ).toMatchObject({ focusNoteId: 'note-search-approved' });
    expect(
      await deckLoad(
        event({
          params: { id: firstDeck },
          query: '?note=note-search-approved'
        })
      )
    ).toMatchObject({ focusNoteId: null });
  });

  it('normalizes tags and moves notes without replacing card identity, schedule, or review events', async () => {
    const firstDeck = 'deck-tags-first';
    const secondDeck = 'deck-tags-second';
    await createDeck(client, learner, { id: firstDeck, name: 'First' });
    await createDeck(client, learner, { id: secondDeck, name: 'Second' });
    await createNote(client, learner, {
      id: 'note-tags-move',
      sourceId: `langlo:v1:${'d'.repeat(64)}`,
      deckId: firstDeck,
      kind: 'basic',
      content: { front: 'Front', back: 'Back' },
      tags: [' grammar ', 'verbs', 'grammar', '']
    } as Parameters<typeof createNote>[2]);
    await approveNote(client, learner, 'note-tags-move');
    await submitReview(client, learner, {
      cardId: 'card:note-tags-move',
      submissionId: 'f1000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
      rating: 'good'
    });
    const before = await getNote(client, learner, 'note-tags-move');
    const history = await listReviewEvents(
      client,
      learner,
      'card:note-tags-move'
    );
    await updateNote(client, learner, 'note-tags-move', {
      deckId: secondDeck,
      tags: ['nouns', ' verbs ', 'nouns']
    });
    expect(await getNote(client, learner, 'note-tags-move')).toMatchObject({
      deckId: secondDeck,
      tags: ['nouns', 'verbs'],
      card: before.card
    });
    expect(
      await listReviewEvents(client, learner, 'card:note-tags-move')
    ).toEqual(history);
    await expect(
      updateNote(client, learner, 'note-tags-move', { deckId: 'deck-foreign' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      updateNote(client, learner, 'note-tags-move', { deckId: '' })
    ).rejects.toMatchObject({ code: 'INVALID_NOTE' });
  });

  it('suspends and resumes only the learner’s approved cards and removes them from due counts', async () => {
    const deckId = 'deck-suspension';
    await createDeck(client, learner, { id: deckId, name: 'Suspension' });
    await createNote(client, learner, {
      id: 'note-suspension',
      sourceId: `langlo:v1:${'e'.repeat(64)}`,
      deckId,
      kind: 'basic',
      content: { front: 'Front', back: 'Back' }
    });
    await approveNote(client, learner, 'note-suspension');
    await expect(
      setCardSuspended(
        client,
        learner,
        'card:note-suspension',
        'yes' as unknown as boolean
      )
    ).rejects.toMatchObject({ code: 'INVALID_CARD_STATE' });
    expect(await countDueCards(client, learner)).toBe(1);
    await setCardSuspended(client, learner, 'card:note-suspension', true);
    expect(await countDueCards(client, learner)).toBe(0);
    expect((await listDueCards(client, learner)).cards).toEqual([]);
    await expect(
      setCardSuspended(client, other, 'card:note-suspension', false)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await setCardSuspended(client, learner, 'card:note-suspension', false);
    expect(await countDueCards(client, learner)).toBe(1);
  });

  it('validates suspension forms and rejects cards that are not approved', async () => {
    await createDeck(client, learner, { id: 'deck-pending', name: 'Pending' });
    await createNote(client, learner, {
      id: 'note-pending',
      sourceId: `langlo:v1:${'f'.repeat(64)}`,
      deckId: 'deck-pending',
      kind: 'basic',
      content: { front: 'Front', back: 'Back' }
    });
    expect(
      await deckActions.suspension(
        event({
          params: { id: 'deck-pending' },
          fields: { cardId: 'card:note-pending', suspended: 'maybe' }
        })
      )
    ).toMatchObject({ status: 400 });
    await expect(
      setCardSuspended(client, learner, 'card:note-pending', true)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await approveNote(client, learner, 'note-pending');
    expect(
      await deckActions.suspension(
        event({
          params: { id: 'deck-pending' },
          fields: { cardId: 'card:note-pending', suspended: 'true' }
        })
      )
    ).toEqual({ saved: true });
    expect((await getNote(client, learner, 'note-pending')).card).toMatchObject(
      {
        suspended: true
      }
    );
  });
});

describe('grammar practice rating and review actions', () => {
  beforeEach(async () => {
    await closeSeededPractice();
    const content = approvedPackage();
    for (const version of content.versions)
      version.lesson = {
        title: 'Synthetic lesson',
        explanation: 'Synthetic explanation',
        examples: [],
        references: []
      };
    await importContent(client, content);
  });

  async function pendingPractice() {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    const attempt = await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q2',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    return { session, attempt };
  }

  it('saves lesson ratings and returns actionable validation errors', async () => {
    const { session, attempt } = await pendingPractice();
    const params = { language: 'fr', skill: 'fr-a1-001' };
    const fields = {
      attemptId: attempt.id,
      studySessionId: session.id,
      rating: 'good'
    };
    expect(
      await lessonActions.rate(
        event({ params, fields: { ...fields, rating: 'again' } })
      )
    ).toMatchObject({ status: 400 });
    expect(
      await lessonActions.rate(event({ params, fields, userId: 'learner-b' }))
    ).toMatchObject({ status: 404 });
    expect(
      await lessonActions.rate(
        event({ params: { ...params, skill: 'fr-a1-002' }, fields })
      )
    ).toMatchObject({ status: 404 });
    // The rating result now also carries the next exercise (q2 was
    // answered, so q1), which lets the page move on without a reload.
    expect(await lessonActions.rate(event({ params, fields }))).toEqual({
      rated: true,
      rating: 'good',
      exercise: {
        studySessionId: session.id,
        submissionKey: expect.any(String),
        notice: null,
        question: {
          id: 'fr-a1-001@1:q1',
          format: 'multiple-choice',
          prompt: 'Je ___ étudiant.',
          alternatives: ['suis', 'es', 'est']
        },
        answered: 1,
        total: 2
      }
    });
    expect(
      await lessonActions.rate(
        event({ params, fields: { ...fields, rating: 'easy' } })
      )
    ).toMatchObject({ status: 409 });
  });

  it('requires login for lesson ratings', async () => {
    await expect(
      lessonActions.rate(event({ userId: null, fields: {} }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('continues the unfinished review from the Review tab and links its lessons back', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    const reviewId = `grammar-review:${fields.submissionKey}`;
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    // Clicking a review button again continues the unfinished review.
    await expect(
      reviewTabActions.grammar(
        event({
          fields: { ...fields, submissionKey: randomUUID(), due: 'today' }
        })
      )
    ).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(reviewId)}`
    });
    // Its lessons lead back to it; a practice session's lessons do not.
    const lessonIn = (sessionId: string) =>
      lessonLoad(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          query: `/learn/fr/lesson/fr-a1-001?session=${encodeURIComponent(sessionId)}`
        })
      );
    expect(await lessonIn(reviewId)).toMatchObject({
      reviewSessionId: reviewId
    });
    expect(await lessonIn(session.id)).toMatchObject({
      reviewSessionId: null
    });
  });

  it("continues only the learner's own live unfinished review", async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    const reviewId = `grammar-review:${fields.submissionKey}`;
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    expect(await unfinishedGrammarReview(client, learner, 'fr')).toEqual({
      id: reviewId
    });
    // Another learner is never handed this review.
    expect(await unfinishedGrammarReview(client, other, 'fr')).toBeNull();
    // A review whose topic was retired cannot load, so it is not continued
    // and the Review tab still loads.
    await client.execute(
      "UPDATE skills SET retired_at = 1 WHERE id = 'fr-a1-001'"
    );
    expect(await unfinishedGrammarReview(client, learner, 'fr')).toBeNull();
    await expect(reviewTabLoad(event())).resolves.toMatchObject({
      language: 'fr'
    });
    await client.execute(
      "UPDATE skills SET retired_at = NULL WHERE id = 'fr-a1-001'"
    );
    // A finished review is not continued.
    await finishPractice(client, learner, reviewId);
    expect(await unfinishedGrammarReview(client, learner, 'fr')).toBeNull();
  });

  /** A grammar review of both French topics, started from the Review tab. */
  async function reviewOfTwoTopics() {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    // The second topic gets the same schedule as the first.
    await client.execute(`INSERT INTO grammar_retention_schedules (owner_id, language,
        skill_id, content_version_id, state_json, due_at, revision, reset_required,
        scheduler_version, parameters_json)
      SELECT owner_id, language, 'fr-a1-002', 'fr-a1-002@1', state_json, due_at,
        revision, reset_required, scheduler_version, parameters_json
      FROM grammar_retention_schedules WHERE skill_id = 'fr-a1-001'`);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    const reviewId = `grammar-review:${fields.submissionKey}`;
    const planned = await client.execute({
      sql: `SELECT json_extract(value, '$.skillId') AS skill, json_extract(value, '$.questionId') AS question
        FROM study_sessions s, json_each(s.grammar_retention_plan, '$.questions') WHERE s.id = ?`,
      args: [reviewId]
    });
    const questions = Object.fromEntries(
      planned.rows.map((row) => [String(row.skill), String(row.question)])
    );
    return { reviewId, questions };
  }

  async function listedTopics(reviewId: string) {
    const sessionPage = (await sessionLoad(
      event({ params: { id: reviewId } })
    )) as { skills: { skillId: string }[] };
    const reviewTab = (await reviewTabLoad(event())) as {
      grammar: { overdue: { skillId: string }[] };
    };
    return {
      session: sessionPage.skills.map((skill) => skill.skillId),
      reviewTab: reviewTab.grammar.overdue.map((skill) => skill.skillId)
    };
  }

  it('drops reviewed topics and finishes the review after the last one', async () => {
    const { reviewId, questions } = await reviewOfTwoTopics();
    const correct: Record<string, string> = {
      'fr-a1-001@1:q1': 'suis',
      'fr-a1-001@1:q2': 'es'
    };
    const attempt = await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: questions['fr-a1-001'],
      submissionKey: randomUUID(),
      answer: correct[questions['fr-a1-001']] ?? '',
      evidenceKind: 'independent'
    });
    // A correct answer still waiting for its rating keeps the topic listed.
    const both = ['fr-a1-001', 'fr-a1-002'];
    expect(await listedTopics(reviewId)).toEqual({
      session: both,
      reviewTab: both
    });
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: {
            attemptId: attempt.id,
            studySessionId: reviewId,
            rating: 'good'
          }
        })
      )
    ).toMatchObject({ rated: true });
    expect(await listedTopics(reviewId)).toEqual({
      session: ['fr-a1-002'],
      reviewTab: ['fr-a1-002']
    });
    // The last topic's answer takes no rating, so the review finishes.
    expect(
      await lessonActions.answer(
        event({
          params: { language: 'fr', skill: 'fr-a1-002' },
          fields: {
            studySessionId: reviewId,
            questionId: questions['fr-a1-002'],
            submissionKey: randomUUID(),
            answer: 'Wrong.'
          }
        })
      )
    ).toMatchObject({ recorded: true });
    expect(await practiceSummary(client, learner, reviewId)).toMatchObject({
      state: 'completed',
      answered: 2
    });
    await expect(
      sessionLoad(event({ params: { id: reviewId } }))
    ).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(reviewId)}/results`
    });
    // The lesson still shows the last answer and leads to the review.
    expect(
      await lessonLoad(
        event({
          params: { language: 'fr', skill: 'fr-a1-002' },
          query: `/learn/fr/lesson/fr-a1-002?session=${encodeURIComponent(reviewId)}`
        })
      )
    ).toMatchObject({
      reviewSessionId: reviewId,
      feedback: { answer: 'Wrong.' }
    });
  });

  it('waits for an answer still being graded in another tab', async () => {
    const { reviewId, questions } = await reviewOfTwoTopics();
    // The second topic's typed answer waits on the AI grader.
    let grade: (result: FallbackResult) => void = () => undefined;
    const graded = new Promise<FallbackResult>((resolve) => (grade = resolve));
    const form = new FormData();
    for (const [key, value] of Object.entries({
      studySessionId: reviewId,
      questionId: questions['fr-a1-002'],
      submissionKey: randomUUID(),
      answer: 'Wrong.'
    }))
      form.set(key, value);
    const pending = recordAnswer(
      client,
      learner,
      form,
      'fr-a1-002',
      () => graded
    );
    await vi.waitFor(async () => {
      const rows = await client.execute({
        sql: 'SELECT 1 FROM attempts WHERE study_session_id = ? AND skill_id = ?',
        args: [reviewId, 'fr-a1-002']
      });
      expect(rows.rows).toHaveLength(1);
    });
    // Meanwhile the first topic is answered and rated in another tab.
    const correct: Record<string, string> = {
      'fr-a1-001@1:q1': 'suis',
      'fr-a1-001@1:q2': 'es'
    };
    const attempt = await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: questions['fr-a1-001'],
      submissionKey: randomUUID(),
      answer: correct[questions['fr-a1-001']] ?? '',
      evidenceKind: 'independent'
    });
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: {
            attemptId: attempt.id,
            studySessionId: reviewId,
            rating: 'good'
          }
        })
      )
    ).toMatchObject({ rated: true });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'active'
    );
    // Once the grader answers, the review finishes.
    grade({ outcome: 'incorrect', reason: 'answered', evaluated: true });
    await expect(pending).resolves.toMatchObject({ recorded: true });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
  });

  it('does not wait for an older answer that never got a no-verdict marker', async () => {
    const { reviewId, questions } = await reviewOfTwoTopics();
    // Before reviews wrote the marker, an ungraded typed answer left only its
    // prepared evaluation behind, however long ago its request finished.
    const old = await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: questions['fr-a1-002'],
      submissionKey: randomUUID(),
      answer: 'Wrong.',
      evidenceKind: 'independent'
    });
    await client.execute({
      sql: "DELETE FROM evaluations WHERE attempt_id = ? AND evaluator_version = 'jev-1-no-verdict'",
      args: [old.id]
    });
    await client.execute({
      sql: 'UPDATE attempts SET created_at = created_at - 3600000 WHERE id = ?',
      args: [old.id]
    });
    const correct: Record<string, string> = {
      'fr-a1-001@1:q1': 'suis',
      'fr-a1-001@1:q2': 'es'
    };
    const first = await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: questions['fr-a1-001'],
      submissionKey: randomUUID(),
      answer: correct[questions['fr-a1-001']] ?? '',
      evidenceKind: 'independent'
    });
    await lessonActions.rate(
      event({
        params: { language: 'fr', skill: 'fr-a1-001' },
        fields: {
          attemptId: first.id,
          studySessionId: reviewId,
          rating: 'good'
        }
      })
    );
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
  });

  it('never finishes a practice session on its own', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    // Only a grammar review has a fixed list of topics to finish.
    await finishReviewedGrammarReview(client, learner, {
      id: session.id,
      mode: 'practice'
    });
    expect((await practiceSummary(client, learner, session.id)).state).toBe(
      'active'
    );
  });

  it('finishes the review when its last answer is sent again', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    const reviewId = `grammar-review:${fields.submissionKey}`;
    const planned = await client.execute({
      sql: `SELECT json_extract(grammar_retention_plan, '$.questions[0].questionId') AS id
        FROM study_sessions WHERE id = ?`,
      args: [reviewId]
    });
    const answer = {
      studySessionId: reviewId,
      questionId: String(planned.rows[0]?.id),
      submissionKey: randomUUID(),
      answer: 'est'
    };
    // The first try saved the answer but stopped before finishing the review.
    await recordAttempt(client, learner, {
      ...answer,
      evidenceKind: 'independent'
    });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'active'
    );
    expect(
      await lessonActions.answer(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: answer
        })
      )
    ).toMatchObject({ recorded: true, duplicate: true });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
  });

  it('finishes an already answered review when its page opens', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    const reviewId = `grammar-review:${fields.submissionKey}`;
    const planned = await client.execute({
      sql: `SELECT json_extract(grammar_retention_plan, '$.questions[0].questionId') AS id
        FROM study_sessions WHERE id = ?`,
      args: [reviewId]
    });
    // Answered before reviews finished by themselves, so it is still open.
    await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: String(planned.rows[0]?.id),
      submissionKey: randomUUID(),
      answer: 'est',
      evidenceKind: 'independent'
    });
    await expect(
      sessionLoad(event({ params: { id: reviewId } }))
    ).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(reviewId)}/results`
    });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
  });

  it('keeps the review open while an answer still waits for its rating', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    const reviewId = `grammar-review:${fields.submissionKey}`;
    const planned = await client.execute({
      sql: `SELECT json_extract(grammar_retention_plan, '$.questions[0].questionId') AS id
        FROM study_sessions WHERE id = ?`,
      args: [reviewId]
    });
    const questionId = String(planned.rows[0]?.id);
    const correct: Record<string, string> = {
      'fr-a1-001@1:q1': 'suis',
      'fr-a1-001@1:q2': 'es'
    };
    const attempt = await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId,
      submissionKey: randomUUID(),
      answer: correct[questionId] ?? '',
      evidenceKind: 'independent'
    });
    // An assisted Not sure on the same question takes no rating, but the
    // correct answer before it still does.
    await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId,
      submissionKey: randomUUID(),
      answer: '',
      notSure: true,
      evidenceKind: 'assisted'
    });
    await finishReviewedGrammarReview(client, learner, {
      id: reviewId,
      mode: 'mixed-review'
    });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'active'
    );
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: {
            attemptId: attempt.id,
            studySessionId: reviewId,
            rating: 'good'
          }
        })
      )
    ).toMatchObject({ rated: true });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
  });

  it('finishes the review over a correct assisted retry, which takes no rating', async () => {
    const { reviewId, questions } = await reviewOfTwoTopics();
    const correct: Record<string, string> = {
      'fr-a1-001@1:q1': 'suis',
      'fr-a1-001@1:q2': 'es'
    };
    await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: questions['fr-a1-001'],
      submissionKey: randomUUID(),
      answer: 'Wrong.',
      evidenceKind: 'independent'
    });
    await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId: questions['fr-a1-001'],
      submissionKey: randomUUID(),
      answer: correct[questions['fr-a1-001']] ?? '',
      evidenceKind: 'assisted'
    });
    expect(await listedTopics(reviewId)).toEqual({
      session: ['fr-a1-002'],
      reviewTab: ['fr-a1-002']
    });
    expect(
      await lessonActions.answer(
        event({
          params: { language: 'fr', skill: 'fr-a1-002' },
          fields: {
            studySessionId: reviewId,
            questionId: questions['fr-a1-002'],
            submissionKey: randomUUID(),
            answer: 'Wrong.'
          }
        })
      )
    ).toMatchObject({ recorded: true });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
  });

  it('finishes the review when the last topic is rated', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({ status: 303 });
    const reviewId = `grammar-review:${fields.submissionKey}`;
    const planned = await client.execute({
      sql: `SELECT json_extract(grammar_retention_plan, '$.questions[0].questionId') AS id
        FROM study_sessions WHERE id = ?`,
      args: [reviewId]
    });
    const questionId = String(planned.rows[0]?.id);
    const correct: Record<string, string> = {
      'fr-a1-001@1:q1': 'suis',
      'fr-a1-001@1:q2': 'es'
    };
    const attempt = await recordAttempt(client, learner, {
      studySessionId: reviewId,
      questionId,
      submissionKey: randomUUID(),
      answer: correct[questionId] ?? '',
      evidenceKind: 'independent'
    });
    // A correct answer waits for its rating, so the review stays open.
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'active'
    );
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: {
            attemptId: attempt.id,
            studySessionId: reviewId,
            rating: 'good'
          }
        })
      )
    ).toMatchObject({ rated: true, rating: 'good' });
    expect((await practiceSummary(client, learner, reviewId)).state).toBe(
      'completed'
    );
    // Finishing commits the rated review, so the topic gets a new due date.
    const schedule = await client.execute(
      "SELECT due_at FROM grammar_retention_schedules WHERE skill_id = 'fr-a1-001'"
    );
    expect(Number(schedule.rows[0]?.due_at)).toBeGreaterThan(0);
  });

  it('starts overdue grammar from the Review tab and shows when the next topic is due', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute({
      sql: 'UPDATE grammar_retention_schedules SET due_at = ?',
      args: [Date.UTC(2026, 9, 24, 18, 5)]
    });
    expect(await reviewTabLoad(event())).toMatchObject({
      grammar: {
        overdue: [],
        today: [{ skillId: 'fr-a1-001', ready: false }],
        nextDueAt: '18:05'
      }
    });
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const fields = { language: 'fr', submissionKey: randomUUID() };
    expect(
      await reviewTabActions.grammar(
        event({ fields: { ...fields, due: 'soon' } })
      )
    ).toMatchObject({ status: 404 });
    expect(
      await reviewTabActions.grammar(
        event({ fields: { ...fields, language: 'de', due: 'overdue' } })
      )
    ).toMatchObject({ status: 404 });
    const reviewId = `grammar-review:${fields.submissionKey}`;
    await expect(
      reviewTabActions.grammar(event({ fields: { ...fields, due: 'overdue' } }))
    ).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(reviewId)}`
    });
    expect(
      await sessionLoad(event({ params: { id: reviewId } }))
    ).toMatchObject({
      skills: [{ skillId: 'fr-a1-001', available: true, answered: false }]
    });
  });

  it('starts a due review from the practice action and lists its frozen skill', async () => {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await recordAttempt(client, learner, {
      studySessionId: session.id,
      questionId: 'fr-a1-001@1:q1',
      submissionKey: randomUUID(),
      answer: 'es',
      evidenceKind: 'independent'
    });
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    const params = { language: 'fr' };
    expect(
      await practiceActions.review(
        event({ params, fields: { submissionKey: randomUUID() } })
      )
    ).toMatchObject({ status: 400 });
    const key = randomUUID();
    const reviewId = `grammar-review:${key}`;
    await expect(
      practiceActions.review(
        event({ params, fields: { submissionKey: key, skillId: 'fr-a1-001' } })
      )
    ).rejects.toMatchObject({
      status: 303,
      location: `/app/session/${encodeURIComponent(reviewId)}`
    });
    expect(
      await sessionLoad(event({ params: { id: reviewId } }))
    ).toMatchObject({
      summary: { mode: 'mixed-review' },
      skills: [{ skillId: 'fr-a1-001', available: true, answered: false }]
    });
    expect(await practiceLoad(event({ params }))).toMatchObject({
      dueReviews: [{ skillId: 'fr-a1-001' }]
    });
    await expect(
      sessionActions.finish(event({ params: { id: reviewId }, fields: {} }))
    ).rejects.toMatchObject({
      status: 303,
      location: practiceResultsPath(reviewId)
    });
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  enroll,
  listEnrollments,
  setExplanationLanguage
} from '../src/lib/server/enrollment';
import { getTimezone, setTimezone } from '../src/lib/server/preferences';
import { pauseStudySession } from '../src/lib/server/study';
import {
  finishPractice,
  practiceResultsPath,
  practiceSummary,
  startPractice
} from '../src/lib/server/practice';
import {
  addNoteFromForm,
  countDueCards,
  exportDeckForAnki,
  listDueCards,
  listNotes
} from '../src/lib/server/flashcard-views';
import {
  approveNote,
  createDeck,
  submitReview
} from '../src/lib/server/flashcards';
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
import { actions as decksActions } from '../src/routes/app/decks/+page.server';
import {
  actions as deckActions,
  load as deckLoad
} from '../src/routes/app/decks/[id]/+page.server';
import { GET as exportDeck } from '../src/routes/app/decks/[id]/export/+server';
import {
  actions as reviewActions,
  load as reviewLoad
} from '../src/routes/app/review/+page.server';

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
  close?.();
  await disposeFlashcardFixtures();
});

function event(
  options: {
    userId?: string | null;
    params?: Record<string, string>;
    fields?: Record<string, string>;
    config?: RuntimeConfig | undefined;
  } = {}
) {
  const userId = options.userId === undefined ? 'learner-a' : options.userId;
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields ?? {}))
    form.set(key, value);
  return {
    params: options.params ?? {},
    locals: {
      user: userId ? { id: userId } : null,
      session: userId ? { userId } : null,
      config: Object.hasOwn(options, 'config')
        ? options.config
        : ({ dataEnabled: true, databaseUrl } as RuntimeConfig)
    },
    request: new Request(
      'http://127.0.0.1/app',
      options.fields ? { method: 'POST', body: form } : undefined
    )
  } as never;
}

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
      timezone: null
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
});

describe('practice sessions', () => {
  it('starts one idempotent session per submission key in an enrolled track', async () => {
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

  it('counts the fallback verdict over the preliminary one written in the same second', async () => {
    const stamp = 'unixepoch() * 1000 + 120000';
    await client.batch(
      [
        `INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('attempt-f', 'learner-a', 'study-a', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-attempt-f', 'assisted', 'un')`,
        // The preliminary row's id sorts after the fallback row's id, so an
        // id tie-break alone would pick the wrong one.
        `INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('zzz-prepared', 'learner-a', 'attempt-f', 'prepared-1', 'content-v1', 'uncertain', ${stamp})`,
        `INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome, created_at) VALUES ('aaa-fallback', 'learner-a', 'attempt-f', 'decisions-1', 'fallback-rubric-1:content-v1', 'correct', ${stamp})`
      ],
      'write'
    );
    const summary = await practiceSummary(client, learner, 'study-a');
    expect(summary).toMatchObject({ answered: 2, correct: 1, uncertain: 0 });
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
    expect(await listDueCards(client, learner)).toEqual([]);
    await approveNote(client, learner, draft.id);
    const due = await listDueCards(client, learner);
    expect(due).toMatchObject([
      { id: draft.cardId, kind: 'basic', deck: 'French basics', revision: 0 }
    ]);
    expect(await listDueCards(client, other)).toEqual([]);
    expect(await listDueCards(client, learner, 0)).toEqual([]);

    const { submissionKey } = (await reviewLoad(event())) as {
      submissionKey: string;
    };
    const rate = (
      revision: string,
      rating = 'good',
      key = `${submissionKey}:${draft.cardId}:${revision}`
    ) =>
      reviewActions.rate(
        event({
          fields: {
            cardId: draft.cardId,
            revision,
            rating,
            submissionKey: key
          }
        })
      );
    expect(await rate('0')).toEqual({ reviewed: true });
    // The card is rescheduled out of today's queue and a stale revision conflicts.
    expect(await listDueCards(client, learner)).toEqual([]);
    // Same key, different rating: an idempotency conflict, not a stale revision.
    expect(await rate('0', 'easy')).toMatchObject({ status: 409 });
    // A fresh key against the old revision reaches the stale-revision check,
    // which tells the learner to reload instead of silently overwriting.
    expect(await rate('0', 'easy', 'fresh-key')).toMatchObject({
      status: 409,
      data: { message: expect.stringContaining('Reload') }
    });
    await expect(
      submitReview(client, learner, {
        cardId: draft.cardId,
        submissionId: 'fresh-key-2',
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
            submissionKey: 'foreign-key'
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
    expect(await listDueCards(client, learner, Date.now(), 2)).toHaveLength(2);
    expect(await countDueCards(client, learner)).toBe(3);
    expect(await countDueCards(client, other)).toBe(0);
    expect(await reviewLoad(event())).toMatchObject({ total: 3 });
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
      expect(
        await reviewActions.rate(
          event({
            fields: {
              cardId: note.cardId,
              revision: '0',
              rating,
              submissionKey: `key-${rating}`
            }
          })
        )
      ).toEqual({ reviewed: true });
    }
    const stored = await client.execute(
      "SELECT id, rating FROM native_flashcard_review_events WHERE owner_id = 'learner-a' ORDER BY id"
    );
    expect(stored.rows.map((row) => [row.id, row.rating])).toEqual(
      ratings.map((rating) => [`key-${rating}`, rating]).sort()
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

  it('creates a deck through the page and rejects a blank name on the form', async () => {
    await expect(
      decksActions.createDeck(event({ fields: { name: 'German' } }))
    ).rejects.toMatchObject({ status: 303 });
    const names = (
      await client.execute(
        "SELECT name FROM native_flashcard_decks WHERE owner_id = 'learner-a' ORDER BY name"
      )
    ).rows.map((row) => row.name);
    expect(names).toEqual(['French basics', 'German']);
    expect(
      await decksActions.createDeck(event({ fields: { name: '   ' } }))
    ).toMatchObject({ status: 400 });
  });
});

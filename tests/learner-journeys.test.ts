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
import {
  finishPractice,
  practiceSummary,
  startPractice
} from '../src/lib/server/practice';
import {
  addNoteFromForm,
  exportDeckForAnki,
  listDueCards,
  listNotes
} from '../src/lib/server/flashcard-views';
import { approveNote, createDeck } from '../src/lib/server/flashcards';
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

  it('summarises answers by newest evaluation and finishes only own practice sessions', async () => {
    const summary = await practiceSummary(client, learner, 'study-a');
    expect(summary).toMatchObject({
      answered: 1,
      correct: 0,
      incorrect: 1,
      uncertain: 0,
      pending: 0,
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
    const rate = (revision: string, rating = 'good') =>
      reviewActions.rate(
        event({
          fields: {
            cardId: draft.cardId,
            revision,
            rating,
            submissionKey: `${submissionKey}:${draft.cardId}:${revision}`
          }
        })
      );
    expect(await rate('0')).toEqual({ reviewed: true });
    // The card is rescheduled out of today's queue and a stale revision conflicts.
    expect(await listDueCards(client, learner)).toEqual([]);
    expect(await rate('0', 'easy')).toMatchObject({ status: 409 });
    expect(await rate('1', 'nonsense')).toMatchObject({ status: 400 });
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
    expect(
      await deckActions.approve(
        event({ params: { id: deckId }, fields: { noteId: 'missing' } })
      )
    ).toMatchObject({ status: 404 });
    expect(await deckLoad(event({ params: { id: deckId } }))).toMatchObject({
      notes: [{ status: 'approved' }, { status: 'draft' }]
    });

    const text = await exportDeckForAnki(client, learner, deckId);
    expect(text).toBe(
      [
        '#separator:tab',
        '#html:false',
        '#notetype column:1',
        '#deck column:2',
        'Basic\tFrench basics\t"Say ""hi"""\t"Dis\tbonjour"',
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { load as homeLoad } from '../src/routes/app/+page.server';
import { load as analyticsLoad } from '../src/routes/app/analytics/+page.server';
import { recordAnswer } from '../src/lib/server/lesson-practice';
import { recordStudyTime } from '../src/lib/server/study-time';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';
import { counting, type Counted } from './fixtures/counting-client';

// The home and analytics pages read the learner's progress on every view, and
// each database call costs a network round trip in production.

// Begin, enrollments, one batch for every track's reads, commit, then one
// unfinished-practice check per track, sent together.
const HOME_BUDGET = 6;
// The progress reads, the timezone, three review counts and the study time.
const ANALYTICS_BUDGET = 9;

const held = vi.hoisted(() => ({ client: undefined as Client | undefined }));

vi.mock('../src/lib/server/db/app', () => ({
  openAppDatabase: async () => ({
    client: held.client,
    close: () => undefined
  })
}));

let target: FixtureTarget;
let close: (() => void) | undefined;
let raw: Client;

beforeEach(async () => {
  target = await fixture();
  ({ client: raw, close } = await openFixtureDatabase(target));
  await importContent(raw, approvedPackage());
  // A second track, so the reads per track can be seen not to add round trips.
  await raw.execute(
    "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('en-a', 'learner-a', 'en', 'A1', 'en')"
  );
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

function pageEvent(path: string) {
  return {
    url: new URL(`http://127.0.0.1${path}`),
    params: {},
    locals: {
      config: {
        dataEnabled: true,
        databaseUrl: target.databaseUrl
      } as RuntimeConfig,
      user: { id: 'learner-a', email: 'a@x', name: 'a' },
      session: {
        id: 's-a',
        userId: 'learner-a',
        expiresAt: new Date(Date.now() + 1e6)
      }
    }
  } as never;
}

async function counted<T>(run: () => T | Promise<T>) {
  const calls: Counted = { sqls: [], peak: 0, together: [] };
  held.client = counting(raw, calls);
  return { data: (await run()) as Record<string, unknown>, calls };
}

const learner = testSession('learner-a');

const sent = (calls: Counted, text: string) =>
  calls.sqls.filter((sql) => sql.includes(text)).length;

describe('home and analytics round trips', () => {
  it('loads the home page in few round trips', async () => {
    const answer = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: 'study-a',
      submissionKey: 'k1',
      questionId: 'fr-a1-001@1:q1',
      answer: 'suis'
    }))
      answer.set(name, value);
    await recordAnswer(raw, learner, answer, 'fr-a1-001');
    await raw.execute(
      "INSERT INTO native_flashcard_preferences (owner_id, desired_retention, new_card_preset, relearning_preset) VALUES ('learner-a', 85, '1m+10m', '10m')"
    );

    const { data, calls } = await counted(() => homeLoad(pageEvent('/app')));

    // The answer history, the catalog and the study schedule all come from
    // the batched reads.
    const tracks = data.tracks as {
      language: string;
      skills: Record<string, unknown>[];
    }[];
    expect(tracks.map((track) => track.language)).toEqual(['en', 'fr']);
    expect(tracks[0].skills).toEqual([]);
    expect(
      tracks[1].skills.find((skill) => skill.skillId === 'fr-a1-001')
    ).toMatchObject({
      answers: 1,
      practisedSessions: 1,
      prerequisites: [],
      retention: { state: 'not-assessed', target: 0.85 }
    });
    expect(
      tracks[1].skills.find((skill) => skill.skillId === 'fr-a1-002')
    ).toMatchObject({ prerequisites: ['fr-a1-001'] });
    const stored = await raw.execute(
      "SELECT COUNT(*) AS answered FROM attempts WHERE study_session_id = 'study-a'"
    );
    expect(data.unfinished).toEqual({
      fr: { id: 'study-a', answered: Number(stored.rows[0].answered) }
    });
    expect(calls.sqls.length).toBeLessThanOrEqual(HOME_BUDGET);
    // Both tracks' mastery and retention reads share one round trip.
    expect(sent(calls, 'batch')).toBe(1);
    const unfinished = (sqls: string[]) =>
      sqls.filter((sql) => sql.includes("s.mode = 'practice'")).length;
    expect(Math.max(...calls.together.map(unfinished))).toBe(2);
  });

  it('loads the analytics page in few round trips', async () => {
    const now = Date.now();
    await recordStudyTime(
      raw,
      learner,
      {
        id: 'segment-a',
        category: 'flashcards',
        startedAt: now - 30_000,
        endedAt: now - 20_000
      },
      now
    );

    const { data, calls } = await counted(() =>
      analyticsLoad(pageEvent('/app/analytics'))
    );

    const days = data.days as { date: string }[];
    expect(days).toEqual([
      {
        date: days[0].date,
        flashcardsCompleted: 0,
        grammarCompleted: 0,
        flashcardsScheduled: 0,
        grammarScheduled: 0
      }
    ]);
    expect(data.studyTime).toEqual([
      { date: days[0].date, flashcardsSeconds: 10, grammarSeconds: 0 }
    ]);
    expect(calls.sqls.length).toBeLessThanOrEqual(ANALYTICS_BUDGET);
    expect(sent(calls, 'FROM learner_preferences')).toBe(1);
    // The review counts do not wait for the progress reads.
    expect(
      calls.together.some(
        (active) =>
          active.includes('batch') &&
          active.some((sql) => sql.includes('native_flashcard_review_events'))
      )
    ).toBe(true);
  });
});

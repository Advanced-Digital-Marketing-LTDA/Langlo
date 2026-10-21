import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';

type Recorded = {
  name: string;
  attributes?: Record<string, unknown>;
  set: Record<string, unknown>;
};
const recorded = vi.hoisted<Recorded[]>(() => []);

vi.mock('@sentry/sveltekit', () => ({
  startSpan: (
    options: { name: string; attributes?: Record<string, unknown> },
    run: (active: { setAttribute: (k: string, v: unknown) => void }) => unknown
  ) => {
    const entry: Recorded = {
      name: options.name,
      attributes: options.attributes,
      set: {}
    };
    // Connection spans (db.*) are covered in db-transactions-spans.test.ts.
    if (!options.name.startsWith('db.')) recorded.push(entry);
    return run({
      setAttribute: (key, value) => {
        entry.set[key] = value;
      }
    });
  }
}));

vi.mock('../src/lib/server/db/app', () => ({
  openAppDatabase: vi.fn(async () => ({ client: {}, close: vi.fn() }))
}));

import { learnerApi, studyPage } from '../src/lib/server/learner-api';
import { FlashcardError } from '../src/lib/server/flashcards';
import { isHttpError } from '@sveltejs/kit';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { loadEvidenceRows } from '../src/lib/server/mastery';
import { loadProgress } from '../src/lib/server/progress';
import { span } from '../src/lib/server/tracing';
import { importContent } from '../src/lib/server/content-import';
import { recordAttempt } from '../src/lib/server/study';
import { approvedPackage } from './fixtures/content-package';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';

let client: Client;
let close: () => void;
const learner = testSession('learner-a');
beforeEach(async () => {
  recorded.length = 0;
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

it('span returns the step result and passes attributes through', async () => {
  await expect(span('x', async () => 7, { count: 2 })).resolves.toBe(7);
  expect(recorded).toEqual([{ name: 'x', attributes: { count: 2 }, set: {} }]);
});

it('span propagates the step error unchanged', async () => {
  const failure = new Error('boom');
  await expect(
    span('x', async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
});

it('computeMastery traces read phases while answer creation traces ledger sync', async () => {
  await recordAttempt(client, learner, {
    studySessionId: 'study-a',
    questionId: 'fr-a1-001@1:q1',
    submissionKey: 'traced',
    evidenceKind: 'independent',
    answer: 'suis'
  });
  expect(
    recorded.filter((entry) => entry.name === 'mastery.sync-evidence')
  ).toHaveLength(1);
  recorded.length = 0;
  const other = testSession('learner-b');
  await recordAttempt(client, other, {
    studySessionId: 'study-b',
    questionId: 'fr-a1-001@1:q1',
    submissionKey: 'traced-other',
    evidenceKind: 'independent',
    answer: 'suis'
  });
  recorded.length = 0;
  const skills = (await loadProgress(client, learner, 'fr')).tracks[0].skills;
  expect(skills.find((skill) => skill.skillId === 'fr-a1-001')).toMatchObject({
    correct: 1
  });
  expect(recorded.map((entry) => entry.name)).toEqual([
    'mastery.catalog',
    'mastery.prerequisites',
    'mastery.load-evidence',
    'mastery.current-content'
  ]);
  const stored = await loadEvidenceRows(client, {
    ownerId: learner.userId,
    language: 'fr'
  });
  const everyone = await loadEvidenceRows(client, { language: 'fr' });
  expect(stored.length).toBeGreaterThan(0);
  expect(everyone.length).toBeGreaterThan(stored.length);
  expect(
    recorded.find((entry) => entry.name === 'mastery.load-evidence')?.set
  ).toEqual({ rows: stored.length });
  recorded.length = 0;
  await recordAttempt(client, learner, {
    studySessionId: 'study-a',
    questionId: 'fr-a1-001@1:q2',
    submissionKey: 'traced-second-item',
    evidenceKind: 'independent',
    answer: 'es'
  });
  expect(
    recorded.find((entry) => entry.name === 'mastery.sync-evidence')?.attributes
  ).toEqual({ rows: 1 });
});

it('loadProgress rejects a missing enrollment before computing mastery', async () => {
  await expect(loadProgress(client, learner, 'de')).rejects.toMatchObject({
    code: 'NOT_FOUND'
  });
  expect(recorded).toEqual([]);
});

it('studyPage times opening the database and running the load, and still closes', async () => {
  const { openAppDatabase } = await import('../src/lib/server/db/app');
  const close = vi.fn();
  vi.mocked(openAppDatabase).mockResolvedValueOnce({
    client: {},
    close
  } as never);
  const event = {
    locals: {
      user: { id: 'learner-a' },
      config: { dataEnabled: true, databaseUrl: 'file:test.db' }
    }
  } as never;
  await expect(studyPage(event, async () => 'ok')).resolves.toBe('ok');
  expect(recorded.map((entry) => entry.name)).toEqual([
    'study.open-database',
    'study.run'
  ]);
  expect(close).toHaveBeenCalledOnce();
});

const learnerEvent = {
  request: new Request('http://localhost/api'),
  locals: {
    user: { id: 'learner-a' },
    config: { dataEnabled: true, databaseUrl: 'file:test.db' }
  }
} as never;

async function openWithClose() {
  const { openAppDatabase } = await import('../src/lib/server/db/app');
  const close = vi.fn();
  vi.mocked(openAppDatabase).mockResolvedValueOnce({
    client: {},
    close
  } as never);
  return close;
}

it('studyPage closes the database and rethrows when the wrapped load fails', async () => {
  const close = await openWithClose();
  const failure = new Error('synthetic load failure');
  await expect(
    studyPage(learnerEvent, async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  expect(recorded.map((entry) => entry.name)).toEqual([
    'study.open-database',
    'study.run'
  ]);
  expect(close).toHaveBeenCalledOnce();
});

it('learnerApi times opening the database and running the work, and answers 200', async () => {
  const close = await openWithClose();
  const response = await learnerApi(learnerEvent, async () => ({ ok: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(recorded.map((entry) => entry.name)).toEqual([
    'study.open-database',
    'study.run'
  ]);
  expect(close).toHaveBeenCalledOnce();
});

it('learnerApi keeps mapping repository errors to a learner-safe status while traced', async () => {
  const close = await openWithClose();
  const thrown = await learnerApi(learnerEvent, async () => {
    throw new FlashcardError('STALE_REVIEW');
  }).catch((error: unknown) => error);
  expect(isHttpError(thrown, 409)).toBe(true);
  expect(thrown).toMatchObject({
    body: {
      message:
        'This card changed in another tab. Reload to see the current version before rating it again.'
    }
  });
  expect(recorded.map((entry) => entry.name)).toEqual([
    'study.open-database',
    'study.run'
  ]);
  expect(close).toHaveBeenCalledOnce();
});

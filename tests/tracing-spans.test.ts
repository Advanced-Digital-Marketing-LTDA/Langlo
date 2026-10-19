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
    recorded.push(entry);
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

import { studyPage } from '../src/lib/server/learner-api';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { getMastery, loadEvidenceRows } from '../src/lib/server/mastery';
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

it('getMastery reports each phase and how many evidence rows it writes', async () => {
  await recordAttempt(client, learner, {
    studySessionId: 'study-a',
    questionId: 'fr-a1-001@1:q1',
    submissionKey: 'traced',
    evidenceKind: 'independent',
    answer: 'suis'
  });
  const skills = await getMastery(client, learner, 'fr');
  expect(skills.find((skill) => skill.skillId === 'fr-a1-001')).toMatchObject({
    correct: 1
  });
  expect(recorded.map((entry) => entry.name)).toEqual([
    'mastery.begin-write',
    'mastery.enrollment-check',
    'mastery.catalog',
    'mastery.prerequisites',
    'mastery.load-evidence',
    'mastery.current-content',
    'mastery.record-evidence',
    'mastery.commit'
  ]);
  const stored = await loadEvidenceRows(client, {
    ownerId: learner.userId,
    language: 'fr'
  });
  expect(stored.length).toBeGreaterThan(0);
  expect(
    recorded.find((entry) => entry.name === 'mastery.load-evidence')?.set
  ).toEqual({ rows: stored.length });
  expect(
    recorded.find((entry) => entry.name === 'mastery.record-evidence')
      ?.attributes
  ).toEqual({ rows: 1 });
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

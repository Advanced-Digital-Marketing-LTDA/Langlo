import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';
import { load as mapPage } from '../src/routes/app/map/+page.server';
import { load as progressPage } from '../src/routes/app/progress/+page.server';
import { load as practicePage } from '../src/routes/app/practice/[language]/+page.server';
import { recordAttempt } from '../src/lib/server/study';

let client: Client;
let close: () => void;
let databaseUrl: string;
beforeEach(async () => {
  const target = await fixture();
  databaseUrl = target.databaseUrl;
  ({ client, close } = await openFixtureDatabase(target));
  const pkg = approvedPackage();
  for (const version of pkg.versions)
    version.lesson = {
      title: `Lesson ${version.skillId}`,
      explanation: 'Synthetic lesson',
      examples: [],
      references: []
    };
  await importContent(client, pkg);
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});
const learnerEvent = (
  userId: string | null,
  url: string,
  params?: { language: string }
) =>
  ({
    locals: {
      config: { dataEnabled: true, databaseUrl } as RuntimeConfig,
      user: userId ? { id: userId } : null,
      session: userId ? { userId } : null
    },
    url: new URL(url),
    ...(params && { params })
  }) as never;
const event = (userId: string | null, query = '') =>
  learnerEvent(userId, `http://127.0.0.1/app/map${query}`);
const practiceEvent = (userId: string | null, language = 'fr') =>
  learnerEvent(userId, `http://127.0.0.1/app/practice/${language}`, {
    language
  });

it('requires a verified learner and rejects an unenrolled language', async () => {
  await expect(mapPage(event(null))).rejects.toMatchObject({
    status: 303,
    location: '/login'
  });
  await expect(
    progressPage(event('learner-a', '?language=de'))
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    mapPage(event('learner-a', '?language=de'))
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    practicePage(practiceEvent('learner-a', 'de'))
  ).rejects.toMatchObject({
    status: 404
  });
});

it('returns the owner’s versioned progress, preserves manual topics and shows unavailable content', async () => {
  await client.execute(
    "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
  );
  const data = (await mapPage(event('learner-a'))) as {
    tracks: {
      language: string;
      progress: Promise<{
        skills: {
          skillId: string;
          available: boolean;
          status: string;
          prerequisites: string[];
        }[];
      }>;
    }[];
  };
  const progress = await data.tracks[0].progress;
  expect(data.tracks).toHaveLength(1);
  expect(
    progress.skills.find((skill) => skill.skillId === 'fr-a1-001')
  ).toMatchObject({ available: false, status: 'unknown' });
  expect(
    progress.skills.find((skill) => skill.skillId === 'fr-a1-002')
  ).toMatchObject({ available: true, prerequisites: ['fr-a1-001'] });
  expect(JSON.stringify(progress)).not.toContain('learner-b');
  await client.execute("DELETE FROM enrollments WHERE owner_id = 'learner-a'");
  expect(await progressPage(event('learner-a'))).toMatchObject({ tracks: [] });
});

it('filters an enrolled track without leaking other tracks into the response', async () => {
  await client.execute(
    "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-en', 'learner-a', 'en', 'A2', 'en')"
  );
  const onlyEnglish = await progressPage(event('learner-a', '?language=en'));
  expect(onlyEnglish).toEqual({
    tracks: [{ language: 'en', level: 'A2', skills: [], recommendation: null }]
  });
  const onlyFrench = (await mapPage(event('learner-a', '?language=fr'))) as {
    tracks: { language: string }[];
  };
  expect(onlyFrench.tracks.map((track) => track.language)).toEqual(['fr']);
});

it('returns a catalog before the same track progress finishes', async () => {
  const data = (await mapPage(event('learner-a'))) as {
    tracks: {
      language: string;
      level: string;
      catalog: Promise<{
        language: string;
        level: string;
        skills: { skillId: string; title: string; available: boolean }[];
      }>;
      progress: Promise<{
        language: string;
        skills: { skillId: string; status: string }[];
      }>;
    }[];
  };
  expect(
    data.tracks.map(({ language, level }) => ({ language, level }))
  ).toEqual([{ language: 'fr', level: 'A1' }]);
  expect(data.tracks[0].catalog).toBeInstanceOf(Promise);
  expect(data.tracks[0].progress).toBeInstanceOf(Promise);
  let progressSettled = false;
  const progressDone = data.tracks[0].progress.finally(() => {
    progressSettled = true;
  });
  const catalog = await data.tracks[0].catalog;
  expect(progressSettled).toBe(false);
  const progress = await progressDone;
  expect(catalog).toMatchObject({ language: 'fr', level: 'A1' });
  expect(catalog.skills[0]).toMatchObject({
    skillId: 'fr-a1-001',
    title: 'Lesson fr-a1-001',
    available: true
  });
  expect(progress.language).toBe('fr');
  expect(progress.skills[0]).toMatchObject({
    skillId: 'fr-a1-001',
    status: 'unknown'
  });
});

it('logs a catalog failure once when its dependent progress also rejects', async () => {
  await client.execute('DROP TABLE lessons');
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const data = (await mapPage(event('learner-a'))) as {
    tracks: {
      catalog: Promise<unknown>;
      progress: Promise<unknown>;
    }[];
  };
  await expect(data.tracks[0].catalog).rejects.toThrow();
  await expect(data.tracks[0].progress).rejects.toThrow();
  expect(log).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

it('logs a progress failure after its catalog resolves', async () => {
  await client.execute('DROP TABLE attempts');
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const data = (await mapPage(event('learner-a'))) as {
    tracks: {
      catalog: Promise<{ language: string }>;
      progress: Promise<unknown>;
    }[];
  };
  await expect(data.tracks[0].catalog).resolves.toMatchObject({
    language: 'fr'
  });
  await expect(data.tracks[0].progress).rejects.toThrow();
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][0]).toBe('Failed to load fr map progress');
  log.mockRestore();
});

it('returns every enrollment on the map without waiting for track progress', async () => {
  await client.execute(
    "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-de', 'learner-a', 'de', 'A1', 'en')"
  );
  const data = (await mapPage(event('learner-a'))) as {
    tracks: {
      language: string;
      catalog: Promise<unknown>;
      progress: Promise<{ language: string }>;
    }[];
  };
  expect(data.tracks.map(({ language }) => language)).toEqual(['de', 'fr']);
  expect(data.tracks.every((track) => track.progress instanceof Promise)).toBe(
    true
  );
  await expect(
    Promise.all(data.tracks.map((track) => track.progress))
  ).resolves.toMatchObject([{ language: 'de' }, { language: 'fr' }]);
});

it('loads practice recommendations and counts for the enrolled language', async () => {
  await recordAttempt(
    client,
    { userId: 'learner-a' },
    {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'practice-page-weak',
      evidenceKind: 'independent',
      answer: 'es'
    }
  );
  const data = (await practicePage(practiceEvent('learner-a'))) as {
    language: string;
    recommendations: {
      skillId: string;
      status: string;
      practisedSessions: number;
      answers: number;
    }[];
    skills: { skillId: string; practisedSessions: number; answers: number }[];
  };
  expect(data.language).toBe('fr');
  expect(data.recommendations).toMatchObject([
    {
      skillId: 'fr-a1-001',
      status: 'weak',
      practisedSessions: 1,
      answers: 1
    }
  ]);
  expect(
    data.skills.find((skill) => skill.skillId === 'fr-a1-001')
  ).toMatchObject({
    practisedSessions: 1,
    answers: 1
  });
});

it('logs and shows an error state when practice recommendations cannot load', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await client.execute('DROP TABLE lessons');
  const data = (await practicePage(practiceEvent('learner-a'))) as {
    language: string;
    recommendations: unknown[];
    skills: unknown[];
    error: string;
  };
  expect(data).toMatchObject({
    language: 'fr',
    recommendations: [],
    skills: [],
    error: 'Practice recommendations could not be loaded. Refresh to try again.'
  });
  expect(log).toHaveBeenCalledWith(
    'Failed to load practice recommendations',
    expect.any(Error)
  );
  log.mockRestore();
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';
import { load as mapPage } from '../src/routes/app/map/+page.server';
import { load as progressPage } from '../src/routes/app/progress/+page.server';

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
function event(userId: string | null, query = '') {
  return {
    locals: {
      config: { dataEnabled: true, databaseUrl } as RuntimeConfig,
      user: userId ? { id: userId } : null,
      session: userId ? { userId } : null
    },
    url: new URL(`http://127.0.0.1/app/map${query}`)
  } as never;
}

it('requires a verified learner and rejects an unenrolled language', async () => {
  await expect(mapPage(event(null))).rejects.toMatchObject({
    status: 303,
    location: '/login'
  });
  await expect(
    progressPage(event('learner-a', '?language=de'))
  ).rejects.toMatchObject({ status: 404 });
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
  const catalog = await data.tracks[0].catalog;
  const progress = await data.tracks[0].progress;
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

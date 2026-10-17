import { afterEach, beforeEach, expect, it } from 'vitest';
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
      skills: {
        skillId: string;
        available: boolean;
        status: string;
        prerequisites: string[];
      }[];
    }[];
  };
  expect(data.tracks).toHaveLength(1);
  expect(
    data.tracks[0].skills.find((skill) => skill.skillId === 'fr-a1-001')
  ).toMatchObject({ available: false, status: 'unknown' });
  expect(
    data.tracks[0].skills.find((skill) => skill.skillId === 'fr-a1-002')
  ).toMatchObject({ available: true, prerequisites: ['fr-a1-001'] });
  expect(JSON.stringify(data)).not.toContain('learner-b');
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

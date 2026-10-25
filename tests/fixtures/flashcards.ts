import { migrateFixtureDatabase } from '../../src/lib/server/db/migrate';
import type { Client } from '@libsql/client';
import {
  createDeck,
  createNote,
  type LearnerSession
} from '../../src/lib/server/flashcards';
import type { FixtureTarget } from '../../src/lib/server/db/fixture-target';
import { createDisposableFixture, disposeDisposableFixture } from './database';
import { seedStudy } from './study';

const fixtures: FixtureTarget[] = [];

export async function disposeFlashcardFixtures() {
  await Promise.all(
    fixtures.splice(0).map((target) => disposeDisposableFixture(target))
  );
}

export async function fixture() {
  const target = await createDisposableFixture();
  fixtures.push(target);
  await migrateFixtureDatabase(target);
  await seedStudy(target);
  return target;
}

// These contexts are test fixtures and do not prove production authentication.
export const testSession = (userId: string): LearnerSession => ({ userId });

export function testSourceId(identity: string): string {
  return `langlo:v1:${identity.replaceAll('-', '').padStart(64, '0')}`;
}

export async function seedBasicNote(client: Client, learner: LearnerSession) {
  await createDeck(client, learner, {
    language: 'fr',
    id: 'deck-10000000-0000-4000-8000-000000000002',
    name: 'French'
  });
  return createNote(client, learner, {
    id: 'note-10000000-0000-4000-8000-000000000002',
    sourceId: testSourceId('10000000-0000-4000-8000-000000000002'),
    deckId: 'deck-10000000-0000-4000-8000-000000000002',
    kind: 'basic',
    content: { front: 'Merci', back: 'Thank you' }
  });
}

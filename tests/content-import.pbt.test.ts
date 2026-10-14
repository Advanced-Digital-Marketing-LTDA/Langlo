import fc from 'fast-check';
import { expect, it } from 'vitest';
import { propertyOptions } from './property-options';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  ContentImportError,
  importContent,
  type ContentPackage
} from '../src/lib/server/content-import';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';

// Random acyclic teaching-order graphs import once and then are no-ops; any
// edge that closes a loop rejects the package. Each run uses fresh skill IDs
// in one disposable fixture database.

const graph = fc
  .integer({ min: 1, max: 8 })
  .chain((size) =>
    fc.tuple(
      fc.constant(size),
      fc.array(fc.tuple(fc.nat(size - 1), fc.nat(size - 1)), { maxLength: 16 }),
      fc.tuple(fc.nat(size - 1), fc.nat(size - 1))
    )
  );

function packageFor(
  prefix: string,
  size: number,
  pairs: Array<[number, number]>
): ContentPackage {
  // A chain to the previous skill plus random edges, all from a higher index
  // to a lower one: acyclic, and every higher skill reaches every lower one.
  const skills = Array.from({ length: size }, (_, index) => ({
    id: `${prefix}-${index}`,
    language: 'fr' as const,
    level: 'A1' as const,
    review: 'approved',
    prerequisites: [
      ...new Set(
        [[index, index - 1], ...pairs]
          .filter(([from, to]) => from === index && to >= 0 && to < from)
          .map(([, to]) => `${prefix}-${to}`)
      )
    ]
  }));
  return {
    curriculumVersion: '0.1.0-synthetic.1',
    publicationStatus: 'approved',
    dependencySemantics: 'recommended_teaching_order',
    skills,
    versions: skills.map((skill) => ({
      id: `${skill.id}@1`,
      skillId: skill.id,
      version: 1,
      review: 'approved',
      questions: [
        {
          id: `${skill.id}@1:q1`,
          format: 'typed-blank' as const,
          prompt: 'Je ___ là.',
          answer: 'suis'
        }
      ]
    }))
  };
}

it('acyclic packages import idempotently and loops are always rejected', async () => {
  const { client, close } = await openFixtureDatabase(await fixture()).catch(
    async (error) => {
      await disposeFlashcardFixtures();
      throw error;
    }
  );
  let run = 0;
  try {
    await fc.assert(
      fc.asyncProperty(graph, async ([size, pairs, [low, high]]) => {
        run += 1;
        const looped = packageFor(`loop${run}`, size, pairs);
        // Close a loop: the lower skill now also follows the higher one.
        const [from, to] = low <= high ? [low, high] : [high, low];
        looped.skills[from].prerequisites.push(looped.skills[to].id);
        const error = await importContent(client, looped).catch((e) => e);
        expect(error).toBeInstanceOf(ContentImportError);
        expect((error as ContentImportError).code).toBe('PREREQUISITE_CYCLE');

        const pkg = packageFor(`dag${run}`, size, pairs);
        const first = await importContent(client, pkg);
        expect(first.skills).toBe(size);
        expect(first.prerequisites).toBeGreaterThanOrEqual(size - 1);
        expect(first.versions).toBe(size);
        expect(await importContent(client, pkg)).toEqual({
          skills: 0,
          prerequisites: 0,
          versions: 0,
          questions: 0,
          quarantined: 0
        });
      }),
      propertyOptions()
    );
  } finally {
    close();
    await disposeFlashcardFixtures();
  }
});

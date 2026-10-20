import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { bundlePackage } from '../src/lib/server/content-bundle';
import {
  ContentImportError,
  importContent,
  validatePackage,
  type ContentPackage
} from '../src/lib/server/content-import';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';

// Portuguese (Brazil) B1/B2 through the bundle reader and the importer, on a
// synthetic bundle and a disposable fixture database.

let client: Client;
let close: (() => void) | undefined;
let root: string | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
});

afterEach(async () => {
  close?.();
  close = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  await disposeFlashcardFixtures();
});

const header =
  'id,language,level,topic,skill,source_ids,placement_rationale,evidence_status,provenance,lifecycle_status,replaced_by';
const coreTracks = [
  'French A1',
  'German A1',
  'German A2',
  'English A1',
  'English A2'
];
const coreRows = [
  'fr-a1-001,French,A1',
  'de-a1-001,German,A1',
  'de-a2-001,German,A2',
  'en-a1-001,English,A1',
  'en-a2-001,English,A2'
];
const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

async function writeBundle(
  trackRows: string[],
  included: string[],
  graphEdges: Record<string, string[]> = {}
) {
  root = await mkdtemp(join(tmpdir(), 'langlo-bundle-'));
  const rows = [...coreRows, ...trackRows];
  const csv = [
    header,
    ...rows.map(
      (row) =>
        `${row},Topic,Synthetic objective,SRC-A,Synthetic placement,local-alignment,Synthetic fixture,active,`
    )
  ].join('\n');
  const ids = rows.map((row) => row.split(',')[0]);
  const graph = JSON.stringify({
    schema_version: 1,
    nodes: ids.map((id) => ({
      skill_id: id,
      prerequisites: graphEdges[id] ?? []
    }))
  });
  const registry = JSON.stringify({ schema_version: 1, ids });
  await mkdir(join(root, 'docs', 'evidence'), { recursive: true });
  await mkdir(join(root, 'content'));
  await writeFile(join(root, 'docs', 'curriculum-coverage.csv'), csv);
  await writeFile(join(root, 'content', 'prerequisites.json'), graph);
  await writeFile(
    join(root, 'content', 'curriculum-id-registry.json'),
    registry
  );
  await writeFile(
    join(root, 'content', 'curriculum-manifest.json'),
    JSON.stringify({
      manifest_version: 1,
      curriculum_version: '1.0.0',
      publication_status: 'approved',
      coverage_file: 'docs/curriculum-coverage.csv',
      coverage_sha256: sha256(csv),
      prerequisites_file: 'content/prerequisites.json',
      prerequisites_sha256: sha256(graph),
      id_registry_file: 'content/curriculum-id-registry.json',
      id_registry_sha256: sha256(registry),
      dependency_semantics: 'recommended_teaching_order',
      included_tracks: included,
      selected_subset_tracks: ['French A1']
    })
  );
  await writeFile(
    join(root, 'docs', 'evidence', 'T004.md'),
    '| ID | Source |\n| --- | --- |\n| `SRC-A` | Synthetic source |\n'
  );
  return root;
}

const portugueseRows = [
  'pt-b1-001,Portuguese,B1',
  'pt-b1-002,Portuguese,B1',
  'pt-b2-001,Portuguese,B2'
];
const bothTracks = [...coreTracks, 'Portuguese B1', 'Portuguese B2'];

function failureOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ContentImportError)) throw error;
    return `${error.code}: ${error.detail}`;
  }
  throw new Error('Expected a ContentImportError, but nothing was thrown.');
}

describe('Portuguese in the bundle reader and importer', () => {
  it('reads Portuguese rows as language pt with levels B1 and B2 and their edges', async () => {
    const dir = await writeBundle(portugueseRows, bothTracks, {
      'pt-b1-002': ['pt-b1-001'],
      'pt-b2-001': ['pt-b1-002']
    });
    const pkg = bundlePackage(dir);
    const pt = pkg.skills.filter((skill) => skill.id.startsWith('pt-'));
    expect(pt).toEqual([
      {
        id: 'pt-b1-001',
        language: 'pt',
        level: 'B1',
        review: 'approved',
        prerequisites: []
      },
      {
        id: 'pt-b1-002',
        language: 'pt',
        level: 'B1',
        review: 'approved',
        prerequisites: ['pt-b1-001']
      },
      {
        id: 'pt-b2-001',
        language: 'pt',
        level: 'B2',
        review: 'approved',
        prerequisites: ['pt-b1-002']
      }
    ]);
  });

  it('stores Portuguese skills and their prerequisite edge in the database', async () => {
    const dir = await writeBundle(portugueseRows, bothTracks, {
      'pt-b2-001': ['pt-b1-002']
    });
    await importContent(client, bundlePackage(dir));
    expect(
      (
        await client.execute(
          "SELECT id, language, level FROM skills WHERE language = 'pt' ORDER BY id"
        )
      ).rows.map((row) => ({ ...row }))
    ).toEqual([
      { id: 'pt-b1-001', language: 'pt', level: 'B1' },
      { id: 'pt-b1-002', language: 'pt', level: 'B1' },
      { id: 'pt-b2-001', language: 'pt', level: 'B2' }
    ]);
    expect(
      (
        await client.execute(
          "SELECT skill_id, prerequisite_id, language FROM prerequisites WHERE language = 'pt'"
        )
      ).rows.map((row) => ({ ...row }))
    ).toEqual([
      { skill_id: 'pt-b2-001', prerequisite_id: 'pt-b1-002', language: 'pt' }
    ]);
  });

  it('refuses a bundle whose Portuguese level is not B1 or B2', async () => {
    const dir = await writeBundle(
      ['pt-a1-001,Portuguese,A1'],
      [...coreTracks, 'Portuguese A1']
    );
    expect(failureOf(() => bundlePackage(dir))).toMatch(
      /^INVALID_BUNDLE: .*Included tracks do not match|Unsupported language and level: Portuguese A1/u
    );
  });

  it('refuses a bundle that holds Portuguese rows the manifest does not list', async () => {
    const dir = await writeBundle(portugueseRows, coreTracks);
    expect(failureOf(() => bundlePackage(dir))).toMatch(
      /^INVALID_BUNDLE: Manifest tracks do not match the catalog/u
    );
  });

  describe('importer package validation', () => {
    const skill = (
      id: string,
      language: string,
      level: string,
      prerequisites: string[] = []
    ) => ({ id, language, level, review: 'approved', prerequisites });
    const pkg = (skills: ReturnType<typeof skill>[]): ContentPackage =>
      ({
        curriculumVersion: '1.0.0',
        publicationStatus: 'approved',
        dependencySemantics: 'recommended_teaching_order',
        skills,
        versions: []
      }) as unknown as ContentPackage;

    it('accepts pt B1 and B2 and a B2 skill that depends on a B1 skill', () => {
      expect(() =>
        validatePackage(
          pkg([
            skill('pt-b1-001', 'pt', 'B1'),
            skill('pt-b2-001', 'pt', 'B2', ['pt-b1-001'])
          ])
        )
      ).not.toThrow();
    });

    it.each([
      ['pt', 'A1'],
      ['pt', 'A2'],
      ['fr', 'B1'],
      ['de', 'B2'],
      ['en', 'B1']
    ])('refuses %s %s', (language, level) => {
      expect(
        failureOf(() => validatePackage(pkg([skill('x-001', language, level)])))
      ).toMatch(/^INVALID_PACKAGE/u);
    });

    it('refuses a B1 skill that depends on a B2 skill', async () => {
      const content = pkg([
        skill('pt-b2-001', 'pt', 'B2'),
        skill('pt-b1-001', 'pt', 'B1', ['pt-b2-001'])
      ]);
      await expect(importContent(client, content)).rejects.toMatchObject({
        code: 'INVALID_PREREQUISITE'
      });
    });

    it('refuses a Portuguese lesson translation on a Portuguese skill', () => {
      const content = pkg([skill('pt-b1-001', 'pt', 'B1')]);
      content.versions.push({
        id: 'pt-b1-001@1',
        skillId: 'pt-b1-001',
        version: 1,
        review: 'approved',
        questions: [
          {
            id: 'pt-b1-001@1:q01',
            format: 'typed-blank',
            prompt: 'Eu ___ ontem. (ir)',
            answer: 'fui'
          }
        ],
        translations: {
          pt: {
            title: 't',
            explanation: 'e',
            examples: [{ pt: 'a' }],
            references: []
          }
        }
      });
      expect(failureOf(() => validatePackage(content))).toMatch(
        /translation requires an English lesson/u
      );
    });
  });
});

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
  importContent
} from '../src/lib/server/content-import';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';

// Bundle import on a disposable fixture database. The repository bundle is a
// draft and must be refused; the approved bundles are synthetic temporary
// copies, not checked curriculum.

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

type Row = {
  id: string;
  track: string;
  evidence?: string;
  status?: string;
  replacedBy?: string;
};

const baseRows: Row[] = [
  { id: 'fr-a1-001', track: 'French,A1' },
  { id: 'fr-a1-002', track: 'French,A1' },
  { id: 'fr-a1-003', track: 'French,A1', status: 'retired' },
  { id: 'de-a1-001', track: 'German,A1' },
  { id: 'de-a2-001', track: 'German,A2' },
  { id: 'en-a1-001', track: 'English,A1' },
  { id: 'en-a2-001', track: 'English,A2' }
];

const baseGraph: Record<string, string[]> = {
  'fr-a1-002': ['fr-a1-001'],
  'de-a2-001': ['de-a1-001']
};

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

async function writeBundle(
  options: {
    status?: string;
    version?: string;
    rows?: Row[];
    tamper?: boolean;
    topic?: string;
    reorder?: boolean;
  } = {}
) {
  root = await mkdtemp(join(tmpdir(), 'langlo-bundle-'));
  const rows = options.rows ?? baseRows;
  const csv = [
    header,
    ...rows.map((row) =>
      [
        row.id,
        row.track,
        options.topic ?? 'Topic',
        'Synthetic objective',
        'SRC-A',
        'Synthetic placement',
        row.evidence ?? 'local-alignment',
        'Synthetic fixture',
        row.status ?? 'active',
        row.replacedBy ?? ''
      ].join(',')
    )
  ].join('\n');
  const graph = JSON.stringify({
    schema_version: 1,
    nodes: rows.map((row) => ({
      skill_id: row.id,
      prerequisites: baseGraph[row.id] ?? []
    }))
  });
  const registry = JSON.stringify({
    schema_version: 1,
    ids: rows.map((row) => row.id)
  });
  const manifest = {
    manifest_version: 1,
    curriculum_version: options.version ?? '1.0.0',
    publication_status: options.status ?? 'approved',
    coverage_file: 'docs/curriculum-coverage.csv',
    coverage_sha256: sha256(csv),
    prerequisites_file: 'content/prerequisites.json',
    prerequisites_sha256: sha256(graph),
    id_registry_file: 'content/curriculum-id-registry.json',
    id_registry_sha256: sha256(registry),
    dependency_semantics: 'recommended_teaching_order',
    included_tracks: [
      'French A1',
      'German A1',
      'German A2',
      'English A1',
      'English A2'
    ],
    selected_subset_tracks: ['French A1']
  };
  await mkdir(join(root, 'docs', 'evidence'), { recursive: true });
  await mkdir(join(root, 'content'));
  await writeFile(
    join(root, 'docs', 'curriculum-coverage.csv'),
    options.tamper ? `${csv}\n` : csv
  );
  await writeFile(join(root, 'content', 'prerequisites.json'), graph);
  await writeFile(
    join(root, 'content', 'curriculum-id-registry.json'),
    registry
  );
  await writeFile(
    join(root, 'content', 'curriculum-manifest.json'),
    JSON.stringify(
      options.reorder
        ? Object.fromEntries(Object.entries(manifest).reverse())
        : manifest
    )
  );
  await writeFile(
    join(root, 'docs', 'evidence', 'T004.md'),
    '| ID | Source |\n| --- | --- |\n| `SRC-A` | Synthetic source |\n'
  );
  return root;
}

async function skillIds() {
  const rows = await client.execute('SELECT id FROM skills ORDER BY id');
  return rows.rows.map((row) => String(row.id));
}

function codeOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ContentImportError);
    return (error as ContentImportError).code;
  }
  return undefined;
}

describe('content bundle import', () => {
  it('reads the repository bundle and refuses it while it is a draft', async () => {
    const pkg = bundlePackage(process.cwd());
    expect(pkg.publicationStatus).toBe('draft');
    expect(pkg.skills.length).toBeGreaterThan(100);
    expect(pkg.skills.every((skill) => skill.review === 'unreviewed')).toBe(
      true
    );
    const before = await skillIds();
    const error = await importContent(client, pkg).catch((e) => e);
    expect((error as ContentImportError).code).toBe('NOT_APPROVED');
    expect(await skillIds()).toEqual(before);
  });

  it('imports an approved bundle once, with its active skills and edges', async () => {
    const pkg = bundlePackage(await writeBundle());
    expect(pkg.curriculumVersion).toBe('1.0.0');
    expect(pkg.skills.map((skill) => skill.id)).not.toContain('fr-a1-003');
    expect(pkg.skills.find((skill) => skill.id === 'de-a2-001')).toEqual({
      id: 'de-a2-001',
      language: 'de',
      level: 'A2',
      review: 'approved',
      prerequisites: ['de-a1-001']
    });
    expect(await importContent(client, pkg)).toEqual({
      skills: 6,
      prerequisites: 2,
      versions: 0,
      questions: 0,
      quarantined: 0
    });
    expect((await importContent(client, pkg)).skills).toBe(0);
    expect(await skillIds()).toEqual(
      expect.arrayContaining(['fr-a1-001', 'en-a2-001'])
    );
  });

  it('imports versions supplied with an approved bundle', async () => {
    const pkg = bundlePackage(await writeBundle(), [
      {
        id: 'fr-a1-001@1',
        skillId: 'fr-a1-001',
        version: 1,
        review: 'approved',
        questions: [
          {
            id: 'fr-a1-001@1:q1',
            format: 'typed-blank',
            prompt: 'Je ___ là.',
            answer: 'suis'
          }
        ]
      }
    ]);
    expect((await importContent(client, pkg)).versions).toBe(1);
  });

  it('refuses a changed bundle reissued under an imported version', async () => {
    await importContent(client, bundlePackage(await writeBundle()));
    await rm(root as string, { recursive: true, force: true });
    // Only catalog text changes; the imported skills and edges are identical.
    const reissued = bundlePackage(await writeBundle({ topic: 'Renamed' }));
    const error = await importContent(client, reissued).catch((e) => e);
    expect((error as ContentImportError).code).toBe('CONTENT_CONFLICT');
  });

  it('treats a manifest with reordered keys as the same bundle', async () => {
    await importContent(client, bundlePackage(await writeBundle()));
    await rm(root as string, { recursive: true, force: true });
    const reordered = bundlePackage(await writeBundle({ reorder: true }));
    expect((await importContent(client, reordered)).skills).toBe(0);
  });

  it('rejects a bundle whose files do not match the manifest hashes', async () => {
    const tampered = await writeBundle({ tamper: true });
    expect(codeOf(() => bundlePackage(tampered))).toBe('INVALID_BUNDLE');
  });

  it('rejects an approved bundle that still has a provisional skill', async () => {
    const rows = baseRows.map((row, index) =>
      index === 0 ? { ...row, evidence: 'provisional' } : row
    );
    const provisional = await writeBundle({ rows });
    expect(codeOf(() => bundlePackage(provisional))).toBe('INVALID_BUNDLE');
  });

  it('rejects an approved bundle with a pre-release version', async () => {
    const draftVersion = await writeBundle({ version: '1.0.0-rc.1' });
    expect(codeOf(() => bundlePackage(draftVersion))).toBe('INVALID_BUNDLE');
  });
});

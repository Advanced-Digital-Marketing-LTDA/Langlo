import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Graph } from '../scripts/curriculum-contract.mjs';
import {
  headers,
  parseCsv,
  resolveRepositoryPath,
  validateBundle,
  validateCatalog,
  validateGraph,
  validateIdRegistry,
  validateIdRegistryShape,
  validateManifest,
  validatePublicationStatus
} from '../scripts/curriculum-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { manifest, records, catalog, registry, graph, edges } =
  validateBundle(root);
const evidence = readFileSync(resolve(root, 'docs/evidence/T004.md'), 'utf8');
const knownSources = new Set(
  [...evidence.matchAll(/^\|\s*`([A-Z0-9-]+)`\s*\|/gmu)].map(
    (match) => match[1]
  )
);
const registryIds = new Set(registry.ids);

function validateRows(rows: string[][]) {
  return validateCatalog(rows, knownSources, registryIds);
}

function getNode(source: Graph, id: string) {
  const node = source.nodes.find((item) => item.skill_id === id);
  if (!node) throw new Error(`Missing graph node: ${id}`);
  return node;
}

describe('versioned curriculum bundle contract', () => {
  it('confines bundle and prior-registry file paths to the repository', () => {
    expect(
      resolveRepositoryPath(root, 'content/curriculum-manifest.json')
    ).toBe(resolve(root, 'content/curriculum-manifest.json'));
    expect(() => resolveRepositoryPath(root, '../')).toThrow(
      /parent segments/u
    );
    expect(() => resolveRepositoryPath(root, '/tmp')).toThrow(
      /parent segments/u
    );
    expect(() =>
      resolveRepositoryPath(
        root,
        resolve(root, 'content/curriculum-id-registry.json')
      )
    ).toThrow(/parent segments/u);
    expect(() => resolveRepositoryPath(root, String.raw`C:\temp`)).toThrow(
      /parent segments/u
    );
  });

  it('is approved at a stable version, with separate publication status, explicit scope and file hashes', () => {
    // The draft rules are checked on a draft copy of the approved manifest.
    const draft = {
      ...manifest,
      curriculum_version: '0.1.0-draft.1',
      publication_status: 'draft'
    };
    const files = new Map(
      [
        manifest.coverage_file,
        manifest.prerequisites_file,
        manifest.id_registry_file
      ].map((path) => [path, readFileSync(resolve(root, path), 'utf8')])
    );
    expect(manifest.curriculum_version).toMatch(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
    );
    expect(manifest.publication_status).toBe('approved');
    expect(manifest.dependency_semantics).toBe('recommended_teaching_order');
    expect(manifest.selected_subset_tracks).toContain('French A1');
    expect(() => validateManifest(manifest, files)).not.toThrow();
    expect(() => validateManifest(draft, files)).not.toThrow();
    expect(() =>
      validateManifest(
        { ...draft, dependency_semantics: 'mastery_gate' },
        files
      )
    ).toThrow();
    expect(() =>
      validateManifest({ ...draft, publication_status: 'released' }, files)
    ).toThrow();
    expect(() =>
      validateManifest({ ...draft, curriculum_version: '1.0.0' }, files)
    ).toThrow(/draft version must be a pre-release/u);
    expect(() =>
      validateManifest({ ...draft, curriculum_version: 'draft' }, files)
    ).toThrow();
    expect(() =>
      validateManifest(
        { ...draft, curriculum_version: '0.1.0-draft.01' },
        files
      )
    ).toThrow(/Invalid curriculum version/u);
    expect(() =>
      validateManifest(
        { ...draft, curriculum_version: '0.1.0-draft..1' },
        files
      )
    ).toThrow(/Invalid curriculum version/u);
    expect(() =>
      validateManifest({ ...draft, curriculum_version: '0.1.0-0' }, files)
    ).not.toThrow();
    expect(() =>
      validateManifest(
        {
          ...draft,
          curriculum_version: '0.1.0+build.01',
          publication_status: 'approved'
        },
        files
      )
    ).not.toThrow();
    expect(() =>
      validateManifest(
        {
          ...draft,
          curriculum_version: '0.1.0-draft.1',
          publication_status: 'approved'
        },
        files
      )
    ).toThrow(/approved version must be stable/u);
    expect(() =>
      validateManifest({ ...draft, curriculum_version: '01.1.0' }, files)
    ).toThrow(/Invalid curriculum version/u);
    expect(() =>
      validateManifest(
        { ...draft, curriculum_version: '0.1.0-alpha+meta+again' },
        files
      )
    ).toThrow(/Invalid curriculum version/u);
    expect(() =>
      validateManifest({ ...draft, coverage_sha256: '0'.repeat(64) }, files)
    ).toThrow();
    expect(() =>
      validateManifest({ ...draft, coverage_file: '../outside.csv' }, files)
    ).toThrow(/Invalid manifest path/u);
  });

  it('rejects arbitrary CLI file paths before reading files', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/curriculum-contract.mjs'), '../outside.json'],
      { cwd: root, encoding: 'utf8' }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CLI file paths are not accepted.');
  });

  it('parses valid quoted CSV and rejects malformed quote placement', () => {
    expect(parseCsv('id,skill\n1,"be, have"\n')).toEqual([
      ['id', 'skill'],
      ['1', 'be, have']
    ]);
    expect(parseCsv('id,skill\r\n1,"say ""hello"""\r\n')).toEqual([
      ['id', 'skill'],
      ['1', 'say "hello"']
    ]);
    expect(() => parseCsv('id,skill\n1,"unfinished\n')).toThrow();
    expect(() => parseCsv('id,skill\n1,un"escaped\n')).toThrow();
    expect(() => parseCsv('id,skill\n1,"quoted"x\n')).toThrow();
  });

  it('validates row width, required values, status values, source IDs and track placement', () => {
    expect(records[0]).toEqual(headers);
    expect(new Set(catalog.keys()).size).toBe(records.length - 1);
    expect(
      [...catalog.values()].every((row) =>
        row.every((value, index) => index === 10 || value.trim().length > 0)
      )
    ).toBe(true);

    const row = [...records[1]];
    const withRow = (change: (copy: string[]) => void) => {
      const copy = [...row];
      change(copy);
      return [records[0], copy, ...records.slice(2)];
    };
    expect(() => validateRows(withRow((copy) => copy.pop()))).toThrow(
      /row width/u
    );
    for (const field of [
      'topic',
      'skill',
      'placement_rationale',
      'provenance'
    ]) {
      expect(() =>
        validateRows(
          withRow((copy) => {
            copy[headers.indexOf(field)] = '   ';
          })
        )
      ).toThrow(/Empty required field/u);
    }
    expect(() =>
      validateRows(
        withRow((copy) => {
          copy[7] = 'source-aligned ';
        })
      )
    ).toThrow(/evidence status/u);
    expect(() =>
      validateRows(
        withRow((copy) => {
          copy[1] = 'French';
          copy[2] = 'A2';
        })
      )
    ).toThrow(/Unsupported language and level/u);
    expect(() =>
      validateRows(
        withRow((copy) => {
          copy[5] = 'UNREGISTERED';
        })
      )
    ).toThrow(/Unknown source/u);
    expect(() => validateRows([...records, [...records[1]]])).toThrow(
      /Duplicate skill ID/u
    );
  });

  it('keeps lifecycle history separate from active objectives and mastery', () => {
    const retired = [...catalog.values()].filter((row) => row[9] === 'retired');
    expect(retired.length).toBeGreaterThan(0);
    expect(
      retired.every((row) =>
        row[10].split(';').every((id) => catalog.get(id)?.[9] === 'active')
      )
    ).toBe(true);
    expect(() =>
      validateRows(
        records.map((row, index) =>
          index === 1 ? [...row.slice(0, 9), 'unknown', ''] : [...row]
        )
      )
    ).toThrow(/lifecycle status/u);
    const badReplacement = records.map((row) => [...row]);
    const retiredIndex = badReplacement.findIndex(
      (row) => row[9] === 'retired'
    );
    badReplacement[retiredIndex][10] = 'missing-skill';
    expect(() => validateRows(badReplacement)).toThrow(/Unknown replacement/u);
  });

  it('requires a unique ID registry and rejects removal of an earlier ID', () => {
    validateIdRegistry(registry, catalog);
    expect(validateIdRegistryShape(registry)).toEqual(registry.ids);
    expect(() => validateIdRegistryShape({})).toThrow(/Invalid ID registry/u);
    expect(() =>
      validateIdRegistryShape({ schema_version: 1, ids: [''] })
    ).toThrow(/Invalid ID registry/u);
    const firstId = registry.ids[0];
    const retiredId = [...catalog.values()].find(
      (row) => row[9] === 'retired'
    )?.[0];
    if (!retiredId) throw new Error('The catalog needs a retired skill.');
    const missingTombstone = new Map(catalog);
    missingTombstone.delete(retiredId);
    expect(() => validateIdRegistry(registry, missingTombstone)).toThrow(
      /missing its catalog tombstone/u
    );
    expect(() =>
      validateIdRegistry(
        { ...registry, ids: [...registry.ids, firstId] },
        catalog
      )
    ).toThrow(/Duplicate ID registry/u);
    expect(() =>
      validateIdRegistry(registry, catalog, ['previously-used-id'])
    ).toThrow(/Previously registered ID was removed/u);
  });

  it('blocks approval while an active skill has provisional evidence', () => {
    expect(() => validatePublicationStatus(manifest, catalog)).not.toThrow();
    const provisional = new Map(catalog);
    const [id, row] = [...catalog.entries()][0];
    provisional.set(
      id,
      row.map((cell, index) => (index === 7 ? 'provisional' : cell))
    );
    expect(() => validatePublicationStatus(manifest, provisional)).toThrow(
      /provisional skill/u
    );
  });

  it('validates same-language, level-ordered, acyclic graph structure without pinning lesson choices', () => {
    expect(validateGraph(graph, catalog)).toBe(edges);
    const omitted = globalThis.structuredClone(graph);
    Reflect.deleteProperty(omitted.nodes[0], 'prerequisites');
    expect(() => validateGraph(omitted, catalog)).toThrow(
      /Invalid prerequisites/u
    );

    const missing = globalThis.structuredClone(graph);
    missing.nodes[0].prerequisites = ['missing-skill-id'];
    expect(() => validateGraph(missing, catalog)).toThrow(
      /Unknown prerequisite/u
    );

    const selfEdge = globalThis.structuredClone(graph);
    selfEdge.nodes[0].prerequisites = [selfEdge.nodes[0].skill_id];
    expect(() => validateGraph(selfEdge, catalog)).toThrow(
      /Self prerequisite/u
    );

    const crossLanguage = globalThis.structuredClone(graph);
    const first = catalog.values().next().value;
    if (!first) throw new Error('The catalog is empty.');
    const otherLanguage = [...catalog.values()].find(
      (row) => row[1] !== first[1]
    );
    if (!otherLanguage)
      throw new Error('The catalog needs multiple languages.');
    getNode(crossLanguage, first[0]).prerequisites = [otherLanguage[0]];
    expect(() => validateGraph(crossLanguage, catalog)).toThrow(
      /Cross-language prerequisite/u
    );

    const a1 = [...catalog.values()].find(
      (row) =>
        row[9] === 'active' &&
        row[2] === 'A1' &&
        [...catalog.values()].some(
          (candidate) =>
            candidate[9] === 'active' &&
            candidate[1] === row[1] &&
            candidate[2] === 'A2'
        )
    );
    if (!a1) throw new Error('The catalog needs an active A1 skill.');
    const higherLevel = [...catalog.values()].find(
      (row) => row[9] === 'active' && row[1] === a1[1] && row[2] === 'A2'
    );
    if (!higherLevel) throw new Error('The catalog needs an active A2 skill.');
    const invalidLevel = globalThis.structuredClone(graph);
    getNode(invalidLevel, a1[0]).prerequisites = [higherLevel[0]];
    expect(() => validateGraph(invalidLevel, catalog)).toThrow(
      /Higher-level prerequisite/u
    );

    const retired = [...catalog.values()].find((row) => row[9] === 'retired');
    if (!retired) throw new Error('The catalog needs a retired skill.');
    const retiredDependency = globalThis.structuredClone(graph);
    getNode(retiredDependency, a1[0]).prerequisites = [retired[0]];
    expect(() => validateGraph(retiredDependency, catalog)).toThrow(
      /Retired skill is a prerequisite/u
    );

    const cycle = globalThis.structuredClone(graph);
    const peers = [...catalog.values()].filter(
      (row) => row[9] === 'active' && row[1] === first[1] && row[2] === first[2]
    );
    const [left, right] = peers.slice(0, 2);
    if (!left || !right) throw new Error('The catalog needs two peer skills.');
    getNode(cycle, left[0]).prerequisites = [right[0]];
    getNode(cycle, right[0]).prerequisites = [left[0]];
    expect(() => validateGraph(cycle, catalog)).toThrow(/cycle/u);
  });
});

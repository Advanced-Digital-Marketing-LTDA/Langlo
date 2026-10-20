import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  validateBundle,
  validateCatalog,
  validateGraph,
  validateManifest,
  validateManifestCoversCatalog
} from '../scripts/curriculum-contract.mjs';

// Portuguese (Brazil) B1 and B2 join the five existing tracks one at a time:
// the manifest lists exactly the tracks the catalog holds, and B2 never
// appears without B1.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { manifest, records, catalog, registry, graph } = validateBundle(root);
const evidence = readFileSync(resolve(root, 'docs/evidence/T004.md'), 'utf8');
const knownSources = new Set(
  [...evidence.matchAll(/^\|\s*`([A-Z0-9-]+)`\s*\|/gmu)].map(
    (match) => match[1]
  )
);
const files = new Map(
  [
    manifest.coverage_file,
    manifest.prerequisites_file,
    manifest.id_registry_file
  ].map((path) => [path, readFileSync(resolve(root, path), 'utf8')])
);

const coreTracks = [
  'French A1',
  'German A1',
  'German A2',
  'English A1',
  'English A2'
];

function ptRow(id: string, level: string, language = 'Portuguese') {
  const row = [...records[1]];
  row[0] = id;
  row[1] = language;
  row[2] = level;
  return row;
}

function validate(rows: string[][], extraIds: string[]) {
  return validateCatalog(
    rows,
    knownSources,
    new Set([...registry.ids, ...extraIds])
  );
}

describe('Portuguese tracks in the curriculum contract', () => {
  it('lists the five existing tracks, then Portuguese B1, then B2, in that order only', () => {
    const accepts = (included: string[]) =>
      validateManifest({ ...manifest, included_tracks: included }, files);
    expect(() => accepts(coreTracks)).not.toThrow();
    expect(() => accepts([...coreTracks, 'Portuguese B1'])).not.toThrow();
    expect(() =>
      accepts([...coreTracks, 'Portuguese B1', 'Portuguese B2'])
    ).not.toThrow();
    for (const bad of [
      [...coreTracks, 'Portuguese B2'],
      [...coreTracks, 'Portuguese B2', 'Portuguese B1'],
      [...coreTracks, 'Portuguese A1'],
      ['Portuguese B1', ...coreTracks],
      [...coreTracks, 'Portuguese B1', 'Portuguese B1']
    ])
      expect(() => accepts(bad), JSON.stringify(bad)).toThrow(
        /Included tracks do not match/u
      );
  });

  it('accepts Portuguese B1 and B2 catalog rows and refuses other Portuguese levels', () => {
    const base = records.slice(0, 1).concat(records.slice(1));
    expect(() =>
      validate(
        [...base, ptRow('pt-b1-001', 'B1'), ptRow('pt-b2-001', 'B2')],
        ['pt-b1-001', 'pt-b2-001']
      )
    ).not.toThrow();
    expect(() =>
      validate([...base, ptRow('pt-a1-001', 'A1')], ['pt-a1-001'])
    ).toThrow(/Unsupported language and level: Portuguese A1/u);
    expect(() =>
      validate([...base, ptRow('fr-b1-001', 'B1', 'French')], ['fr-b1-001'])
    ).toThrow(/Unsupported language and level: French B1/u);
  });

  it('refuses Portuguese B2 without Portuguese B1', () => {
    expect(() =>
      validate([...records, ptRow('pt-b2-001', 'B2')], ['pt-b2-001'])
    ).toThrow(/Portuguese B2 requires Portuguese B1/u);
  });

  it('still requires all five existing tracks', () => {
    const withoutFrench = records.filter(
      (row, index) => index === 0 || row[1] !== 'French'
    );
    expect(() =>
      validate([...withoutFrench, ptRow('pt-b1-001', 'B1')], ['pt-b1-001'])
    ).toThrow(/requested tracks/u);
  });

  it('requires the manifest to list exactly the tracks the catalog holds', () => {
    const withPt = validate(
      [...records, ptRow('pt-b1-001', 'B1')],
      ['pt-b1-001']
    );
    const listed = [...coreTracks, 'Portuguese B1'];
    expect(() =>
      validateManifestCoversCatalog(
        { ...manifest, included_tracks: listed },
        withPt
      )
    ).not.toThrow();
    expect(() =>
      validateManifestCoversCatalog(
        { ...manifest, included_tracks: coreTracks },
        withPt
      )
    ).toThrow(/Manifest tracks do not match the catalog/u);
    expect(() =>
      validateManifestCoversCatalog(
        { ...manifest, included_tracks: listed },
        catalog
      )
    ).toThrow(/Manifest tracks do not match the catalog/u);
    expect(() =>
      validateManifestCoversCatalog(manifest, catalog)
    ).not.toThrow();
  });

  it('lets B2 skills depend on B1 skills but never the reverse, and never across languages', () => {
    const ids = ['pt-b1-001', 'pt-b2-001'];
    const rows = [
      ...records,
      ptRow('pt-b1-001', 'B1'),
      ptRow('pt-b2-001', 'B2')
    ];
    const withPt = validate(rows, ids);
    const nodes = (b1: string[], b2: string[]) => ({
      ...graph,
      nodes: [
        ...graph.nodes,
        { skill_id: 'pt-b1-001', prerequisites: b1 },
        { skill_id: 'pt-b2-001', prerequisites: b2 }
      ]
    });
    expect(() => validateGraph(nodes([], ['pt-b1-001']), withPt)).not.toThrow();
    expect(() => validateGraph(nodes(['pt-b2-001'], []), withPt)).toThrow(
      /Higher-level prerequisite: pt-b1-001 -> pt-b2-001/u
    );
    expect(() => validateGraph(nodes(['en-a2-001'], []), withPt)).toThrow(
      /Cross-language prerequisite: pt-b1-001 -> en-a2-001/u
    );
  });

  it('keeps the checked-in bundle valid', () => {
    expect(() =>
      validateManifestCoversCatalog(manifest, catalog)
    ).not.toThrow();
  });
});

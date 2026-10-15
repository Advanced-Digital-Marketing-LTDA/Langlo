import { createHash } from 'node:crypto';
import { log } from 'node:console';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** @typedef {string[]} CsvRow */
/** @typedef {Map<string, CsvRow>} Catalog */
/** @typedef {{ rows: CsvRow[], row: CsvRow, field: string, quoted: boolean, afterQuote: boolean, atFieldStart: boolean }} CsvState */
/** @typedef {{ manifest_version: number, curriculum_version: string, publication_status: string, coverage_file: string, coverage_sha256: string, prerequisites_file: string, prerequisites_sha256: string, id_registry_file: string, id_registry_sha256: string, dependency_semantics: string, included_tracks: string[], selected_subset_tracks: string[] }} Manifest */
/** @typedef {{ schema_version: number, ids: string[] }} IdRegistry */
/** @typedef {{ schema_version: number, nodes: { skill_id: string, prerequisites: string[] }[] }} Graph */

export const headers = [
  'id',
  'language',
  'level',
  'topic',
  'skill',
  'source_ids',
  'placement_rationale',
  'evidence_status',
  'provenance',
  'lifecycle_status',
  'replaced_by'
];

const tracks = [
  'French A1',
  'German A1',
  'German A2',
  'English A1',
  'English A2'
];
const allowedEvidence = new Set([
  'source-aligned',
  'local-alignment',
  'provisional'
]);
const priorRegistryFile = '.t004-prior-registry.json';
/** @param {string} value */
function isSemver(value) {
  const buildIndex = value.indexOf('+');
  if (buildIndex !== value.lastIndexOf('+')) return false;
  const version = buildIndex < 0 ? value : value.slice(0, buildIndex);
  const build = buildIndex < 0 ? '' : value.slice(buildIndex + 1);
  const prereleaseIndex = version.indexOf('-');
  const core =
    prereleaseIndex < 0 ? version : version.slice(0, prereleaseIndex);
  const prerelease =
    prereleaseIndex < 0 ? '' : version.slice(prereleaseIndex + 1);
  return (
    core.split('.').length === 3 &&
    core.split('.').every(isCoreNumber) &&
    (!prerelease || validIdentifiers(prerelease, true)) &&
    (!build || validIdentifiers(build, false)) &&
    (prereleaseIndex < 0 || prerelease.length > 0) &&
    (buildIndex < 0 || build.length > 0)
  );
}

/** @param {string} value */
function isCoreNumber(value) {
  return (
    value.length > 0 &&
    (value === '0' || !value.startsWith('0')) &&
    [...value].every((char) => char >= '0' && char <= '9')
  );
}

/** @param {string} value @param {boolean} disallowLeadingZero */
function validIdentifiers(value, disallowLeadingZero) {
  return value
    .split('.')
    .every(
      (identifier) =>
        identifier.length > 0 &&
        [...identifier].every(isSemverCharacter) &&
        (!disallowLeadingZero ||
          !isNumericIdentifier(identifier) ||
          identifier.length === 1 ||
          !identifier.startsWith('0'))
    );
}

/** @param {string} value */
function isSemverCharacter(value) {
  return (
    (value >= '0' && value <= '9') ||
    (value >= 'A' && value <= 'Z') ||
    (value >= 'a' && value <= 'z') ||
    value === '-'
  );
}

/** @param {string} value */
function isNumericIdentifier(value) {
  return [...value].every((char) => char >= '0' && char <= '9');
}

/** @param {CsvState} state */
function finishField(state) {
  state.row.push(state.field);
  state.field = '';
  state.afterQuote = false;
  state.atFieldStart = true;
}

/** @param {CsvState} state @param {boolean} keepEmpty */
function finishRow(state, keepEmpty) {
  state.row.push(state.field);
  if (keepEmpty || state.row.some((value) => value !== ''))
    state.rows.push(state.row);
  state.row = [];
  state.field = '';
  state.afterQuote = false;
  state.atFieldStart = true;
}

/** @param {string} char */
function isLineBreak(char) {
  return char === '\n' || char === '\r';
}

/** @param {CsvState} state @param {string} char @param {string | undefined} next @param {boolean} keepEmpty */
function consumeLineBreak(state, char, next, keepEmpty) {
  finishRow(state, keepEmpty);
  return char === '\r' && next === '\n';
}

/** @param {CsvState} state @param {string} char @param {string | undefined} next */
function consumeQuoted(state, char, next) {
  if (char === '"' && next === '"') {
    state.field += '"';
    return true;
  }
  if (char === '"') {
    state.quoted = false;
    state.afterQuote = true;
  } else {
    state.field += char;
  }
  return false;
}

/** @param {CsvState} state @param {string} char @param {string | undefined} next */
function consumeAfterQuote(state, char, next) {
  if (char === ',') {
    finishField(state);
    return false;
  }
  if (isLineBreak(char)) return consumeLineBreak(state, char, next, true);
  throw new Error('Unexpected character after a quoted CSV field.');
}

/** @param {CsvState} state @param {string} char @param {string | undefined} next */
function consumeUnquoted(state, char, next) {
  if (char === '"') {
    if (!state.atFieldStart)
      throw new Error('Unexpected quote inside an unquoted CSV field.');
    state.quoted = true;
    state.atFieldStart = false;
  } else if (char === ',') {
    finishField(state);
  } else if (isLineBreak(char)) {
    return consumeLineBreak(state, char, next, false);
  } else {
    state.field += char;
    state.atFieldStart = false;
  }
  return false;
}

/** @param {CsvState} state @param {string} char @param {string | undefined} next */
function consumeCsvCharacter(state, char, next) {
  if (state.quoted) return consumeQuoted(state, char, next);
  if (state.afterQuote) return consumeAfterQuote(state, char, next);
  return consumeUnquoted(state, char, next);
}

/** @param {CsvState} state @returns {CsvRow[]} */
function finishCsv(state) {
  if (state.quoted) throw new Error('Unclosed quoted CSV field.');
  if (state.field !== '' || state.row.length > 0 || state.afterQuote) {
    state.row.push(state.field);
    state.rows.push(state.row);
  }
  return state.rows;
}

/** @param {string} input @returns {CsvRow[]} */
export function parseCsv(input) {
  /** @type {CsvState} */
  const state = {
    rows: [],
    row: [],
    field: '',
    quoted: false,
    afterQuote: false,
    atFieldStart: true
  };
  let index = 0;
  while (index < input.length) {
    const skipNext = consumeCsvCharacter(state, input[index], input[index + 1]);
    index += skipNext ? 2 : 1;
  }
  return finishCsv(state);
}

/** @param {unknown} condition @param {string} message */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {string} value */
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string} root @param {string} path */
export function resolveRepositoryPath(root, path) {
  requireCondition(
    typeof path === 'string' &&
      path.length > 0 &&
      !isAbsolute(path) &&
      !win32.parse(path).root &&
      !path.split(/[\\/]/u).includes('..'),
    'Repository path must be relative and contain no parent segments.'
  );
  const repositoryRoot = realpathSync(root);
  const joinedPath = resolve(repositoryRoot, path);
  const joinedRelativePath = relative(repositoryRoot, joinedPath);
  requireCondition(
    joinedRelativePath !== '' &&
      joinedRelativePath !== '..' &&
      !joinedRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(joinedRelativePath),
    `Path resolves outside the repository: ${path}.`
  );
  const targetPath = realpathSync(joinedPath);
  const relativePath = relative(repositoryRoot, targetPath);
  requireCondition(
    relativePath !== '' &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath),
    `Path resolves outside the repository: ${path}.`
  );
  return targetPath;
}

/** @param {string} root @param {string} path */
function readRepositoryFile(root, path) {
  return readFileSync(resolveRepositoryPath(root, path), 'utf8');
}

/** @param {Manifest} manifest @param {Map<string, string>} files */
function validateManifestFiles(manifest, files) {
  for (const [path, declaredPath, expectedDigest] of [
    [
      'docs/curriculum-coverage.csv',
      manifest.coverage_file,
      manifest.coverage_sha256
    ],
    [
      'content/prerequisites.json',
      manifest.prerequisites_file,
      manifest.prerequisites_sha256
    ],
    [
      'content/curriculum-id-registry.json',
      manifest.id_registry_file,
      manifest.id_registry_sha256
    ]
  ]) {
    requireCondition(
      declaredPath === path,
      `Invalid manifest path: ${declaredPath}.`
    );
    const content = files.get(path);
    requireCondition(
      typeof content === 'string',
      `Manifest file is missing: ${path}.`
    );
    requireCondition(
      /^[a-f\d]{64}$/u.test(expectedDigest),
      `Invalid digest for ${path}.`
    );
    requireCondition(
      digest(content) === expectedDigest,
      `Digest mismatch: ${path}.`
    );
  }
}

/** @param {Manifest} manifest @param {Map<string, string>} files */
export function validateManifest(manifest, files) {
  requireCondition(
    manifest.manifest_version === 1,
    'Unsupported manifest version.'
  );
  requireCondition(
    typeof manifest.curriculum_version === 'string' &&
      isSemver(manifest.curriculum_version),
    'Invalid curriculum version.'
  );
  requireCondition(
    ['draft', 'approved'].includes(manifest.publication_status),
    'Invalid publication status.'
  );
  const prerelease = manifest.curriculum_version.split('+', 1)[0].includes('-');
  requireCondition(
    manifest.publication_status !== 'draft' || prerelease,
    'A draft version must be a pre-release.'
  );
  requireCondition(
    manifest.publication_status !== 'approved' || !prerelease,
    'An approved version must be stable.'
  );
  requireCondition(
    manifest.dependency_semantics === 'recommended_teaching_order',
    'Unsupported dependency semantics.'
  );
  requireCondition(
    JSON.stringify(manifest.included_tracks) === JSON.stringify(tracks),
    'Included tracks do not match the T004 scope.'
  );
  requireCondition(
    JSON.stringify(manifest.selected_subset_tracks) ===
      JSON.stringify(['French A1']),
    'The French A1 subset must be declared.'
  );
  validateManifestFiles(manifest, files);
}

/** @param {CsvRow[]} records */
function validateCatalogHeader(records) {
  requireCondition(
    records[0]?.length === headers.length &&
      records[0].every((value, index) => value === headers[index]),
    'Invalid catalog header.'
  );
}

/** @param {CsvRow} row @param {Catalog} catalog @param {Set<string>} knownSources */
function validateCatalogRow(row, catalog, knownSources) {
  requireCondition(
    row.length === headers.length,
    `Invalid row width for ${row[0] ?? '<unknown>'}.`
  );
  requireCondition(
    row.every(
      (value, index) => index === headers.length - 1 || value.trim().length > 0
    ),
    `Empty required field for ${row[0]}.`
  );
  const [
    id,
    language,
    level,
    ,
    ,
    sourceIds,
    ,
    evidenceStatus,
    ,
    status,
    replacement
  ] = row;
  requireCondition(!catalog.has(id), `Duplicate skill ID: ${id}.`);
  requireCondition(
    tracks.includes(`${language} ${level}`),
    `Unsupported language and level: ${language} ${level}.`
  );
  requireCondition(
    allowedEvidence.has(evidenceStatus),
    `Invalid evidence status for ${id}.`
  );
  requireCondition(
    ['active', 'retired'].includes(status),
    `Invalid lifecycle status for ${id}.`
  );
  requireCondition(
    status === 'retired' || replacement === '',
    `Active skill has a replacement: ${id}.`
  );
  for (const sourceId of sourceIds.split(';'))
    requireCondition(
      knownSources.has(sourceId),
      `Unknown source ${sourceId} for ${id}.`
    );
  catalog.set(id, row);
}

/** @param {CsvRow[]} records */
function validateCatalogTracks(records) {
  const catalogTracks = new Set(
    records.slice(1).map((row) => `${row[1]} ${row[2]}`)
  );
  requireCondition(
    catalogTracks.size === tracks.length &&
      tracks.every((track) => catalogTracks.has(track)),
    'Catalog does not contain exactly the five requested tracks.'
  );
}

/** @param {Catalog} catalog @param {Set<string>} registryIds */
function validateCatalogRegistry(catalog, registryIds) {
  for (const id of catalog.keys())
    requireCondition(registryIds.has(id), `Skill ID is not registered: ${id}.`);
}

/** @param {Catalog} catalog */
function validateReplacements(catalog) {
  for (const row of catalog.values()) {
    const id = row[0];
    for (const replacement of row[10] ? row[10].split(';') : []) {
      requireCondition(
        catalog.has(replacement),
        `Unknown replacement ${replacement} for ${id}.`
      );
      requireCondition(
        replacement !== id,
        `Skill cannot replace itself: ${id}.`
      );
      requireCondition(
        catalog.get(replacement)[9] === 'active',
        `Replacement must be active: ${replacement}.`
      );
    }
  }
}

/** @param {CsvRow[]} records @param {Set<string>} knownSources @param {Set<string>} registryIds @returns {Catalog} */
export function validateCatalog(records, knownSources, registryIds) {
  validateCatalogHeader(records);
  const catalog = new Map();
  for (const row of records.slice(1))
    validateCatalogRow(row, catalog, knownSources);
  validateCatalogTracks(records);
  validateCatalogRegistry(catalog, registryIds);
  validateReplacements(catalog);
  return catalog;
}

/** @param {unknown} value @returns {string[]} */
export function validateIdRegistryShape(value) {
  requireCondition(
    typeof value === 'object' &&
      value !== null &&
      'schema_version' in value &&
      value.schema_version === 1 &&
      'ids' in value &&
      Array.isArray(value.ids) &&
      value.ids.every((id) => typeof id === 'string' && id.trim().length > 0),
    'Invalid ID registry.'
  );
  requireCondition(
    new Set(value.ids).size === value.ids.length,
    'Duplicate ID registry entry.'
  );
  return value.ids;
}

/** @param {IdRegistry} registry @param {Catalog} catalog @param {string[]} [previousIds] */
export function validateIdRegistry(registry, catalog, previousIds = []) {
  const ids = validateIdRegistryShape(registry);
  for (const id of catalog.keys())
    requireCondition(ids.includes(id), `Skill ID is not registered: ${id}.`);
  for (const id of ids)
    requireCondition(
      catalog.has(id),
      `Registered ID is missing its catalog tombstone: ${id}.`
    );
  for (const id of previousIds)
    requireCondition(
      ids.includes(id),
      `Previously registered ID was removed: ${id}.`
    );
}

/** @param {string} name @returns {number} */
export function columnIndex(name) {
  const index = headers.indexOf(name);
  requireCondition(index >= 0, `Unknown coverage column: ${name}.`);
  return index;
}

/** @param {Manifest} manifest @param {Catalog} catalog */
export function validatePublicationStatus(manifest, catalog) {
  if (manifest.publication_status !== 'approved') return;
  const status = columnIndex('evidence_status');
  requireCondition(
    [...catalog.values()].every((row) => {
      const value = row.at(status);
      return typeof value === 'string' && value !== 'provisional';
    }),
    'An approved bundle cannot contain a provisional skill.'
  );
}

/** @param {Graph} graph @param {Catalog} catalog @returns {Map<string, string[]>} */
function indexGraph(graph, catalog) {
  requireCondition(
    graph.schema_version === 1 && Array.isArray(graph.nodes),
    'Invalid prerequisite graph.'
  );
  const nodes = new Map();
  for (const node of graph.nodes) {
    requireCondition(
      !nodes.has(node.skill_id),
      `Duplicate graph node: ${node.skill_id}.`
    );
    requireCondition(
      Array.isArray(node.prerequisites),
      `Invalid prerequisites for ${node.skill_id}.`
    );
    nodes.set(node.skill_id, node.prerequisites);
  }
  requireCondition(
    nodes.size === catalog.size &&
      [...catalog.keys()].every((id) => nodes.has(id)),
    'Graph and catalog IDs differ.'
  );
  return nodes;
}

/** @param {Map<string, string[]>} nodes @param {Catalog} catalog */
function validateGraphEdges(nodes, catalog) {
  for (const [id, prerequisites] of nodes) {
    const skill = catalog.get(id);
    requireCondition(
      skill[9] === 'active' || prerequisites.length === 0,
      `Retired skill has prerequisites: ${id}.`
    );
    requireCondition(
      new Set(prerequisites).size === prerequisites.length,
      `Duplicate prerequisite for ${id}.`
    );
    for (const prerequisiteId of prerequisites) {
      const prerequisite = catalog.get(prerequisiteId);
      requireCondition(
        prerequisite,
        `Unknown prerequisite ${prerequisiteId} for ${id}.`
      );
      requireCondition(
        prerequisite[9] === 'active',
        `Retired skill is a prerequisite: ${prerequisiteId}.`
      );
      requireCondition(prerequisiteId !== id, `Self prerequisite: ${id}.`);
      requireCondition(
        prerequisite[1] === skill[1],
        `Cross-language prerequisite: ${id} -> ${prerequisiteId}.`
      );
      const level = /** @type {const} */ ({ A1: 1, A2: 2 });
      requireCondition(
        level[/** @type {'A1' | 'A2'} */ (prerequisite[2])] <=
          level[/** @type {'A1' | 'A2'} */ (skill[2])],
        `Higher-level prerequisite: ${id} -> ${prerequisiteId}.`
      );
    }
  }
}

/** @param {Map<string, string[]>} nodes */
function validateGraphCycles(nodes) {
  const state = new Map();
  const visit = (id) => {
    requireCondition(
      state.get(id) !== 'active',
      `Prerequisite cycle at ${id}.`
    );
    if (state.get(id) === 'done') return;
    state.set(id, 'active');
    for (const prerequisiteId of nodes.get(id)) visit(prerequisiteId);
    state.set(id, 'done');
  };
  for (const id of nodes.keys()) visit(id);
}

/** @param {Graph} graph @param {Catalog} catalog @returns {number} */
export function validateGraph(graph, catalog) {
  const nodes = indexGraph(graph, catalog);
  validateGraphEdges(nodes, catalog);
  validateGraphCycles(nodes);
  return [...nodes.values()].reduce((total, ids) => total + ids.length, 0);
}

/** @param {string} root @returns {Map<string, string>} */
function readBundleFiles(root) {
  return new Map([
    [
      'docs/curriculum-coverage.csv',
      readRepositoryFile(root, 'docs/curriculum-coverage.csv')
    ],
    [
      'content/prerequisites.json',
      readRepositoryFile(root, 'content/prerequisites.json')
    ],
    [
      'content/curriculum-id-registry.json',
      readRepositoryFile(root, 'content/curriculum-id-registry.json')
    ]
  ]);
}

/** @param {string} root @returns {Set<string>} */
function readKnownSources(root) {
  const evidence = readRepositoryFile(root, 'docs/evidence/T004.md');
  return new Set(
    [...evidence.matchAll(/^\|\s*`([A-Z0-9-]+)`\s*\|/gmu)].map(
      (match) => match[1]
    )
  );
}

/** @param {string} root @param {string[]} [previousIds] */
export function validateBundle(root, previousIds = []) {
  const manifest = JSON.parse(
    readRepositoryFile(root, 'content/curriculum-manifest.json')
  );
  const files = readBundleFiles(root);
  validateManifest(manifest, files);
  const knownSources = readKnownSources(root);
  const registry = JSON.parse(files.get(manifest.id_registry_file));
  const records = parseCsv(files.get(manifest.coverage_file));
  const catalog = validateCatalog(records, knownSources, new Set(registry.ids));
  validateIdRegistry(registry, catalog, previousIds);
  validatePublicationStatus(manifest, catalog);
  const graph = JSON.parse(files.get(manifest.prerequisites_file));
  const edges = validateGraph(graph, catalog);
  return { manifest, records, catalog, registry, graph, edges };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const root = process.cwd();
  requireCondition(
    process.argv.length === 2,
    'CLI file paths are not accepted.'
  );
  const previousRegistryPath = resolve(root, priorRegistryFile);
  const hasPreviousRegistry = existsSync(previousRegistryPath);
  const previousIds = hasPreviousRegistry
    ? validateIdRegistryShape(
        JSON.parse(readRepositoryFile(root, priorRegistryFile))
      )
    : [];
  const { records, edges, manifest } = validateBundle(root, previousIds);
  log(
    `PASS: ${records.length - 1} curriculum records; ${edges} edges; ${manifest.publication_status} bundle ${manifest.curriculum_version}.`
  );
  if (hasPreviousRegistry) {
    log(`Compared ${previousIds.length} IDs with the prior registry snapshot.`);
  } else {
    log(
      'No previous registry snapshot found; this bundle starts the registry history.'
    );
  }
}

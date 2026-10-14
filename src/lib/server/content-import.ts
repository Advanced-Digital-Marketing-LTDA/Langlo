import type { Client, Transaction } from '@libsql/client';
import { beginWrite } from './flashcards';

// Checked grammar-content import (T012). Writes only the shared, unowned
// content tables of the current migration: skills, prerequisites,
// content_versions and questions. It never touches cards, review history or
// any learner table. A package is validated whole and imported in one
// transaction: any failure writes nothing.
//
// Versions are immutable once stored. Re-importing the same package is a
// no-op; a changed revision needs a new version and new question IDs.
// Prerequisite edges are recommended teaching order, never mastery gates, and
// are only ever added. Quarantine is one-way.

const languages = ['fr', 'de', 'en'] as const;
const levels = ['A1', 'A2'] as const;
const formats = [
  'multiple-choice',
  'typed-blank',
  'translation',
  'correction'
] as const;

type Language = (typeof languages)[number];
type Level = (typeof levels)[number];
type Format = (typeof formats)[number];

export type ContentQuestion = {
  id: string;
  format: Format;
  prompt: string;
  answer: string;
  alternatives?: string[] | undefined;
};

export type ContentPackage = {
  curriculumVersion: string;
  publicationStatus: string;
  dependencySemantics: string;
  skills: {
    id: string;
    language: Language;
    level: Level;
    review: string;
    prerequisites: string[];
  }[];
  versions: {
    id: string;
    skillId: string;
    version: number;
    review: string;
    questions: ContentQuestion[];
  }[];
};

export type ImportResult = {
  skills: number;
  prerequisites: number;
  versions: number;
  questions: number;
  quarantined: number;
};

export class ContentImportError extends Error {
  constructor(
    readonly code: string,
    readonly detail = ''
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

type SkillInfo = { language: string; level: string };
type Edge = { skillId: string; prerequisiteId: string };

function fail(code: string, detail = ''): never {
  throw new ContentImportError(code, detail);
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalized = (value: string) => value.trim().toLowerCase();

function validatePackageHeader(pkg: ContentPackage) {
  if (pkg?.publicationStatus !== 'approved') fail('NOT_APPROVED');
  if (pkg.dependencySemantics !== 'recommended_teaching_order')
    fail('INVALID_PACKAGE', 'dependency semantics');
  if (!isText(pkg.curriculumVersion))
    fail('INVALID_PACKAGE', 'curriculum version');
  if (!Array.isArray(pkg.skills) || !Array.isArray(pkg.versions))
    fail('INVALID_PACKAGE', 'skills and versions');
}

function validateSkills(pkg: ContentPackage) {
  const ids = new Set<string>();
  for (const skill of pkg.skills) {
    if (
      !isText(skill?.id) ||
      ids.has(skill.id) ||
      !languages.includes(skill.language) ||
      !levels.includes(skill.level) ||
      !Array.isArray(skill.prerequisites) ||
      !skill.prerequisites.every(isText)
    )
      fail('INVALID_PACKAGE', `skill ${String(skill?.id)}`);
    ids.add(skill.id);
    if (skill.review !== 'approved') fail('UNREVIEWED', skill.id);
  }
}

function validateAlternatives(question: ContentQuestion) {
  const { alternatives } = question;
  if (alternatives === undefined) {
    if (question.format === 'multiple-choice')
      fail('INVALID_ALTERNATIVES', question.id);
    return;
  }
  if (!Array.isArray(alternatives) || !alternatives.every(isText))
    fail('INVALID_ALTERNATIVES', question.id);
  const unique = new Set(alternatives.map(normalized));
  const answer = normalized(question.answer);
  const valid =
    unique.size === alternatives.length &&
    (question.format === 'multiple-choice'
      ? alternatives.length >= 2 && unique.has(answer)
      : !unique.has(answer));
  if (!valid) fail('INVALID_ALTERNATIVES', question.id);
}

function validateVersions(pkg: ContentPackage) {
  const versionIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const version of pkg.versions) {
    if (
      !isText(version?.id) ||
      versionIds.has(version.id) ||
      !isText(version.skillId) ||
      !Number.isSafeInteger(version.version) ||
      version.version < 1 ||
      !Array.isArray(version.questions) ||
      version.questions.length === 0
    )
      fail('INVALID_PACKAGE', `version ${String(version?.id)}`);
    versionIds.add(version.id);
    if (version.review !== 'approved' && version.review !== 'quarantined')
      fail('UNREVIEWED', version.id);
    for (const question of version.questions) {
      if (
        !isText(question?.id) ||
        questionIds.has(question.id) ||
        !formats.includes(question.format) ||
        !isText(question.prompt) ||
        !isText(question.answer)
      )
        fail('INVALID_PACKAGE', `question ${String(question?.id)}`);
      questionIds.add(question.id);
      validateAlternatives(question);
    }
  }
}

async function storedSkills(tx: Transaction) {
  const rows = await tx.execute('SELECT id, language, level FROM skills');
  return new Map<string, SkillInfo>(
    rows.rows.map((row) => [
      String(row.id),
      { language: String(row.language), level: String(row.level) }
    ])
  );
}

async function storedEdges(tx: Transaction): Promise<Edge[]> {
  const rows = await tx.execute(
    'SELECT skill_id, prerequisite_id FROM prerequisites'
  );
  return rows.rows.map((row) => ({
    skillId: String(row.skill_id),
    prerequisiteId: String(row.prerequisite_id)
  }));
}

function mergeSkills(pkg: ContentPackage, stored: Map<string, SkillInfo>) {
  const known = new Map(stored);
  for (const skill of pkg.skills) {
    const existing = stored.get(skill.id);
    if (
      existing &&
      (existing.language !== skill.language || existing.level !== skill.level)
    )
      fail('CONTENT_CONFLICT', `skill ${skill.id}`);
    known.set(skill.id, { language: skill.language, level: skill.level });
  }
  return known;
}

function checkEdge(edge: Edge, known: Map<string, SkillInfo>) {
  const skill = known.get(edge.skillId);
  const prerequisite = known.get(edge.prerequisiteId);
  if (!skill || !prerequisite)
    fail('MISSING_REFERENCE', `${edge.skillId} -> ${edge.prerequisiteId}`);
  if (edge.skillId === edge.prerequisiteId)
    fail('PREREQUISITE_CYCLE', edge.skillId);
  if (
    skill.language !== prerequisite.language ||
    levels.indexOf(prerequisite.level as Level) >
      levels.indexOf(skill.level as Level)
  )
    fail('INVALID_PREREQUISITE', `${edge.skillId} -> ${edge.prerequisiteId}`);
}

function findCycle(edges: Edge[]) {
  const next = new Map<string, string[]>();
  for (const { skillId, prerequisiteId } of edges)
    next.set(skillId, [...(next.get(skillId) ?? []), prerequisiteId]);
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (node: string): string | undefined => {
    if (onPath.has(node)) return node;
    if (done.has(node)) return undefined;
    onPath.add(node);
    for (const target of next.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    onPath.delete(node);
    done.add(node);
    return undefined;
  };
  for (const node of next.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}

function validateGraph(
  pkg: ContentPackage,
  known: Map<string, SkillInfo>,
  stored: Edge[]
) {
  const edges = pkg.skills.flatMap((skill) =>
    skill.prerequisites.map((prerequisiteId) => ({
      skillId: skill.id,
      prerequisiteId
    }))
  );
  for (const edge of edges) checkEdge(edge, known);
  const cycle = findCycle([...stored, ...edges]);
  if (cycle) fail('PREREQUISITE_CYCLE', cycle);
  return edges;
}

async function insertSkills(
  tx: Transaction,
  pkg: ContentPackage,
  stored: Map<string, SkillInfo>
) {
  let count = 0;
  for (const skill of pkg.skills) {
    if (stored.has(skill.id)) continue;
    await tx.execute({
      sql: 'INSERT INTO skills (id, language, level) VALUES (?, ?, ?)',
      args: [skill.id, skill.language, skill.level]
    });
    count += 1;
  }
  return count;
}

async function insertEdges(
  tx: Transaction,
  edges: Edge[],
  known: Map<string, SkillInfo>
) {
  let count = 0;
  for (const edge of edges) {
    const result = await tx.execute({
      sql: 'INSERT OR IGNORE INTO prerequisites (skill_id, prerequisite_id, language) VALUES (?, ?, ?)',
      args: [
        edge.skillId,
        edge.prerequisiteId,
        known.get(edge.skillId)?.language ?? ''
      ]
    });
    count += result.rowsAffected;
  }
  return count;
}

type PackageVersion = ContentPackage['versions'][number];

async function storedVersion(tx: Transaction, version: PackageVersion) {
  const rows = await tx.execute({
    sql: 'SELECT id, skill_id, version, status FROM content_versions WHERE id = ? OR (skill_id = ? AND version = ?)',
    args: [version.id, version.skillId, version.version]
  });
  if (rows.rows.length === 0) return undefined;
  const row = rows.rows[0];
  if (
    rows.rows.length > 1 ||
    String(row.id) !== version.id ||
    String(row.skill_id) !== version.skillId ||
    Number(row.version) !== version.version
  )
    fail('CONTENT_CONFLICT', `version ${version.id}`);
  return String(row.status);
}

async function sameQuestions(tx: Transaction, version: PackageVersion) {
  const rows = await tx.execute({
    sql: 'SELECT id, format FROM questions WHERE content_version_id = ? ORDER BY id',
    args: [version.id]
  });
  const stored = rows.rows.map(
    (row) => `${String(row.id)}\u0000${String(row.format)}`
  );
  const incoming = version.questions
    .map((question) => `${question.id}\u0000${question.format}`)
    .sort((a, b) => a.localeCompare(b));
  return JSON.stringify(stored) === JSON.stringify(incoming);
}

async function insertVersion(
  tx: Transaction,
  version: PackageVersion,
  language: string
) {
  const taken = await tx.execute({
    sql: `SELECT id FROM questions WHERE id IN (${version.questions.map(() => '?').join(', ')})`,
    args: version.questions.map((question) => question.id)
  });
  if (taken.rows.length > 0)
    fail('CONTENT_CONFLICT', `question ${String(taken.rows[0].id)}`);
  await tx.execute({
    sql: 'INSERT INTO content_versions (id, skill_id, language, version, status) VALUES (?, ?, ?, ?, ?)',
    args: [
      version.id,
      version.skillId,
      language,
      version.version,
      version.review === 'quarantined' ? 'quarantined' : 'schema-validated'
    ]
  });
  for (const question of version.questions)
    await tx.execute({
      sql: 'INSERT INTO questions (id, content_version_id, skill_id, language, format) VALUES (?, ?, ?, ?, ?)',
      args: [
        question.id,
        version.id,
        version.skillId,
        language,
        question.format
      ]
    });
}

async function importVersions(
  tx: Transaction,
  pkg: ContentPackage,
  known: Map<string, SkillInfo>,
  result: ImportResult
) {
  for (const version of pkg.versions) {
    const skill = known.get(version.skillId);
    if (!skill) fail('MISSING_REFERENCE', `version ${version.id}`);
    const status = await storedVersion(tx, version);
    if (status === undefined) {
      await insertVersion(tx, version, skill.language);
      result.versions += 1;
      result.questions += version.questions.length;
      if (version.review === 'quarantined') result.quarantined += 1;
      continue;
    }
    if (!(await sameQuestions(tx, version)))
      fail('CONTENT_CONFLICT', `version ${version.id}`);
    if (version.review === 'quarantined' && status !== 'quarantined') {
      await tx.execute({
        sql: "UPDATE content_versions SET status = 'quarantined' WHERE id = ?",
        args: [version.id]
      });
      result.quarantined += 1;
    }
  }
}

/** Validate and import an approved content package into the shared content tables. */
export async function importContent(
  client: Client,
  pkg: ContentPackage
): Promise<ImportResult> {
  validatePackageHeader(pkg);
  validateSkills(pkg);
  validateVersions(pkg);
  const tx = await beginWrite(client);
  try {
    const stored = await storedSkills(tx);
    const known = mergeSkills(pkg, stored);
    const edges = validateGraph(pkg, known, await storedEdges(tx));
    const result: ImportResult = {
      skills: await insertSkills(tx, pkg, stored),
      prerequisites: await insertEdges(tx, edges, known),
      versions: 0,
      questions: 0,
      quarantined: 0
    };
    await importVersions(tx, pkg, known, result);
    await tx.commit();
    return result;
  } catch (error) {
    // A failed rollback must not replace the error that caused it.
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

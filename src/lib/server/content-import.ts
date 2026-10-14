import type { Client, Transaction } from '@libsql/client';
import { z } from 'zod';
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
// The contract's five tracks; French A2 is out of scope.
const tracks = new Set(['fr A1', 'de A1', 'de A2', 'en A1', 'en A2']);
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

type PackageVersion = ContentPackage['versions'][number];

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
    readonly detail: string
  ) {
    super(`${code}: ${detail}`);
  }
}

type SkillInfo = { language: string; level: string };
type Edge = { skillId: string; prerequisiteId: string };
type NewEdge = Edge & { language: string };

function fail(code: string, detail: string): never {
  throw new ContentImportError(code, detail);
}

const normalized = (value: string) => value.trim().toLowerCase();

const stableVersion = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/u
  );

function validatePackageHeader(pkg: ContentPackage) {
  if (pkg?.publicationStatus !== 'approved')
    fail('NOT_APPROVED', 'publication status');
  // The contract requires a stable semantic version for an approved bundle.
  if (!stableVersion.safeParse(pkg.curriculumVersion).success)
    fail('NOT_APPROVED', 'curriculum version');
}

// Structure only. Reviews and alternatives are checked afterwards so that they
// keep their own error codes.
const text = z.string().regex(/\S/u);

const skillShape = z
  .object({
    id: text,
    language: z.enum(languages),
    level: z.enum(levels),
    review: z.unknown().optional(),
    prerequisites: z
      .array(text)
      .refine((ids) => new Set(ids).size === ids.length, 'duplicate')
  })
  .refine((skill) => tracks.has(`${skill.language} ${skill.level}`), 'track');

const questionShape = z.object({
  id: text,
  format: z.enum(formats),
  prompt: text,
  answer: text,
  alternatives: z.unknown().optional()
});

const packageShape = z.object({
  dependencySemantics: z.literal('recommended_teaching_order'),
  skills: z.array(skillShape),
  versions: z.array(
    z.object({
      id: text,
      skillId: text,
      version: z.int().min(1),
      review: z.unknown().optional(),
      questions: z.array(questionShape).min(1)
    })
  )
});

const hasDuplicates = (ids: string[]) => new Set(ids).size !== ids.length;

function validateShape(pkg: ContentPackage) {
  const parsed = packageShape.safeParse(pkg);
  if (!parsed.success) fail('INVALID_PACKAGE', z.prettifyError(parsed.error));
  const ids = [
    pkg.skills.map((skill) => skill.id),
    pkg.versions.map((version) => version.id),
    pkg.versions.flatMap((version) => version.questions.map((q) => q.id))
  ];
  if (ids.some((list) => hasDuplicates(list)))
    fail('INVALID_PACKAGE', 'duplicate id');
}

function validateReviews(pkg: ContentPackage) {
  const skill = pkg.skills.find((item) => item.review !== 'approved');
  if (skill) fail('UNREVIEWED', skill.id);
  const version = pkg.versions.find(
    (item) => item.review !== 'approved' && item.review !== 'quarantined'
  );
  if (version) fail('UNREVIEWED', version.id);
}

function validateAlternatives(question: ContentQuestion) {
  const { alternatives } = question;
  if (alternatives === undefined) {
    if (question.format === 'multiple-choice')
      fail('INVALID_ALTERNATIVES', question.id);
    return;
  }
  if (!z.array(text).safeParse(alternatives).success)
    fail('INVALID_ALTERNATIVES', question.id);
  const unique = new Set(alternatives.map((item) => normalized(item)));
  const answer = normalized(question.answer);
  const valid =
    unique.size === alternatives.length &&
    (question.format === 'multiple-choice'
      ? alternatives.length >= 2 && unique.has(answer)
      : !unique.has(answer));
  if (!valid) fail('INVALID_ALTERNATIVES', question.id);
}

function validatePackage(pkg: ContentPackage) {
  validatePackageHeader(pkg);
  validateShape(pkg);
  validateReviews(pkg);
  for (const version of pkg.versions)
    for (const question of version.questions) validateAlternatives(question);
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
    const info = { language: skill.language, level: skill.level };
    if (existing && JSON.stringify(existing) !== JSON.stringify(info))
      fail('CONTENT_CONFLICT', `skill ${skill.id}`);
    known.set(skill.id, info);
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
      prerequisiteId,
      language: skill.language
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

async function insertEdges(tx: Transaction, edges: NewEdge[]) {
  let count = 0;
  for (const edge of edges) {
    const result = await tx.execute({
      sql: 'INSERT OR IGNORE INTO prerequisites (skill_id, prerequisite_id, language) VALUES (?, ?, ?)',
      args: [edge.skillId, edge.prerequisiteId, edge.language]
    });
    count += result.rowsAffected;
  }
  return count;
}

async function storedVersion(tx: Transaction, version: PackageVersion) {
  const rows = await tx.execute({
    sql: 'SELECT id, skill_id, version, status FROM content_versions WHERE id = ? OR (skill_id = ? AND version = ?)',
    args: [version.id, version.skillId, version.version]
  });
  if (rows.rows.length === 0) return undefined;
  const [row] = rows.rows;
  const found = [String(row.id), String(row.skill_id), Number(row.version)];
  const expected = [version.id, version.skillId, version.version];
  if (
    rows.rows.length > 1 ||
    JSON.stringify(found) !== JSON.stringify(expected)
  )
    fail('CONTENT_CONFLICT', `version ${version.id}`);
  return String(row.status);
}

// Both sides are keyed and sorted the same way in JS; SQL collation order is
// not relied on.
const questionKeys = (pairs: Array<[unknown, unknown]>) =>
  pairs
    .map(([id, format]) => `${String(id)}\u0000${String(format)}`)
    .sort((a, b) => Number(a > b) - Number(a < b));

async function sameQuestions(tx: Transaction, version: PackageVersion) {
  const rows = await tx.execute({
    sql: 'SELECT id, format FROM questions WHERE content_version_id = ?',
    args: [version.id]
  });
  const stored = questionKeys(rows.rows.map((row) => [row.id, row.format]));
  const incoming = questionKeys(
    version.questions.map((question) => [question.id, question.format])
  );
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
    if (!tracks.has(`${skill.language} ${skill.level}`))
      fail('INVALID_PACKAGE', `version ${version.id} track`);
    const status = await storedVersion(tx, version);
    if (status === undefined) {
      await insertVersion(tx, version, skill.language);
      result.versions += 1;
      result.questions += version.questions.length;
      result.quarantined += Number(version.review === 'quarantined');
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
  validatePackage(pkg);
  const tx = await beginWrite(client);
  try {
    const stored = await storedSkills(tx);
    const known = mergeSkills(pkg, stored);
    const edges = validateGraph(pkg, known, await storedEdges(tx));
    const result: ImportResult = {
      skills: await insertSkills(tx, pkg, stored),
      prerequisites: await insertEdges(tx, edges),
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

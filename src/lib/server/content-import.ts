import { normalizeAnswer } from '../components/exercises/answer';
import { createHash } from 'node:crypto';
import type { Client, Transaction } from '@libsql/client';
import { z } from 'zod';
import { beginWrite } from './flashcards';
import {
  applyRetirements,
  ChangeSet,
  checkBump,
  logVersion,
  planVersion,
  priorVersion,
  validateDeclarations,
  writeChanges,
  type BumpLevel,
  type VersionPlan
} from './content-update';

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
//
// Each curriculum version is recorded with a fingerprint of its package: a
// version names one package, and a new version must be newer than every
// version already imported.

const languages = ['fr', 'de', 'en', 'pt'] as const;
// Ordered: a prerequisite may not sit at a higher level than its skill.
const levels = ['A1', 'A2', 'B1', 'B2'] as const;
// The contract's tracks; French A2 is out of scope, and Portuguese starts at B1.
const tracks = new Set([
  'fr A1',
  'de A1',
  'de A2',
  'en A1',
  'en A2',
  'pt B1',
  'pt B2'
]);
export const formats = [
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
  alternatives?: string[];
  // Omitted legacy flags stay omitted in fingerprints; storage defaults to practice.
  holdout?: boolean;
  // Required on every question of a lesson version that follows an earlier
  // version of the same skill: `same` keeps the earlier question's meaning
  // (and names it in `continues`), `changed` and `new` start a fresh item.
  change?: QuestionChange;
  continues?: string;
};

export type QuestionChange = 'same' | 'changed' | 'new';

/** A skill taken out of the catalog; its history stays readable. */
export type SkillRetirement = {
  skillId: string;
  replacedBy?: string;
  // Owner-approved: answers to the retired skill count for its replacement
  // (a pure rename, same content under a new id).
  carry?: boolean;
};

export type ContentLesson = {
  title: string;
  explanation: string;
  // Each example maps a language code to a sentence; values are plain text.
  examples: Record<string, string>[];
  references: string[];
};

export type ContentPackage = {
  curriculumVersion: string;
  publicationStatus: string;
  dependencySemantics: string;
  // Identity of the source bundle, when there is one. It is part of the
  // version fingerprint, so a reissued bundle needs a new version even when
  // the imported rows are unchanged.
  bundleDigest?: string;
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
    // Optional so packages without lessons keep their fingerprints.
    lesson?: ContentLesson;
    // Explanations in other languages; only valid next to the English lesson.
    translations?: { pt?: ContentLesson };
  }[];
  retirements?: SkillRetirement[];
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
  alternatives: z.unknown().optional(),
  holdout: z.boolean().optional(),
  change: z.enum(['same', 'changed', 'new']).optional(),
  continues: text.optional()
});

// Example keys are language codes whose source order carries no meaning, so
// they are sorted before the lesson is hashed and stored.
const sortedKeys = (example: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(example).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );

const sortedExample = z.record(z.string(), text).transform(sortedKeys);

const lessonShape = z.object({
  title: text,
  explanation: text,
  examples: z.array(sortedExample),
  references: z.array(text)
});

const packageShape = z.object({
  dependencySemantics: z.literal('recommended_teaching_order'),
  bundleDigest: z.string().optional(),
  skills: z.array(skillShape),
  versions: z.array(
    z
      .object({
        id: text,
        skillId: text,
        version: z.int().min(1),
        review: z.unknown().optional(),
        questions: z.array(questionShape).min(1),
        lesson: lessonShape.optional(),
        translations: z
          .object({ pt: lessonShape.optional() })
          .strict()
          .optional()
      })
      .strict()
  ),
  retirements: z
    .array(
      z.object({
        skillId: text,
        replacedBy: text.optional(),
        carry: z.boolean().optional()
      })
    )
    .optional()
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
  return parsed.data;
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
      ? alternatives.length >= 2 &&
        alternatives.includes(question.answer) &&
        // The picked option is submitted in normalizeAnswer form and graded
        // exactly, so every option must already be in that form.
        alternatives.every((item) => item === normalizeAnswer(item))
      : !unique.has(answer));
  if (!valid) fail('INVALID_ALTERNATIVES', question.id);
}

// The parsed package has a fixed key order and no unknown keys, so equal
// packages hash equally whatever order their source listed keys in.
const fingerprint = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');

// Review status may change to quarantine; question payloads remain immutable.
const versionFingerprint = (version: PackageVersion) =>
  fingerprint(
    version.questions
      .map(
        ({
          id,
          format,
          prompt,
          answer,
          alternatives,
          holdout,
          change,
          continues
        }) => ({
          id,
          format,
          prompt,
          answer,
          alternatives,
          holdout,
          change,
          continues
        })
      )
      .sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id))
  );

export function validatePackage(pkg: ContentPackage) {
  validatePackageHeader(pkg);
  const data = validateShape(pkg);
  for (const version of data.versions) {
    const skill = data.skills.find((item) => item.id === version.skillId);
    if (
      version.translations?.pt !== undefined &&
      skill !== undefined &&
      skill.language !== 'en'
    )
      fail(
        'INVALID_PACKAGE',
        `translation requires an English lesson ${version.id}`
      );
  }
  validateReviews(pkg);
  validateDeclarations(pkg);
  for (const version of pkg.versions)
    for (const question of version.questions) validateAlternatives(question);
  return fingerprint(data);
}

// Precedence of stable versions; build metadata does not count. BigInt keeps
// components beyond the safe integer range exact.
const precedence = (version: string) =>
  version
    .split('+')[0]
    .split('.')
    .map((part) => BigInt(part));

const newer = (a: bigint[], b: bigint[]) =>
  (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0n;

/** Record a new curriculum version, or confirm a re-import of the same package. */
async function recordVersion(
  tx: Transaction,
  version: string,
  hash: string,
  needed: BumpLevel
) {
  const rows = await tx.execute(
    'SELECT curriculum_version, fingerprint FROM curriculum_imports'
  );
  const same = rows.rows.find((row) => row.curriculum_version === version);
  if (same) {
    if (same.fingerprint !== hash)
      fail('CONTENT_CONFLICT', `curriculum version ${version}`);
    return;
  }
  const incoming = precedence(version);
  if (
    rows.rows.some(
      (row) => !newer(incoming, precedence(String(row.curriculum_version)))
    )
  )
    fail('CONTENT_CONFLICT', `curriculum version ${version} is not newer`);
  checkBump(
    rows.rows.map((row) => String(row.curriculum_version)),
    version,
    needed
  );
  await tx.execute({
    sql: 'INSERT INTO curriculum_imports (curriculum_version, fingerprint) VALUES (?, ?)',
    args: [version, hash]
  });
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
    sql: 'SELECT id, skill_id, version, status, fingerprint FROM content_versions WHERE id = ? OR (skill_id = ? AND version = ?)',
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
  return row;
}

// Both sides are keyed and sorted the same way in JS; SQL collation order is
// not relied on.
const questionKeys = (pairs: Array<[unknown, unknown, unknown]>) =>
  pairs
    .map(
      ([id, format, holdout]) =>
        `${String(id)}\u0000${String(format)}\u0000${Number(holdout)}`
    )
    .sort((a, b) => Number(a > b) - Number(a < b));

async function sameQuestions(tx: Transaction, version: PackageVersion) {
  const rows = await tx.execute({
    sql: 'SELECT id, format, holdout FROM questions WHERE content_version_id = ?',
    args: [version.id]
  });
  const stored = questionKeys(
    rows.rows.map((row) => [row.id, row.format, row.holdout])
  );
  const incoming = questionKeys(
    version.questions.map((question) => [
      question.id,
      question.format,
      question.holdout ?? false
    ])
  );
  return JSON.stringify(stored) === JSON.stringify(incoming);
}

async function insertVersion(
  tx: Transaction,
  version: PackageVersion,
  language: string,
  plan: VersionPlan
) {
  const taken = await tx.execute({
    sql: `SELECT id FROM questions WHERE id IN (${version.questions.map(() => '?').join(', ')})`,
    args: version.questions.map((question) => question.id)
  });
  if (taken.rows.length > 0)
    fail('CONTENT_CONFLICT', `question ${String(taken.rows[0].id)}`);
  await tx.execute({
    sql: 'INSERT INTO content_versions (id, skill_id, language, version, status, fingerprint, retention_reset) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [
      version.id,
      version.skillId,
      language,
      version.version,
      version.review === 'quarantined' ? 'quarantined' : 'schema-validated',
      versionFingerprint(version),
      // Only a wording-only version leaves learners' grammar recall valid.
      Number(plan.level !== 'patch')
    ]
  });
  const lineage = new Map(
    plan.questions.map((item) => [item.id, item.lineageKey])
  );
  for (const question of version.questions)
    await tx.execute({
      sql: 'INSERT INTO questions (id, content_version_id, skill_id, language, format, holdout, prompt, answer, alternatives, lineage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        question.id,
        version.id,
        version.skillId,
        language,
        question.format,
        Number(question.holdout ?? false),
        ...payloadArgs(question),
        lineage.get(question.id) ?? null
      ]
    });
}

// Prompt, answer and alternatives as stored; alternatives are a JSON array.
const payloadArgs = (question: ContentQuestion) =>
  [
    question.prompt,
    question.answer,
    question.alternatives === undefined
      ? null
      : JSON.stringify(question.alternatives)
  ] as const;

// Only reached once the stored version fingerprint (which covers the payload)
// equals the incoming package's, so filling rows that predate 0009 cannot
// introduce unverified text. Rows that already hold a payload are untouched.
async function backfillPayloads(tx: Transaction, version: PackageVersion) {
  for (const question of version.questions)
    await tx.execute({
      sql: 'UPDATE questions SET prompt = ?, answer = ?, alternatives = ? WHERE id = ? AND prompt IS NULL AND answer IS NULL',
      args: [...payloadArgs(question), question.id]
    });
}

// The stored and hashed form of a lesson, with example keys in sorted order.
const canonicalLesson = (lesson: ContentLesson) => ({
  title: lesson.title,
  explanation: lesson.explanation,
  examples: lesson.examples.map(sortedKeys),
  references: lesson.references
});

// A lesson is immutable once stored: a different text under the same version
// is a conflict. A version imported before it had a lesson may gain one.
async function importLesson(
  tx: Transaction,
  version: PackageVersion,
  set: ChangeSet
) {
  if (version.lesson === undefined) {
    if (hasTranslations(version))
      fail('INVALID_PACKAGE', `translations without lesson ${version.id}`);
    return;
  }
  const lesson = canonicalLesson(version.lesson);
  const hash = fingerprint(lesson);
  const stored = await tx.execute({
    sql: 'SELECT fingerprint FROM lessons WHERE content_version_id = ?',
    args: [version.id]
  });
  if (stored.rows[0]) {
    if (stored.rows[0].fingerprint !== hash)
      fail('CONTENT_CONFLICT', `lesson ${version.id}`);
  } else
    await tx.execute({
      sql: 'INSERT INTO lessons (content_version_id, skill_id, language, title, explanation, examples, refs, fingerprint) SELECT id, skill_id, language, ?, ?, ?, ?, ? FROM content_versions WHERE id = ?',
      args: [
        lesson.title,
        lesson.explanation,
        JSON.stringify(lesson.examples),
        JSON.stringify(lesson.references),
        hash,
        version.id
      ]
    });
  await importTranslations(tx, version, set);
}

const hasTranslations = (version: PackageVersion) =>
  version.translations?.pt !== undefined;

// A translation is immutable like the lesson it explains: a different text
// under the same version and language is a conflict.
async function importTranslations(
  tx: Transaction,
  version: PackageVersion,
  set: ChangeSet
) {
  const pt = version.translations?.pt;
  if (pt === undefined) return;
  const lesson = canonicalLesson(pt);
  const hash = fingerprint(lesson);
  const stored = await tx.execute({
    sql: "SELECT fingerprint FROM lesson_translations WHERE content_version_id = ? AND explanation_language = 'pt'",
    args: [version.id]
  });
  if (stored.rows[0]) {
    if (stored.rows[0].fingerprint !== hash)
      fail('CONTENT_CONFLICT', `lesson translation pt ${version.id}`);
    return;
  }
  await tx.execute({
    sql: "INSERT INTO lesson_translations (content_version_id, explanation_language, title, explanation, examples, refs, fingerprint) VALUES (?, 'pt', ?, ?, ?, ?, ?)",
    args: [
      version.id,
      lesson.title,
      lesson.explanation,
      JSON.stringify(lesson.examples),
      JSON.stringify(lesson.references),
      hash
    ]
  });
  set.add(
    {
      kind: 'lesson-translation-added',
      skillId: version.skillId,
      contentVersionId: version.id
    },
    'minor'
  );
}

/** A version the database already holds: it must match, and may be quarantined. */
async function reimportVersion(
  tx: Transaction,
  version: ContentPackage['versions'][number],
  stored: NonNullable<Awaited<ReturnType<typeof storedVersion>>>,
  verifiedOriginal: boolean,
  result: ImportResult,
  set: ChangeSet
) {
  if (!(await sameQuestions(tx, version)))
    fail('CONTENT_CONFLICT', `version ${version.id}`);
  const hash = versionFingerprint(version);
  if (stored.fingerprint === null) {
    if (!verifiedOriginal)
      fail(
        'LEGACY_CONTENT_UNVERIFIED',
        `version ${version.id}: re-import the recorded original package or publish a new content version with new question IDs`
      );
    await tx.execute({
      sql: 'UPDATE content_versions SET fingerprint = ? WHERE id = ? AND fingerprint IS NULL',
      args: [hash, version.id]
    });
  } else if (stored.fingerprint !== hash)
    fail('CONTENT_CONFLICT', `version ${version.id}`);
  await backfillPayloads(tx, version);
  await importLesson(tx, version, set);
  if (version.review !== 'quarantined') return;
  const update = await tx.execute({
    sql: "UPDATE content_versions SET status = 'quarantined' WHERE id = ? AND status <> 'quarantined'",
    args: [version.id]
  });
  result.quarantined += update.rowsAffected;
  if (update.rowsAffected > 0)
    set.add(
      {
        kind: 'version-quarantined',
        skillId: version.skillId,
        contentVersionId: version.id
      },
      'patch'
    );
}

async function importVersions(
  tx: Transaction,
  pkg: ContentPackage,
  known: Map<string, SkillInfo>,
  result: ImportResult,
  packageHash: string,
  set: ChangeSet
) {
  // A version may only target a skill this package declares and reviews;
  // stored skills carry no review state.
  const declared = new Map(pkg.skills.map((skill) => [skill.id, skill]));
  const recorded = await tx.execute({
    sql: 'SELECT fingerprint FROM curriculum_imports WHERE curriculum_version = ?',
    args: [pkg.curriculumVersion]
  });
  const verifiedOriginal = recorded.rows[0]?.fingerprint === packageHash;
  // Oldest first, so a version's earlier sibling in this package is stored
  // before the version that continues it.
  const ordered = [...pkg.versions].sort(
    (a, b) =>
      Number(a.skillId > b.skillId) - Number(a.skillId < b.skillId) ||
      a.version - b.version
  );
  for (const version of ordered) {
    const skill = declared.get(version.skillId);
    if (!skill)
      fail(
        known.has(version.skillId) ? 'UNREVIEWED' : 'MISSING_REFERENCE',
        `version ${version.id}`
      );
    const stored = await storedVersion(tx, version);
    if (stored === undefined) {
      const plan = planVersion(version, await priorVersion(tx, version));
      await insertVersion(tx, version, skill.language, plan);
      logVersion(set, version, plan);
      await importLesson(tx, version, set);
      result.versions += 1;
      result.questions += version.questions.length;
      result.quarantined += Number(version.review === 'quarantined');
      continue;
    }
    await reimportVersion(tx, version, stored, verifiedOriginal, result, set);
  }
}

function snapshot(pkg: ContentPackage): ContentPackage {
  try {
    return structuredClone(pkg);
  } catch {
    return fail('INVALID_PACKAGE', 'package is not plain data');
  }
}

/** Validate and import an approved content package into the shared content tables. */
export async function importContent(
  client: Client,
  input: ContentPackage
): Promise<ImportResult> {
  // A private copy, so that the caller changing the package while the import
  // awaits cannot alter what was validated and fingerprinted.
  const pkg = snapshot(input);
  const hash = validatePackage(pkg);
  const tx = await beginWrite(client);
  try {
    const stored = await storedSkills(tx);
    const known = mergeSkills(pkg, stored);
    const edges = validateGraph(pkg, known, await storedEdges(tx));
    const set = new ChangeSet();
    const result: ImportResult = {
      skills: await insertSkills(tx, pkg, stored),
      prerequisites: await insertEdges(tx, edges),
      versions: 0,
      questions: 0,
      quarantined: 0
    };
    for (const skill of pkg.skills)
      if (!stored.has(skill.id))
        set.add({ kind: 'skill-added', skillId: skill.id }, 'minor');
    if (result.prerequisites > 0) set.raise('minor');
    await importVersions(tx, pkg, known, result, hash, set);
    await applyRetirements(tx, pkg, known, set);
    // Last, so that a content error keeps its own code.
    await recordVersion(tx, pkg.curriculumVersion, hash, set.level);
    await writeChanges(tx, pkg.curriculumVersion, set);
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

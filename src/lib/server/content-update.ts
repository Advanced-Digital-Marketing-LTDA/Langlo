import { randomUUID } from 'node:crypto';
import type { Client, Transaction } from '@libsql/client';
import {
  ContentImportError,
  type ContentPackage,
  type QuestionChange,
  type SkillRetirement
} from './content-import';
import { effectiveLineageKey } from './lineage';

// Rules for updating content that is already imported (LANGLO-167). A lesson
// edit is a new version of the skill with new question ids; each of its
// questions declares whether it keeps the earlier question's meaning. The
// declarations decide the lineage key mastery follows, the change log, and
// how large a curriculum version bump the update needs. Nothing a learner
// answered is ever rewritten.

type Executor = Pick<Client, 'execute'>;
type PackageVersion = ContentPackage['versions'][number];

function fail(code: string, detail: string): never {
  throw new ContentImportError(code, detail);
}

export type BumpLevel = 'none' | 'patch' | 'minor' | 'major';
const order: BumpLevel[] = ['none', 'patch', 'minor', 'major'];

export type ChangeKind =
  | 'skill-added'
  | 'skill-retired'
  | 'version-added'
  | 'question-same'
  | 'question-changed'
  | 'question-new'
  | 'question-removed'
  | 'version-quarantined';

export type ChangeRow = {
  kind: ChangeKind;
  skillId: string;
  contentVersionId?: string;
  questionId?: string;
  previousQuestionId?: string;
};

/** What one import changed, and the smallest curriculum bump that covers it. */
export class ChangeSet {
  readonly rows: ChangeRow[] = [];
  level: BumpLevel = 'none';

  raise(level: BumpLevel) {
    if (order.indexOf(level) > order.indexOf(this.level)) this.level = level;
  }

  add(row: ChangeRow, level: BumpLevel) {
    this.rows.push(row);
    this.raise(level);
  }
}

export type PriorQuestion = {
  id: string;
  lineageKey: string | null;
  contentVersionId: string;
};

export type PlannedQuestion = {
  id: string;
  lineageKey: string | null;
  change: QuestionChange | null;
  previousId: string | null;
};

export type VersionPlan = {
  questions: PlannedQuestion[];
  removed: PriorQuestion[];
  level: BumpLevel;
};

function checkQuestionDeclarations(pkg: ContentPackage) {
  for (const version of pkg.versions)
    for (const question of version.questions) {
      if (question.change === 'same' && question.continues === undefined)
        fail('INVALID_CHANGE', `${question.id} is same but continues nothing`);
      if (question.change !== 'same' && question.continues !== undefined)
        fail('INVALID_CHANGE', `${question.id} continues without being same`);
    }
}

function checkRetirementEntry(
  retirement: SkillRetirement,
  retired: Set<string>
) {
  if (retired.has(retirement.skillId))
    fail('INVALID_RETIREMENT', `${retirement.skillId} listed twice`);
  retired.add(retirement.skillId);
  if (retirement.carry === true && retirement.replacedBy === undefined)
    fail('INVALID_RETIREMENT', `${retirement.skillId} carries no skill over`);
  if (retirement.replacedBy === retirement.skillId)
    fail('INVALID_RETIREMENT', `${retirement.skillId} replaces itself`);
}

function checkRetiredAbsent(pkg: ContentPackage, retired: Set<string>) {
  const skill = pkg.skills.find((entry) => retired.has(entry.id));
  const version = pkg.versions.find((entry) => retired.has(entry.skillId));
  const clash = skill?.id ?? version?.skillId;
  if (clash !== undefined)
    fail('INVALID_RETIREMENT', `${clash} is retired and still in the package`);
}

/** Carried progress must land on a live skill, or carries could loop. */
function checkCarryTargets(pkg: ContentPackage, retired: Set<string>) {
  for (const retirement of pkg.retirements ?? [])
    if (
      retirement.carry === true &&
      retirement.replacedBy !== undefined &&
      retired.has(retirement.replacedBy)
    )
      fail(
        'INVALID_RETIREMENT',
        `${retirement.replacedBy} is retired and cannot receive carried progress`
      );
}

/** Package-only checks of the declarations and retirements. */
export function validateDeclarations(pkg: ContentPackage) {
  checkQuestionDeclarations(pkg);
  const retired = new Set<string>();
  for (const retirement of pkg.retirements ?? [])
    checkRetirementEntry(retirement, retired);
  checkRetiredAbsent(pkg, retired);
  checkCarryTargets(pkg, retired);
}

/** Decide lineage keys, removals and the bump level for one new version. */
export function planVersion(
  version: PackageVersion,
  prior: { questions: PriorQuestion[] } | undefined
): VersionPlan {
  if (prior === undefined) {
    const declared = version.questions.find(
      (question) =>
        question.change !== undefined || question.continues !== undefined
    );
    if (declared)
      fail('INVALID_CHANGE', `${declared.id} follows no earlier version`);
    return {
      questions: version.questions.map((question) => ({
        id: question.id,
        lineageKey: null,
        change: null,
        previousId: null
      })),
      removed: [],
      level: 'minor'
    };
  }
  const earlier = new Map(
    prior.questions.map((question) => [question.id, question])
  );
  const continued = new Set<string>();
  const questions = version.questions.map((question): PlannedQuestion => {
    if (question.change === undefined)
      return fail('MISSING_CHANGE', `${question.id} declares no change`);
    if (question.change !== 'same')
      return {
        id: question.id,
        lineageKey: question.id,
        change: question.change,
        previousId: null
      };
    const previous = earlier.get(question.continues ?? '');
    if (previous === undefined)
      return fail(
        'INVALID_CONTINUES',
        `${question.id} continues ${question.continues} outside the earlier version`
      );
    if (continued.has(previous.id))
      return fail('INVALID_CONTINUES', `${previous.id} is continued twice`);
    continued.add(previous.id);
    return {
      id: question.id,
      lineageKey: effectiveLineageKey({
        lineageKey: previous.lineageKey,
        contentVersionId: previous.contentVersionId,
        questionId: previous.id
      }),
      change: 'same',
      previousId: previous.id
    };
  });
  const removed = prior.questions.filter(
    (question) => !continued.has(question.id)
  );
  const onlyWording =
    removed.length === 0 && questions.every((q) => q.change === 'same');
  return { questions, removed, level: onlyWording ? 'patch' : 'minor' };
}

/** The newest earlier version of the skill that has questions, with them. */
export async function priorVersion(db: Executor, version: PackageVersion) {
  const found = await db.execute({
    sql: 'SELECT v.id FROM content_versions v WHERE v.skill_id = ? AND v.version < ? AND EXISTS (SELECT 1 FROM questions q WHERE q.content_version_id = v.id) ORDER BY v.version DESC LIMIT 1',
    args: [version.skillId, version.version]
  });
  if (found.rows.length === 0) return undefined;
  const id = String(found.rows[0].id);
  const rows = await db.execute({
    sql: 'SELECT id, lineage_key FROM questions WHERE content_version_id = ? ORDER BY id',
    args: [id]
  });
  return {
    id,
    questions: rows.rows.map((row): PriorQuestion => ({
      id: String(row.id),
      lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
      contentVersionId: id
    }))
  };
}

/** Record what a planned version changed. */
export function logVersion(
  set: ChangeSet,
  version: PackageVersion,
  plan: VersionPlan
) {
  set.add(
    {
      kind: 'version-added',
      skillId: version.skillId,
      contentVersionId: version.id
    },
    plan.level
  );
  for (const question of plan.questions)
    if (question.change !== null)
      set.add(
        {
          kind: `question-${question.change}`,
          skillId: version.skillId,
          contentVersionId: version.id,
          questionId: question.id,
          ...(question.previousId === null
            ? {}
            : { previousQuestionId: question.previousId })
        },
        plan.level
      );
  for (const question of plan.removed)
    set.add(
      {
        kind: 'question-removed',
        skillId: version.skillId,
        contentVersionId: version.id,
        previousQuestionId: question.id
      },
      plan.level
    );
}

const parts = (version: string) =>
  version
    .split('+')[0]
    .split('.')
    .map((part) => BigInt(part));

/** The component of the version that rose from `previous` to `next`. */
export function bumpLevel(previous: string, next: string): BumpLevel {
  const [a, b] = [parts(previous), parts(next)];
  if (b[0] > a[0]) return 'major';
  return b[1] > a[1] ? 'minor' : 'patch';
}

/**
 * The declared curriculum version must be the bump the changes need. Nothing
 * to compare against on the first import, and a package whose rows do not
 * change (a reissued bundle) may take any newer version.
 */
export function checkBump(
  stored: string[],
  incoming: string,
  needed: BumpLevel
) {
  if (stored.length === 0 || needed === 'none') return;
  const newest = stored.reduce((best, version) => {
    const [a, b] = [parts(best), parts(version)];
    return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0n ? version : best;
  }, stored[0]);
  const declared = bumpLevel(newest, incoming);
  if (declared !== needed)
    fail(
      'VERSION_BUMP',
      `curriculum version ${incoming} is a ${declared} bump over ${newest}, but the changes need a ${needed} bump`
    );
}

/** The retired skill and its replacement must exist and share a language. */
function checkRetirementTarget(
  retirement: SkillRetirement,
  known: Map<string, { language: string }>,
  stored: { rows: unknown[] }
) {
  const skill = known.get(retirement.skillId);
  if (skill === undefined || stored.rows.length === 0)
    fail('MISSING_REFERENCE', `retired skill ${retirement.skillId}`);
  if (retirement.replacedBy === undefined) return;
  const replacement = known.get(retirement.replacedBy);
  if (replacement === undefined)
    fail('MISSING_REFERENCE', `replacement ${retirement.replacedBy}`);
  if (replacement.language !== skill.language)
    fail('INVALID_RETIREMENT', `${retirement.skillId} changes language`);
}

/** A stored replacement that is already retired cannot receive carried progress. */
async function checkCarryTargetLive(
  tx: Transaction,
  retirement: SkillRetirement
) {
  if (retirement.carry !== true || retirement.replacedBy === undefined) return;
  const target = await tx.execute({
    sql: 'SELECT retired_at FROM skills WHERE id = ?',
    args: [retirement.replacedBy]
  });
  if (target.rows[0]?.retired_at != null)
    fail(
      'INVALID_RETIREMENT',
      `${retirement.replacedBy} is retired and cannot receive carried progress`
    );
}

/** Apply the package's retirements; returns how many skills were newly retired. */
export async function applyRetirements(
  tx: Transaction,
  pkg: ContentPackage,
  known: Map<string, { language: string }>,
  set: ChangeSet
) {
  for (const retirement of pkg.retirements ?? []) {
    const stored = await tx.execute({
      sql: 'SELECT retired_at, replaced_by, carry_progress FROM skills WHERE id = ?',
      args: [retirement.skillId]
    });
    checkRetirementTarget(retirement, known, stored);
    await checkCarryTargetLive(tx, retirement);
    const [row] = stored.rows;
    const replacedBy = retirement.replacedBy ?? null;
    const carry = retirement.carry === true ? 1 : null;
    if (row.retired_at !== null) {
      if (row.replaced_by !== replacedBy || row.carry_progress !== carry)
        fail('CONTENT_CONFLICT', `skill ${retirement.skillId} retirement`);
      continue;
    }
    await tx.execute({
      sql: 'UPDATE skills SET retired_at = unixepoch() * 1000, replaced_by = ?, carry_progress = ? WHERE id = ? AND retired_at IS NULL',
      args: [replacedBy, carry, retirement.skillId]
    });
    set.add({ kind: 'skill-retired', skillId: retirement.skillId }, 'major');
  }
}

export async function writeChanges(
  tx: Transaction,
  curriculumVersion: string,
  set: ChangeSet
) {
  for (const row of set.rows)
    await tx.execute({
      sql: 'INSERT INTO content_changes (id, curriculum_version, kind, skill_id, content_version_id, question_id, previous_question_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [
        randomUUID(),
        curriculumVersion,
        row.kind,
        row.skillId,
        row.contentVersionId ?? null,
        row.questionId ?? null,
        row.previousQuestionId ?? null
      ]
    });
}

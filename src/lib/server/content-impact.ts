import type { Client } from '@libsql/client';
import { type ContentPackage } from './content-import';
import { planVersion, priorVersion } from './content-update';
import { effectiveLineageKey } from './lineage';

// Read-only report of what a package would do to learner progress, printed
// before an owner applies it. It counts the answers that would stop counting
// toward mastery; it does not recompute anyone's status.

export type ImpactLine = {
  skillId: string;
  reason: string;
  answers: number;
  learners: number;
};

async function independentAnswers(client: Client, ids: string[]) {
  if (ids.length === 0) return { answers: 0, learners: 0 };
  const row = (
    await client.execute({
      sql: `SELECT COUNT(*) AS answers, COUNT(DISTINCT owner_id) AS learners FROM attempts WHERE evidence_kind = 'independent' AND question_id IN (${ids.map(() => '?').join(', ')})`,
      args: ids
    })
  ).rows[0];
  return { answers: Number(row.answers), learners: Number(row.learners) };
}

/** Every question of the skill, any version, whose lineage key is in `keys`. */
async function questionsWithKeys(
  client: Client,
  skillId: string,
  keys: Set<string>
) {
  const rows = await client.execute({
    sql: 'SELECT id, content_version_id, lineage_key FROM questions WHERE skill_id = ?',
    args: [skillId]
  });
  return rows.rows
    .filter((row) =>
      keys.has(
        effectiveLineageKey({
          lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
          contentVersionId: String(row.content_version_id),
          questionId: String(row.id)
        })
      )
    )
    .map((row) => String(row.id));
}

/** The impact of one version the database does not hold yet, if it drops questions. */
async function versionImpact(
  client: Client,
  version: ContentPackage['versions'][number]
): Promise<ImpactLine | undefined> {
  const stored = await client.execute({
    sql: 'SELECT 1 FROM content_versions WHERE id = ?',
    args: [version.id]
  });
  if (stored.rows.length > 0) return undefined;
  const prior = await priorVersion(client, version);
  if (prior === undefined) return undefined;
  const plan = planVersion(version, prior);
  const keys = new Set(
    plan.removed.map((question) =>
      effectiveLineageKey({
        lineageKey: question.lineageKey,
        contentVersionId: question.contentVersionId,
        questionId: question.id
      })
    )
  );
  if (keys.size === 0) return undefined;
  const ids = await questionsWithKeys(client, version.skillId, keys);
  return {
    skillId: version.skillId,
    reason: `${keys.size} question(s) changed or removed in ${version.id}`,
    ...(await independentAnswers(client, ids))
  };
}

/** The impact of retiring one skill that is still live, if any. */
async function retirementImpact(
  client: Client,
  retirement: NonNullable<ContentPackage['retirements']>[number]
): Promise<ImpactLine | undefined> {
  const skill = await client.execute({
    sql: 'SELECT retired_at FROM skills WHERE id = ?',
    args: [retirement.skillId]
  });
  if (skill.rows.length === 0 || skill.rows[0].retired_at !== null)
    return undefined;
  const carried = retirement.carry === true;
  const ids = carried
    ? []
    : (
        await client.execute({
          sql: 'SELECT id FROM questions WHERE skill_id = ?',
          args: [retirement.skillId]
        })
      ).rows.map((row) => String(row.id));
  return {
    skillId: retirement.skillId,
    reason: carried
      ? `retired, answers carry to ${retirement.replacedBy}`
      : 'retired, answers no longer shown',
    ...(await independentAnswers(client, ids))
  };
}

export async function contentImpact(
  client: Client,
  pkg: ContentPackage
): Promise<ImpactLine[]> {
  const lines: ImpactLine[] = [];
  for (const version of pkg.versions) {
    const line = await versionImpact(client, version);
    if (line) lines.push(line);
  }
  for (const retirement of pkg.retirements ?? []) {
    const line = await retirementImpact(client, retirement);
    if (line) lines.push(line);
  }
  return lines;
}

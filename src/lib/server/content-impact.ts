import type { Client } from '@libsql/client';
import { type ContentPackage } from './content-import';
import { planVersion, priorVersion } from './content-update';
import { effectiveLineageKey } from './lineage';
import { loadEvidenceRows, qualifyingGrammarEvidence } from './mastery';

// Read-only report of what a package would do to learner progress, printed
// before an owner applies it. It counts the answers that would stop counting
// toward mastery; it does not recompute anyone's status.

export type ImpactLine = {
  skillId: string;
  reason: string;
  answers: number;
  learners: number;
};

/**
 * The answers mastery counts now for these item keys (every key when `keys` is
 * omitted), by the same rules mastery applies: the first response to an item,
 * independent, evaluated, from a version that is not quarantined.
 */
async function countedAnswers(
  client: Client,
  skillId: string,
  keys?: Set<string>
) {
  const rows = await loadEvidenceRows(client, { skillId });
  const byOwner = new Map<string, typeof rows>();
  for (const row of rows) {
    const owner = String(row.owner_id);
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), row]);
  }
  let answers = 0;
  let learners = 0;
  for (const ownerRows of byOwner.values()) {
    const counted = qualifyingGrammarEvidence(ownerRows).filter(
      (item) => keys === undefined || keys.has(item.itemKey)
    );
    answers += counted.length;
    if (counted.length > 0) learners += 1;
  }
  return { answers, learners };
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
  return {
    skillId: version.skillId,
    reason: `${keys.size} question(s) changed or removed in ${version.id}`,
    ...(await countedAnswers(client, version.skillId, keys))
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
  return {
    skillId: retirement.skillId,
    reason: carried
      ? `retired, answers carry to ${retirement.replacedBy}`
      : 'retired, answers no longer shown',
    ...(carried
      ? { answers: 0, learners: 0 }
      : await countedAnswers(client, retirement.skillId))
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

import type { Client } from '@libsql/client';
import { type ContentPackage } from './content-import';
import {
  planVersion,
  priorVersion,
  type PriorQuestion
} from './content-update';
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

type PackageVersion = ContentPackage['versions'][number];
type Earlier = { questions: PriorQuestion[] };

/**
 * The answers mastery counts now whose item key `stops` matches, by the same
 * rules mastery applies: the first response to an item, independent,
 * evaluated, from a version that is not quarantined.
 */
async function countedAnswers(
  client: Client,
  skillId: string,
  stops: (key: string) => boolean
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
    const counted = qualifyingGrammarEvidence(ownerRows).filter((item) =>
      stops(item.itemKey)
    );
    answers += counted.length;
    if (counted.length > 0) learners += 1;
  }
  return { answers, learners };
}

/** The lineage keys of a stored version's questions. */
async function versionKeys(client: Client, versionId: string) {
  const rows = await client.execute({
    sql: 'SELECT id, content_version_id, lineage_key FROM questions WHERE content_version_id = ?',
    args: [versionId]
  });
  return new Set(
    rows.rows.map((row) =>
      effectiveLineageKey({
        lineageKey: row.lineage_key === null ? null : String(row.lineage_key),
        contentVersionId: String(row.content_version_id),
        questionId: String(row.id)
      })
    )
  );
}

/** A skill's current version: its newest one that is not quarantined. */
async function currentVersion(
  client: Client,
  skillId: string,
  below = Number.MAX_SAFE_INTEGER
) {
  const found = await client.execute({
    sql: "SELECT id FROM content_versions WHERE skill_id = ? AND status <> 'quarantined' AND version < ? AND EXISTS (SELECT 1 FROM questions q WHERE q.content_version_id = content_versions.id) ORDER BY version DESC LIMIT 1",
    args: [skillId, below]
  });
  return found.rows[0] === undefined ? undefined : String(found.rows[0].id);
}

/** The impact of one version the database does not hold yet, if it drops questions. */
async function newVersionImpact(
  client: Client,
  version: PackageVersion,
  earlier: Earlier | undefined
) {
  const prior = earlier ?? (await priorVersion(client, version));
  const plan = planVersion(version, prior);
  const planned: Earlier = {
    questions: plan.questions.map((question) => ({
      id: question.id,
      lineageKey: question.lineageKey,
      contentVersionId: version.id
    }))
  };
  const keys = new Set(
    plan.removed.map((question) =>
      effectiveLineageKey({
        lineageKey: question.lineageKey,
        contentVersionId: question.contentVersionId,
        questionId: question.id
      })
    )
  );
  if (prior === undefined || keys.size === 0) return { planned };
  return {
    planned,
    line: {
      skillId: version.skillId,
      reason: `${keys.size} question(s) changed or removed in ${version.id}`,
      ...(await countedAnswers(client, version.skillId, (key) => keys.has(key)))
    }
  };
}

/** Quarantining the current version makes the one before it current again. */
async function quarantineImpact(
  client: Client,
  version: PackageVersion,
  status: string
): Promise<ImpactLine | undefined> {
  if (version.review !== 'quarantined' || status === 'quarantined')
    return undefined;
  if ((await currentVersion(client, version.skillId)) !== version.id)
    return undefined;
  const before = await currentVersion(client, version.skillId, version.version);
  const lost = await versionKeys(client, version.id);
  const kept =
    before === undefined ? new Set() : await versionKeys(client, before);
  const keys = [...lost].filter((key) => !kept.has(key));
  if (keys.length === 0) return undefined;
  return {
    skillId: version.skillId,
    reason: `${keys.length} question(s) withdrawn with ${version.id}`,
    ...(await countedAnswers(client, version.skillId, (key) =>
      keys.includes(key)
    ))
  };
}

/** The impact of one package version, and what the next one is planned against. */
async function versionImpact(
  client: Client,
  version: PackageVersion,
  earlier: Earlier | undefined
): Promise<{ line?: ImpactLine; planned?: Earlier }> {
  const stored = await client.execute({
    sql: 'SELECT status FROM content_versions WHERE id = ?',
    args: [version.id]
  });
  if (stored.rows.length === 0)
    return newVersionImpact(client, version, earlier);
  return {
    line: await quarantineImpact(client, version, String(stored.rows[0].status))
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
  if (retirement.carry !== true || retirement.replacedBy === undefined)
    return {
      skillId: retirement.skillId,
      reason: 'retired, answers no longer shown',
      ...(await countedAnswers(client, retirement.skillId, () => true))
    };
  const target = await currentVersion(client, retirement.replacedBy);
  const carried =
    target === undefined
      ? new Set<string>()
      : await versionKeys(client, target);
  return {
    skillId: retirement.skillId,
    reason: `retired, answers carry to ${retirement.replacedBy} where the items match`,
    ...(await countedAnswers(
      client,
      retirement.skillId,
      (key) => !carried.has(key)
    ))
  };
}

export async function contentImpact(
  client: Client,
  pkg: ContentPackage
): Promise<ImpactLine[]> {
  const lines: ImpactLine[] = [];
  const ordered = [...pkg.versions].sort(
    (a, b) => a.skillId.localeCompare(b.skillId) || a.version - b.version
  );
  let earlier: { skillId: string; plan: Earlier } | undefined;
  for (const version of ordered) {
    const before =
      earlier?.skillId === version.skillId ? earlier.plan : undefined;
    const { line, planned } = await versionImpact(client, version, before);
    if (line) lines.push(line);
    earlier = planned && { skillId: version.skillId, plan: planned };
  }
  for (const retirement of pkg.retirements ?? []) {
    const line = await retirementImpact(client, retirement);
    if (line) lines.push(line);
  }
  return lines;
}

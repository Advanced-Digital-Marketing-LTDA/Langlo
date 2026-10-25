import type { Client, Row } from '@libsql/client';
import { type ContentPackage } from './content-import';
import {
  planVersion,
  priorVersion,
  type PriorQuestion
} from './content-update';
import { effectiveLineageKey } from './lineage';
import {
  carriedTo,
  currentContent,
  loadEvidenceRows,
  qualifyingGrammarEvidence,
  scoreGrammar,
  type CurrentContent,
  type GrammarStatus
} from './mastery';

// Read-only report of what a package would do to learner progress, printed
// before an owner applies it. It counts the answers that would stop counting
// toward mastery and, for the skill they were given on, how many learners'
// grammar status would change as a result. A retired skill leaves the
// catalog, so its lines carry no status change.

export type StatusChange = {
  from: GrammarStatus;
  to: GrammarStatus;
  learners: number;
};

export type ImpactLine = {
  skillId: string;
  reason: string;
  answers: number;
  learners: number;
  statusChanges?: StatusChange[];
};

type PackageVersion = ContentPackage['versions'][number];
type Earlier = { questions: PriorQuestion[] };
type Counted = { itemKey: string; contentVersionId: string };
type Qualified = ReturnType<typeof qualifyingGrammarEvidence>[number];
type VersionCandidate = { id: string; version: number; status: string };

/** The grammar status mastery scores for these qualifying answers. */
const standing = (items: Qualified[]) =>
  scoreGrammar({
    correct: items.filter((item) => item.correct).length,
    incorrect: items.filter((item) => !item.correct).length,
    sessions: new Set(items.map((item) => item.sessionId)).size
  }).status;

/** Count one learner whose status moves from `from` to `to`. */
function tally(
  changes: Map<string, StatusChange>,
  from: GrammarStatus,
  to: GrammarStatus
) {
  const key = `${from}>${to}`;
  const found = changes.get(key);
  if (found) found.learners += 1;
  else changes.set(key, { from, to, learners: 1 });
}

/** The evidence rows of these skills, grouped by the learner who gave them. */
async function evidenceByOwner(client: Client, skillIds: string[]) {
  const byOwner = new Map<string, Row[]>();
  for (const skillId of skillIds)
    for (const row of await loadEvidenceRows(client, { skillId })) {
      const owner = String(row.owner_id);
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), row]);
    }
  return byOwner;
}

/**
 * The answers mastery counts now for `skillId` whose item `stops` matches, by
 * the same rules mastery applies: the first response to an item, independent,
 * evaluated, from a version that is not quarantined, to an item in the
 * skill's current version. Answers given on retired skills that carry to it
 * (directly or through other carries) count for it. `statusChanges` lists the
 * learners whose status for the skill differs once those answers are gone.
 */
async function countedAnswers(
  client: Client,
  skillId: string,
  stops: (answer: Counted) => boolean
) {
  const skill = await client.execute({
    sql: 'SELECT language FROM skills WHERE id = ?',
    args: [skillId]
  });
  if (skill.rows.length === 0)
    throw new Error(`impact report: skill ${skillId} is not stored`);
  const current = await currentContent(client, String(skill.rows[0].language));
  const sources = [
    skillId,
    ...[...current.carry.keys()].filter(
      (id) => carriedTo(id, current.carry) === skillId
    )
  ];
  const byOwner = await evidenceByOwner(client, sources);
  let answers = 0;
  let learners = 0;
  for (const ownerRows of byOwner.values()) {
    const held = qualifyingGrammarEvidence(ownerRows, current).filter(
      (item) => item.countsFor === skillId
    );
    const counted = held.filter(stops);
    answers += counted.length;
    if (counted.length === 0) continue;
    learners += 1;
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

/** The effective lineage keys of a planned version. */
const plannedKeys = (plan: Earlier) =>
  new Set(
    plan.questions.map((question) =>
      effectiveLineageKey({
        lineageKey: question.lineageKey,
        contentVersionId: question.contentVersionId,
        questionId: question.id
      })
    )
  );

/**
 * What a package has planned for a skill so far: `chain` is the newest planned
 * version of any review state (the next version continues it), `current` the
 * newest one that is not quarantined (what learners will see).
 */
type SkillPlan = { chain?: Earlier; current?: Earlier };

/** The keys the skill's current version holds before this version arrives. */
async function keysBefore(
  client: Client,
  skillId: string,
  current: Earlier | undefined
) {
  if (current !== undefined) return plannedKeys(current);
  const stored = await currentVersion(client, skillId);
  return stored === undefined ? undefined : versionKeys(client, stored);
}

/**
 * The impact of one version the database does not hold yet: the answers on
 * items of the current version that it leaves out. A version imported
 * quarantined never becomes current, so it drops nothing.
 */
async function newVersionImpact(
  client: Client,
  version: PackageVersion,
  plans: SkillPlan | undefined
): Promise<{ line?: ImpactLine; planned: Earlier }> {
  const plan = planVersion(
    version,
    plans?.chain ?? (await priorVersion(client, version))
  );
  const planned: Earlier = {
    questions: plan.questions.map((question) => ({
      id: question.id,
      lineageKey: question.lineageKey,
      contentVersionId: version.id
    }))
  };
  if (version.review === 'quarantined') return { planned };
  const before = await keysBefore(client, version.skillId, plans?.current);
  if (before === undefined) return { planned };
  const after = plannedKeys(planned);
  const keys = new Set([...before].filter((key) => !after.has(key)));
  if (keys.size === 0) return { planned };
  return {
    planned,
    line: {
      skillId: version.skillId,
      reason: `${keys.size} question(s) changed or removed in ${version.id}`,
      ...(await countedAnswers(client, version.skillId, (item) =>
        keys.has(item.itemKey)
      ))
    }
  };
}

/** Quarantining a version drops the answers first given in it. */
async function quarantineImpact(
  client: Client,
  version: PackageVersion,
  status: string
): Promise<ImpactLine | undefined> {
  if (version.review !== 'quarantined' || status === 'quarantined')
    return undefined;
  // Mastery ignores every answer first given in a quarantined version, even
  // to an item an earlier version also holds.
  return {
    skillId: version.skillId,
    reason: `answers given in ${version.id} stop counting`,
    ...(await countedAnswers(
      client,
      version.skillId,
      (item) => item.contentVersionId === version.id
    ))
  };
}

/** The impact of one package version, and what the next one is planned against. */
async function versionImpact(
  client: Client,
  version: PackageVersion,
  plans: SkillPlan | undefined
): Promise<{ line?: ImpactLine; planned?: Earlier }> {
  const stored = await client.execute({
    sql: 'SELECT status FROM content_versions WHERE id = ?',
    args: [version.id]
  });
  if (stored.rows.length === 0) return newVersionImpact(client, version, plans);
  return {
    line: await quarantineImpact(client, version, String(stored.rows[0].status))
  };
}

/**
 * The keys a replacement holds once the package is applied. The importer adds
 * a package's versions before its retirements, so a replacement the package
 * adds is matched by what the package plans.
 */
async function carriedKeys(
  client: Client,
  skillId: string,
  planned: Map<string, Earlier>
) {
  const plan = planned.get(skillId);
  if (plan) return plannedKeys(plan);
  const target = await currentVersion(client, skillId);
  return target === undefined ? new Set<string>() : versionKeys(client, target);
}

/** A retirement line: the skill leaves the catalog, so no status change is reported. */
async function retirementLine(
  client: Client,
  skillId: string,
  reason: string,
  stops: (answer: Counted) => boolean
): Promise<ImpactLine> {
  const { answers, learners } = await countedAnswers(client, skillId, stops);
  return { skillId, reason, answers, learners };
}

/** The impact of retiring one skill that is still live, if any. */
async function retirementImpact(
  client: Client,
  retirement: NonNullable<ContentPackage['retirements']>[number],
  planned: Map<string, Earlier>
): Promise<ImpactLine | undefined> {
  const skill = await client.execute({
    sql: 'SELECT retired_at FROM skills WHERE id = ?',
    args: [retirement.skillId]
  });
  if (skill.rows.length === 0 || skill.rows[0].retired_at !== null)
    return undefined;
  if (retirement.carry !== true || retirement.replacedBy === undefined)
    return retirementLine(
      client,
      retirement.skillId,
      'retired, answers no longer shown',
      () => true
    );
  const carried = await carriedKeys(client, retirement.replacedBy, planned);
  return retirementLine(
    client,
    retirement.skillId,
    `retired, answers carry to ${retirement.replacedBy} where the items match`,
    (item) => !carried.has(item.itemKey)
  );
}

/** Remember a planned version: it continues the chain, and is current unless quarantined. */
function recordPlan(
  plans: Map<string, SkillPlan>,
  version: PackageVersion,
  planned: Earlier
) {
  const before = plans.get(version.skillId);
  plans.set(version.skillId, {
    chain: planned,
    current: version.review === 'quarantined' ? before?.current : planned
  });
}

/** Impact lines of the package's versions, and what each skill is planned to hold. */
async function packageVersionImpact(
  client: Client,
  versions: PackageVersion[]
) {
  const lines: ImpactLine[] = [];
  const plans = new Map<string, SkillPlan>();
  const plannedVersions = new Map<string, Earlier>();
  for (const version of versions) {
    const { line, planned } = await versionImpact(
      client,
      version,
      plans.get(version.skillId)
    );
    if (line) lines.push(line);
    if (planned) {
      plannedVersions.set(version.id, planned);
      recordPlan(plans, version, planned);
    }
  }
  const projected = new Map<string, Earlier>();
  for (const [skillId, plan] of plans)
    if (plan.current) projected.set(skillId, plan.current);
  return { lines, projected, plannedVersions };
}

/** The current question keys for one skill after applying package version states. */
async function currentKeysAfterPackage(
  client: Client,
  skillId: string,
  versions: PackageVersion[],
  plannedVersions: Map<string, Earlier>
) {
  const stored = await client.execute({
    sql: 'SELECT id, version, status FROM content_versions WHERE skill_id = ?',
    args: [skillId]
  });
  const candidates = versionCandidates(stored.rows, versions, skillId);
  const current = candidates
    .sort((a, b) => b.version - a.version)
    .find((candidate) => candidate.status !== 'quarantined');
  if (current === undefined) return undefined;
  return candidateKeys(client, current, plannedVersions);
}

/** Stored and planned versions with their final package review state. */
function versionCandidates(
  storedRows: Row[],
  versions: PackageVersion[],
  skillId: string
): VersionCandidate[] {
  const packageVersions = new Map(
    versions
      .filter((version) => version.skillId === skillId)
      .map((version) => [version.id, version])
  );
  const stored = storedRows.map((row) => {
    const id = String(row.id);
    return storedCandidate(row, id, packageVersions.get(id));
  });
  const storedIds = new Set(stored.map((candidate) => candidate.id));
  const planned = versions
    .filter(
      (version) => version.skillId === skillId && !storedIds.has(version.id)
    )
    .map(packageCandidate);
  return [...stored, ...planned];
}

function storedCandidate(
  row: Row,
  id: string,
  packageVersion: PackageVersion | undefined
): VersionCandidate {
  return {
    id,
    version: Number(row.version),
    status: statusAfterReview(packageVersion?.review, String(row.status))
  };
}

function packageCandidate(version: PackageVersion): VersionCandidate {
  return {
    id: version.id,
    version: version.version,
    status: statusAfterReview(version.review, 'schema-validated')
  };
}

function statusAfterReview(
  review: PackageVersion['review'] | undefined,
  current: string
) {
  return review === 'quarantined' ? 'quarantined' : current;
}

function candidateKeys(
  client: Client,
  candidate: VersionCandidate,
  plannedVersions: Map<string, Earlier>
) {
  const planned = plannedVersions.get(candidate.id);
  return planned === undefined
    ? versionKeys(client, candidate.id)
    : plannedKeys(planned);
}

/**
 * Status changes are one package-level before/after comparison per skill.
 * Answer counts stay per version; one line carries the cumulative status result.
 */
async function packageStatusChanges(
  client: Client,
  lines: ImpactLine[],
  versions: PackageVersion[],
  plannedVersions: Map<string, Earlier>
) {
  for (const line of lines) line.statusChanges = [];
  const skillIds = [...new Set(lines.map((line) => line.skillId))];
  const quarantinedVersions = quarantinedVersionIds(versions);
  for (const skillId of skillIds)
    await packageSkillStatusChanges(
      client,
      lines,
      skillId,
      versions,
      plannedVersions,
      quarantinedVersions
    );
}

function quarantinedVersionIds(versions: PackageVersion[]) {
  return new Set(
    versions
      .filter((version) => version.review === 'quarantined')
      .map((version) => version.id)
  );
}

async function packageSkillStatusChanges(
  client: Client,
  lines: ImpactLine[],
  skillId: string,
  versions: PackageVersion[],
  plannedVersions: Map<string, Earlier>,
  quarantinedVersions: Set<string>
) {
  const skill = await client.execute({
    sql: 'SELECT language FROM skills WHERE id = ?',
    args: [skillId]
  });
  if (skill.rows.length === 0)
    throw new Error(`impact report: skill ${skillId} is not stored`);
  const before = await currentContent(client, String(skill.rows[0].language));
  const nextKeys = await currentKeysAfterPackage(
    client,
    skillId,
    versions,
    plannedVersions
  );
  const after = contentWithSkillKeys(before, skillId, nextKeys);
  const sources = skillEvidenceSources(skillId, before.carry);
  const byOwner = await evidenceByOwner(client, sources);
  const changes = statusChangesByOwner(
    byOwner,
    skillId,
    before,
    after,
    quarantinedVersions
  );
  const lastLine = [...lines]
    .reverse()
    .find((line) => line.skillId === skillId);
  if (lastLine) lastLine.statusChanges = sortedStatusChanges(changes);
}

function contentWithSkillKeys(
  before: CurrentContent,
  skillId: string,
  nextKeys: Set<string> | undefined
): CurrentContent {
  const keys = new Map(
    [...before.keys].map(([id, held]) => [id, new Set(held)])
  );
  if (nextKeys === undefined) keys.delete(skillId);
  else keys.set(skillId, nextKeys);
  return { keys, carry: before.carry };
}

function skillEvidenceSources(skillId: string, carry: CurrentContent['carry']) {
  return [
    skillId,
    ...[...carry.keys()].filter((id) => carriedTo(id, carry) === skillId)
  ];
}

function statusChangesByOwner(
  byOwner: Map<string, Row[]>,
  skillId: string,
  before: CurrentContent,
  after: CurrentContent,
  quarantinedVersions: Set<string>
) {
  const changes = new Map<string, StatusChange>();
  for (const ownerRows of byOwner.values()) {
    const { from, to } = ownerStatusChange(
      ownerRows,
      skillId,
      before,
      after,
      quarantinedVersions
    );
    if (from !== to) tally(changes, from, to);
  }
  return changes;
}

function ownerStatusChange(
  ownerRows: Row[],
  skillId: string,
  before: CurrentContent,
  after: CurrentContent,
  quarantinedVersions: Set<string>
) {
  const from = standingForSkill(ownerRows, skillId, before);
  const projectedRows = ownerRows.map((row) =>
    quarantinedVersions.has(String(row.content_version_id))
      ? { ...row, status: 'quarantined' }
      : row
  );
  return {
    from,
    to: standingForSkill(projectedRows, skillId, after)
  };
}

function standingForSkill(
  rows: Row[],
  skillId: string,
  content: CurrentContent
) {
  return standing(
    qualifyingGrammarEvidence(rows, content).filter(
      (item) => item.countsFor === skillId
    )
  );
}

function sortedStatusChanges(changes: Map<string, StatusChange>) {
  return [...changes.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
  );
}

export async function contentImpact(
  client: Client,
  pkg: ContentPackage
): Promise<ImpactLine[]> {
  const ordered = [...pkg.versions].sort(
    (a, b) => a.skillId.localeCompare(b.skillId) || a.version - b.version
  );
  const { lines, projected, plannedVersions } = await packageVersionImpact(
    client,
    ordered
  );
  await packageStatusChanges(client, lines, ordered, plannedVersions);
  for (const retirement of pkg.retirements ?? []) {
    const line = await retirementImpact(client, retirement, projected);
    if (line) lines.push(line);
  }
  return lines;
}

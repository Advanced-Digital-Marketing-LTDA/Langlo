import { GRAMMAR_POLICY_VERSION, type GrammarStatus } from './mastery';

type Topic = {
  skillId: string;
  status: GrammarStatus;
  prerequisites: string[];
  available?: boolean;
};
type PracticeTopic = Topic & {
  correct: number;
  independentItems: number;
  practisedSessions: number;
  answers: number;
  lastPractisedAt: number | null;
  reason: string;
};
const priority: Record<GrammarStatus, number> = {
  weak: 0,
  practising: 1,
  unknown: 2,
  secure: 3
};

export function recommendTopics(skills: Topic[]) {
  const available = skills.filter((skill) => skill.available !== false);
  const ranked = [...available].sort(
    (a, b) =>
      priority[a.status] - priority[b.status] ||
      a.skillId.localeCompare(b.skillId)
  );
  const topic = ranked[0];
  if (!topic) return null;
  const prerequisite = available
    .filter(
      (skill) =>
        topic.prerequisites.includes(skill.skillId) && skill.status !== 'secure'
    )
    .sort((a, b) => a.skillId.localeCompare(b.skillId))[0];
  return {
    skillId: prerequisite?.skillId ?? topic.skillId,
    reason: prerequisite
      ? `This foundation is recommended before ${topic.skillId}. You can still choose any topic.`
      : `Recommended from your ${topic.status} grammar evidence. You can still choose any topic.`,
    policyVersion: GRAMMAR_POLICY_VERSION,
    manualSkillIds: available
      .map((skill) => skill.skillId)
      .sort((a, b) => a.localeCompare(b))
  };
}

const needsPractice = (skill: PracticeTopic) =>
  skill.available !== false &&
  skill.answers > 0 &&
  (skill.status === 'weak' || skill.status === 'practising');

function compareAccuracy(a: PracticeTopic, b: PracticeTopic) {
  const accuracyA = a.correct / a.independentItems;
  const accuracyB = b.correct / b.independentItems;
  return accuracyA !== accuracyB ? accuracyA - accuracyB : 0;
}

function compareRecency(a: PracticeTopic, b: PracticeTopic) {
  const recentA = a.lastPractisedAt ?? Number.POSITIVE_INFINITY;
  const recentB = b.lastPractisedAt ?? Number.POSITIVE_INFINITY;
  return recentA !== recentB ? recentA - recentB : 0;
}

function compareWithinStatus(a: PracticeTopic, b: PracticeTopic) {
  if (a.status === 'weak') return compareAccuracy(a, b);
  if (a.status === 'practising') return compareRecency(a, b);
  return 0;
}

function comparePractice(a: PracticeTopic, b: PracticeTopic) {
  return (
    priority[a.status] - priority[b.status] ||
    compareWithinStatus(a, b) ||
    a.skillId.localeCompare(b.skillId)
  );
}

/** Put each topic after its still-pending prerequisites. */
function orderByPrerequisites(ranked: PracticeTopic[]) {
  const ordered: PracticeTopic[] = [];
  let pending = ranked;
  while (pending.length) {
    const ids = new Set(pending.map((skill) => skill.skillId));
    // shortcut: if imported content has a prerequisite cycle, fall back to the existing ranking; report cycles if imports stop rejecting them.
    const next =
      pending.find((skill) => !skill.prerequisites.some((id) => ids.has(id))) ??
      pending[0];
    ordered.push(next);
    pending = pending.filter((skill) => skill !== next);
  }
  return ordered;
}

/** Recommend only started topics whose current evidence still needs work. */
export function recommendPractice(skills: PracticeTopic[]) {
  const ranked = skills.filter(needsPractice).sort(comparePractice);
  return orderByPrerequisites(ranked)
    .slice(0, 5)
    .map((skill) => ({
      skillId: skill.skillId,
      status: skill.status,
      practisedSessions: skill.practisedSessions,
      answers: skill.answers,
      lastPractisedAt: skill.lastPractisedAt,
      reason: skill.reason
    }));
}

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

/** Recommend only started topics whose current evidence still needs work. */
export function recommendPractice(skills: PracticeTopic[]) {
  const ranked = skills
    .filter(
      (skill) =>
        skill.available !== false &&
        skill.answers > 0 &&
        (skill.status === 'weak' || skill.status === 'practising')
    )
    .sort((a, b) => {
      const status = priority[a.status] - priority[b.status];
      if (status) return status;
      if (a.status === 'weak' && b.status === 'weak') {
        const accuracyA = a.correct / a.independentItems;
        const accuracyB = b.correct / b.independentItems;
        if (accuracyA !== accuracyB) return accuracyA - accuracyB;
      } else if (a.status === 'practising' && b.status === 'practising') {
        const recentA = a.lastPractisedAt ?? Number.POSITIVE_INFINITY;
        const recentB = b.lastPractisedAt ?? Number.POSITIVE_INFINITY;
        if (recentA !== recentB) return recentA - recentB;
      }
      return a.skillId.localeCompare(b.skillId);
    });

  const remaining = new Set(ranked.map((skill) => skill.skillId));
  const ordered: PracticeTopic[] = [];
  while (remaining.size) {
    const next =
      ranked.find(
        (skill) =>
          remaining.has(skill.skillId) &&
          !skill.prerequisites.some((id) => remaining.has(id))
      ) ?? ranked.find((skill) => remaining.has(skill.skillId));
    if (!next) break;
    // shortcut: if imported content has a prerequisite cycle, fall back to the existing ranking; report cycles if imports stop rejecting them.
    ordered.push(next);
    remaining.delete(next.skillId);
  }

  return ordered.slice(0, 5).map((skill) => ({
    skillId: skill.skillId,
    status: skill.status,
    practisedSessions: skill.practisedSessions,
    answers: skill.answers,
    lastPractisedAt: skill.lastPractisedAt,
    reason: skill.reason
  }));
}

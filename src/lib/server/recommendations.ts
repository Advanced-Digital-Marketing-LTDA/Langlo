import { GRAMMAR_POLICY_VERSION, type GrammarStatus } from './mastery';

type Topic = {
  skillId: string;
  status: GrammarStatus;
  prerequisites: string[];
  available?: boolean;
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

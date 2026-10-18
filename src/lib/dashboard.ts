import type { TrackProgress } from './server/progress';

export type MasteryStatus = TrackProgress['skills'][number]['status'];

export const masteryLabels: Record<MasteryStatus, string> = {
  unknown: 'Unknown',
  weak: 'Weak',
  practising: 'Practising',
  secure: 'Secure'
};

// Status is always shown as a symbol plus text, never by colour alone.
export const masterySymbols: Record<MasteryStatus, string> = {
  unknown: '○',
  weak: '!',
  practising: '◐',
  secure: '✓'
};

/** Display order of the statuses, strongest first. */
export const masteryStatuses = [
  'secure',
  'practising',
  'weak',
  'unknown'
] as const satisfies readonly MasteryStatus[];

export function summarizeTrack(track: TrackProgress) {
  const counts: Record<MasteryStatus, number> = {
    unknown: 0,
    weak: 0,
    practising: 0,
    secure: 0
  };
  // Unavailable skills (no published lesson, or quarantined) cannot be opened,
  // so they are neither counted nor listed here; the skill map still shows them.
  const skills = track.skills.filter((skill) => skill.available);
  for (const skill of skills) counts[skill.status] += 1;
  const { recommendation } = track;
  const skill = recommendation
    ? track.skills.find((item) => item.skillId === recommendation.skillId)
    : undefined;
  return {
    counts,
    skills,
    total: skills.length,
    recommended:
      recommendation && skill ? { skill, reason: recommendation.reason } : null
  };
}

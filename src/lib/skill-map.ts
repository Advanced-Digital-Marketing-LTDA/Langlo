import type { GrammarStatus } from './server/mastery';

export type SkillMapSkill = {
  skillId: string;
  title: string;
  level: string;
  available: boolean;
  status: GrammarStatus;
  prerequisites: string[];
};

const statuses: GrammarStatus[] = ['secure', 'practising', 'weak', 'unknown'];

export function normalizeMapReturnTo(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return '/app/map';
  try {
    const url = new URL(value, 'https://langlo.invalid');
    if (url.origin !== 'https://langlo.invalid' || url.pathname !== '/app/map')
      return '/app/map';
    const allowed = new Set([
      'language',
      'skill',
      'q',
      'status',
      'level',
      'view',
      'focus',
      'zoom',
      'x',
      'y'
    ]);
    // Snapshot keys: deleting from the live iterator skips adjacent keys.
    for (const key of [...url.searchParams.keys()])
      if (!allowed.has(key)) url.searchParams.delete(key);
    return `${url.pathname}${url.search}`;
  } catch {
    return '/app/map';
  }
}

type SkillMapFilters = {
  query?: string;
  status?: GrammarStatus | '';
  level?: string;
  selectedSkillId?: string;
};

function matchingSkills(skills: SkillMapSkill[], filters: SkillMapFilters) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  let matching = skills.filter((skill) =>
    skill.title.toLocaleLowerCase().includes(query)
  );
  if (filters.status)
    matching = matching.filter((skill) => skill.status === filters.status);
  if (filters.level)
    matching = matching.filter((skill) => skill.level === filters.level);
  return matching;
}

function withFoundations(skills: SkillMapSkill[], roots: string[]) {
  const visibleIds = new Set<string>();
  const byId = new Map(skills.map((skill) => [skill.skillId, skill]));
  const pending = [...roots];
  while (pending.length) {
    const id = pending.pop()!;
    const skill = byId.get(id);
    if (!skill || visibleIds.has(id)) continue;
    visibleIds.add(id);
    pending.push(...skill.prerequisites);
  }
  return visibleIds;
}

export function filterSkillMap(
  skills: SkillMapSkill[],
  filters: SkillMapFilters
) {
  const matchingIds = new Set(
    matchingSkills(skills, filters).map(({ skillId }) => skillId)
  );
  const roots = [...matchingIds];
  if (filters.selectedSkillId) roots.push(filters.selectedSkillId);
  return {
    visibleIds: withFoundations(skills, roots),
    matchingIds
  };
}

export function skillStateDistribution(skills: SkillMapSkill[]) {
  const counts = Object.fromEntries(
    statuses.map((status) => [status, 0])
  ) as Record<GrammarStatus, number>;
  const available = skills.filter((skill) => skill.available);
  for (const skill of available) counts[skill.status] += 1;
  const total = available.length;
  const raw = statuses.map((status) =>
    total ? (counts[status] / total) * 100 : 0
  );
  const percents = raw.map(Math.floor);
  for (
    let remaining = 100 - percents.reduce((sum, value) => sum + value, 0);
    total && remaining > 0;
    remaining -= 1
  ) {
    const index = raw.reduce(
      (best, value, current) =>
        value - percents[current] > raw[best] - percents[best] ? current : best,
      0
    );
    percents[index] += 1;
  }
  return {
    total,
    counts,
    segments: (total ? statuses : []).map((status, index) => ({
      status,
      count: counts[status],
      percent: percents[index]
    }))
  };
}

export function layoutSkillMap(skills: SkillMapSkill[]) {
  const ids = new Set(skills.map(({ skillId }) => skillId));
  const prerequisites = new Map(
    skills.map(({ skillId, prerequisites }) => [
      skillId,
      prerequisites.filter((id, index, list) =>
        ids.has(id) ? list.indexOf(id) === index : false
      )
    ])
  );
  const pending = [...skills];
  const placed = new Set<string>();
  const layers: SkillMapSkill[][] = [];
  while (pending.length) {
    const ready = pending.filter((skill) =>
      prerequisites.get(skill.skillId)?.every((id) => placed.has(id))
    );
    const layer = ready.length ? ready : [...pending];
    layers.push(layer);
    for (const skill of layer) {
      placed.add(skill.skillId);
      pending.splice(pending.indexOf(skill), 1);
    }
  }
  const levelNames = [...new Set(skills.map((skill) => skill.level))].sort(
    (a, b) => a.localeCompare(b)
  );
  let top = 40;
  const levels = levelNames.map((level) => {
    const rows = Math.max(
      1,
      ...layers.map(
        (layer) => layer.filter((skill) => skill.level === level).length
      )
    );
    const band = { level, y: top + 32, height: rows * 124 + 24 };
    top += band.height + 12;
    return band;
  });
  const bandByLevel = new Map(levels.map((band) => [band.level, band]));
  const nodes = layers.flatMap((layer, column) => {
    const rows = new Map<string, number>();
    return layer.map((skill) => {
      const row = rows.get(skill.level) ?? 0;
      rows.set(skill.level, row + 1);
      return {
        ...skill,
        column,
        row,
        x: 32 + column * 260,
        y: (bandByLevel.get(skill.level)?.y ?? 52) + row * 124
      };
    });
  });
  const positions = new Map(nodes.map((node) => [node.skillId, node]));
  const edges = nodes.flatMap((node) =>
    (prerequisites.get(node.skillId) ?? []).map((from) => ({
      from,
      to: node.skillId
    }))
  );
  return {
    nodes,
    edges,
    width: Math.max(1, layers.length) * 260 + 8,
    height: Math.max(128, top),
    levels,
    positions
  };
}

type StudyListSkill = SkillMapSkill & { practisedSessions: number };

const studyPriority: Record<GrammarStatus, number> = {
  weak: 0,
  practising: 1,
  unknown: 2,
  secure: 3
};

function compareStudy(a: StudyListSkill, b: StudyListSkill) {
  return (
    studyPriority[a.status] - studyPriority[b.status] ||
    a.practisedSessions - b.practisedSessions ||
    a.skillId.localeCompare(b.skillId)
  );
}

/** A topic's non-secure prerequisites, in ranked order. */
function unfinishedFoundations<T extends StudyListSkill>(
  skill: T,
  ranked: T[]
) {
  return ranked.filter(
    (item) =>
      item.status !== 'secure' && skill.prerequisites.includes(item.skillId)
  );
}

/** Rank available topics: weakest and least practised first, foundations ahead of the topics that need them. */
export function rankStudyList<T extends StudyListSkill>(skills: T[]) {
  const ranked = skills.filter((skill) => skill.available).sort(compareStudy);
  const visited = new Set<string>();
  const ordered: { skill: T; foundationFor: T | null }[] = [];
  const place = (skill: T, foundationFor: T | null) => {
    if (visited.has(skill.skillId)) return;
    visited.add(skill.skillId);
    for (const prerequisite of unfinishedFoundations(skill, ranked))
      place(prerequisite, skill);
    ordered.push({ skill, foundationFor });
  };
  for (const skill of ranked) place(skill, null);
  return ordered;
}

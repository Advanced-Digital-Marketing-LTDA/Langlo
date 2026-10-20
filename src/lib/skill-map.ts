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
    for (const key of [...url.searchParams.keys()])
      if (!allowed.has(key)) url.searchParams.delete(key);
    return `${url.pathname}${url.search}`;
  } catch {
    return '/app/map';
  }
}

export function filterSkillMap(
  skills: SkillMapSkill[],
  filters: {
    query?: string;
    status?: GrammarStatus | '';
    level?: string;
    selectedSkillId?: string;
  }
) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  const matching = skills.filter(
    (skill) =>
      (!query || skill.title.toLocaleLowerCase().includes(query)) &&
      (!filters.status || skill.status === filters.status) &&
      (!filters.level || skill.level === filters.level)
  );
  const visibleIds = new Set(matching.map(({ skillId }) => skillId));
  const byId = new Map(skills.map((skill) => [skill.skillId, skill]));
  const addFoundations = (skillId: string, seen = new Set<string>()) => {
    if (seen.has(skillId)) return;
    seen.add(skillId);
    for (const id of byId.get(skillId)?.prerequisites ?? []) {
      if (byId.has(id)) {
        visibleIds.add(id);
        addFoundations(id, seen);
      }
    }
  };
  if (query || filters.status || filters.level)
    for (const { skillId } of matching) addFoundations(skillId);
  else for (const { skillId } of skills) visibleIds.add(skillId);
  if (filters.selectedSkillId && byId.has(filters.selectedSkillId)) {
    visibleIds.add(filters.selectedSkillId);
    addFoundations(filters.selectedSkillId);
  }
  return {
    visibleIds,
    matchingIds: new Set(matching.map(({ skillId }) => skillId))
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
  const levelNames = [...new Set(skills.map((skill) => skill.level))].sort();
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

import { expect, it } from 'vitest';
import {
  layoutSkillMap,
  filterSkillMap,
  normalizeMapReturnTo,
  skillStateDistribution
} from '../src/lib/skill-map';

const skill = (
  skillId: string,
  prerequisites: string[] = [],
  overrides: Partial<{
    level: 'A1' | 'A2';
    available: boolean;
    status: 'unknown' | 'weak' | 'practising' | 'secure';
  }> = {}
) => ({
  skillId,
  title: skillId,
  level: 'A1' as const,
  prerequisites,
  available: true,
  status: 'unknown' as const,
  ...overrides
});

it('places topics after their prerequisites and keeps unavailable foundations connected', () => {
  const layout = layoutSkillMap([
    skill('advanced', ['foundation'], { level: 'A2' }),
    skill('foundation', [], { available: false })
  ]);

  expect(
    layout.nodes.find(({ skillId }) => skillId === 'foundation')?.column
  ).toBeLessThan(
    layout.nodes.find(({ skillId }) => skillId === 'advanced')?.column ?? -1
  );
  expect(
    layout.nodes.find(({ skillId }) => skillId === 'foundation')?.y
  ).toBeLessThan(
    layout.nodes.find(({ skillId }) => skillId === 'advanced')?.y ?? -1
  );
  expect(layout.levels.map(({ level }) => level)).toEqual(['A1', 'A2']);
  expect(layout.edges).toEqual([{ from: 'foundation', to: 'advanced' }]);
});

it('keeps layout deterministic when prerequisites contain a cycle', () => {
  const skills = [skill('a', ['b']), skill('b', ['a']), skill('c', ['a'])];
  expect(layoutSkillMap(skills)).toEqual(layoutSkillMap(skills));
  expect(layoutSkillMap(skills).edges).toHaveLength(3);
});

it('counts only available skills and rounds state percentages to 100', () => {
  const distribution = skillStateDistribution([
    skill('s1', [], { status: 'secure' }),
    skill('s2', [], { status: 'secure' }),
    skill('p', [], { status: 'practising' }),
    skill('w', [], { status: 'weak' }),
    skill('u', [], { status: 'unknown' }),
    skill('hidden', [], { available: false, status: 'secure' })
  ]);

  expect(distribution.total).toBe(5);
  expect(distribution.counts.secure).toBe(2);
  expect(distribution.segments.map(({ percent }) => percent)).toEqual([
    40, 20, 20, 20
  ]);
});

it('reports an empty distribution without percentages', () => {
  expect(skillStateDistribution([])).toMatchObject({ total: 0, segments: [] });
});

it('preserves valid map context and rejects external return destinations', () => {
  expect(
    normalizeMapReturnTo('/app/map?language=fr&skill=fr-a1-001&view=list')
  ).toBe('/app/map?language=fr&skill=fr-a1-001&view=list');
  expect(normalizeMapReturnTo('https://example.com')).toBe('/app/map');
  expect(normalizeMapReturnTo('//example.com/app/map')).toBe('/app/map');
  expect(normalizeMapReturnTo('/app/map/../decks')).toBe('/app/map');
});

it('removes every adjacent unrecognized return-map parameter', () => {
  expect(
    normalizeMapReturnTo('/app/map?next=evil&redirect=evil&language=fr')
  ).toBe('/app/map?language=fr');
});

it('keeps cyclic foundations and a selected nonmatching topic visible', () => {
  const filtered = filterSkillMap(
    [
      skill('a', ['b']),
      skill('b', ['a']),
      skill('selected', ['b']),
      skill('other')
    ],
    { query: 'nothing', selectedSkillId: 'selected' }
  );
  expect(filtered.matchingIds).toEqual(new Set());
  expect(filtered.visibleIds).toEqual(new Set(['selected', 'a', 'b']));
});

it('keeps matching topics and their foundations visible under filters', () => {
  const filtered = filterSkillMap(
    [
      skill('foundation'),
      skill('target', ['foundation'], { level: 'A2', status: 'weak' }),
      skill('other')
    ],
    { query: 'target', status: 'weak', level: 'A2' }
  );
  expect(filtered.visibleIds).toEqual(new Set(['target', 'foundation']));
  expect(filtered.matchingIds).toEqual(new Set(['target']));
});

it('keeps the selected topic visible when it does not match a filter', () => {
  const filtered = filterSkillMap(
    [skill('selected'), skill('other', [], { status: 'weak' })],
    { status: 'weak', selectedSkillId: 'selected' }
  );
  expect(filtered.visibleIds).toEqual(new Set(['selected', 'other']));
  expect(filtered.matchingIds).toEqual(new Set(['other']));
});

import { expect, it } from 'vitest';
import fc from 'fast-check';
import { layoutSkillMap, skillStateDistribution } from '../src/lib/skill-map';

it('state percentages sum to 100 for every nonempty available set', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          available: fc.boolean(),
          status: fc.constantFrom('unknown', 'weak', 'practising', 'secure')
        }),
        { minLength: 1, maxLength: 60 }
      ),
      (items) => {
        const distribution = skillStateDistribution(
          items.map((item, index) => ({
            skillId: String(index),
            title: String(index),
            level: 'A1',
            prerequisites: [],
            ...item
          }))
        );
        expect(distribution.total).toBe(
          items.filter((item) => item.available).length
        );
        expect(
          distribution.segments.reduce((sum, item) => sum + item.percent, 0)
        ).toBe(distribution.total ? 100 : 0);
      }
    )
  );
});

it('lays every acyclic prerequisite after its foundation', () => {
  fc.assert(
    fc.property(
      fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
      (edges) => {
        const skills = edges.map((hasPrerequisite, index) => ({
          skillId: String(index),
          title: String(index),
          level: index < edges.length / 2 ? 'A1' : 'A2',
          available: true,
          status: 'unknown' as const,
          prerequisites: hasPrerequisite && index ? [String(index - 1)] : []
        }));
        const layout = layoutSkillMap(skills);
        for (const edge of layout.edges)
          expect(layout.positions.get(edge.from)!.column).toBeLessThan(
            layout.positions.get(edge.to)!.column
          );
      }
    )
  );
});

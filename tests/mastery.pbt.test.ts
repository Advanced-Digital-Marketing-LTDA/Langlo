import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { Row } from '@libsql/client';
import { qualifyingGrammarEvidence } from '../src/lib/server/mastery';
import { recommendTopics } from '../src/lib/server/recommendations';
import { propertyOptions } from './property-options';

it('evidence replay, join duplication and source order do not change qualifying items', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          item: fc.integer({ min: 0, max: 8 }),
          correct: fc.boolean(),
          assisted: fc.boolean(),
          uncertain: fc.boolean()
        }),
        { maxLength: 40 }
      ),
      (attempts) => {
        const rows: Row[] = attempts.map((item, i) => ({
          length: 0,
          attempt_id: `attempt-${i}`,
          created_at: i,
          sequence: i,
          skill_id: 'skill',
          question_id: `version:q${item.item}`,
          content_version_id: 'version',
          study_session_id: `session-${i}`,
          evidence_kind: item.assisted ? 'assisted' : 'independent',
          not_sure: 0,
          mode: 'practice',
          state: 'active',
          status: 'pilot-ready',
          evaluator_version: 'prepared-1',
          rubric_version: 'version',
          evaluation_id: `evaluation-${i}`,
          outcome: item.uncertain
            ? 'uncertain'
            : item.correct
              ? 'correct'
              : 'incorrect'
        }));
        const expected = qualifyingGrammarEvidence(rows);
        expect(qualifyingGrammarEvidence([...rows, ...rows].reverse())).toEqual(
          expected
        );
        expect(new Set(expected.map((item) => item.attemptId)).size).toBe(
          expected.length
        );
      }
    ),
    propertyOptions()
  );
});

it('recommendations remain stable under catalog ordering and never remove an available manual choice', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 0, max: 100 }), { maxLength: 30 }),
      (ids) => {
        const skills = ids.map((id) => ({
          skillId: `skill-${id}`,
          status: (['unknown', 'weak', 'practising', 'secure'] as const)[
            id % 4
          ],
          prerequisites: [] as string[],
          available: id % 5 !== 0
        }));
        const result = recommendTopics(skills);
        expect(recommendTopics([...skills].reverse())).toEqual(result);
        expect(result?.manualSkillIds ?? []).toEqual(
          skills
            .filter((skill) => skill.available)
            .map((skill) => skill.skillId)
            .sort()
        );
      }
    ),
    propertyOptions()
  );
});

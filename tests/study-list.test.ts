import { afterAll, expect, it } from 'vitest';
import { rankStudyList } from '../src/lib/skill-map';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

afterAll(closeRenderServer);

type Status = 'unknown' | 'weak' | 'practising' | 'secure';

const skill = (
  skillId: string,
  status: Status,
  practisedSessions = 0,
  prerequisites: string[] = [],
  available = true
) => ({
  skillId,
  title: `Title ${skillId}`,
  level: 'A1',
  status,
  practisedSessions,
  prerequisites,
  available
});

const ids = (skills: Parameters<typeof rankStudyList>[0]) =>
  rankStudyList(skills).map(({ skill }) => skill.skillId);

it('orders weak, practising, unknown, then secure topics', () => {
  expect(
    ids([
      skill('a', 'secure'),
      skill('b', 'unknown'),
      skill('c', 'practising'),
      skill('d', 'weak')
    ])
  ).toEqual(['d', 'c', 'b', 'a']);
});

it('puts the least practised topic first within a state, then sorts by id', () => {
  expect(
    ids([skill('a', 'weak', 3), skill('c', 'weak', 1), skill('b', 'weak', 1)])
  ).toEqual(['b', 'c', 'a']);
});

it('moves an unfinished foundation ahead of the topic that needs it', () => {
  const ranked = rankStudyList([
    skill('topic', 'weak', 0, ['base']),
    skill('other', 'practising'),
    skill('base', 'unknown')
  ]);
  expect(ranked.map(({ skill }) => skill.skillId)).toEqual([
    'base',
    'topic',
    'other'
  ]);
  expect(ranked[0].foundationFor?.skillId).toBe('topic');
  expect(ranked[1].foundationFor).toBeNull();
});

it('leaves secure foundations in place and drops unavailable topics', () => {
  expect(
    ids([
      skill('topic', 'weak', 0, ['base']),
      skill('base', 'secure'),
      skill('hidden', 'weak', 0, [], false)
    ])
  ).toEqual(['topic', 'base']);
});

it('stops at a prerequisite cycle instead of looping', () => {
  expect(
    ids([skill('a', 'weak', 0, ['b']), skill('b', 'weak', 0, ['a'])])
  ).toEqual(['b', 'a']);
});

it('renders the first ten topics with practise forms and a View more button', async () => {
  const skills = Array.from({ length: 12 }, (_, index) =>
    skill(`s${String(index).padStart(2, '0')}`, 'weak', index)
  );
  const html = await renderSvelte('src/lib/components/StudyList.svelte', {
    skills,
    language: 'fr',
    submissionKey: 'key-1',
    returnTo: '/app/map?language=fr'
  });
  expect(html).toContain('Recommended study list');
  expect(html.match(/<li/g)).toHaveLength(10);
  expect(html).toContain('Title s09');
  expect(html).not.toContain('Title s10');
  expect(html.match(/Practise this topic/g)).toHaveLength(10);
  expect(html).toContain('value="s00"');
  expect(html).toContain('Weak · practised 1 time<');
  expect(html).toContain('View more');
});

it('shows a foundation reason and hides View more when everything fits', async () => {
  const html = await renderSvelte('src/lib/components/StudyList.svelte', {
    skills: [skill('topic', 'weak', 0, ['base']), skill('base', 'unknown')],
    language: 'fr',
    submissionKey: 'key-1',
    returnTo: '/app/map'
  });
  expect(html).toContain('Foundation for Title topic');
  expect(html).not.toContain('View more');
});

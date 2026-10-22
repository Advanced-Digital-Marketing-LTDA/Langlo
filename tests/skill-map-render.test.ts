import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

afterAll(closeRenderServer);

it('renders skill-state counts accessibly beside a proportional segmented bar', async () => {
  const html = await renderSvelte(
    'src/lib/components/SkillProgressBar.svelte',
    {
      title: 'Overall skill progress',
      distribution: {
        total: 5,
        counts: { secure: 2, practising: 1, weak: 1, unknown: 1 },
        segments: [
          { status: 'secure', count: 2, percent: 40 },
          { status: 'practising', count: 1, percent: 20 },
          { status: 'weak', count: 1, percent: 20 },
          { status: 'unknown', count: 1, percent: 20 }
        ]
      }
    }
  );
  expect(html).toContain('Overall skill progress');
  expect(html).toContain('40% Secure');
  expect(html).toContain('2 skills');
  expect(html).toContain('role="img"');
  expect(html).toContain('width:40%');
});

it('explains when there are no available skills to measure', async () => {
  const html = await renderSvelte(
    'src/lib/components/SkillProgressBar.svelte',
    {
      title: 'FR skill progress',
      distribution: {
        total: 0,
        counts: { secure: 0, practising: 0, weak: 0, unknown: 0 },
        segments: []
      }
    }
  );
  expect(html).toContain('No skills available to measure yet');
  expect(html).not.toContain('0% Secure');
});

it('renders language navigation and honest progress loading states', async () => {
  const html = await renderSvelte('src/lib/components/SkillMap.svelte', {
    tracks: [
      {
        language: 'fr',
        level: 'A1',
        catalog: Promise.resolve({}),
        progress: Promise.resolve({
          language: 'fr',
          level: 'A1',
          recommendation: { skillId: 'foundation', reason: 'Start here.' },
          skills: [
            {
              skillId: 'foundation',
              title: 'Foundation',
              level: 'A1',
              available: true,
              status: 'weak',
              prerequisites: [],
              correct: 1,
              incorrect: 1,
              sessions: 1,
              independentItems: 2,
              reason: 'Review this topic.',
              policyVersion: 'grammar-2',
              answers: 2,
              practisedSessions: 1,
              lastPractisedAt: null
            },
            {
              skillId: 'next',
              title: 'Next step',
              level: 'A2',
              available: false,
              status: 'unknown',
              prerequisites: ['foundation'],
              correct: 0,
              incorrect: 0,
              sessions: 0,
              independentItems: 0,
              reason: 'No evidence.',
              policyVersion: 'grammar-2',
              answers: 0,
              practisedSessions: 0,
              lastPractisedAt: null
            }
          ]
        })
      }
    ],
    initialLanguage: 'fr',
    initialSearch: '?language=fr',
    submissionKey: '00000000-0000-4000-8000-000000000001'
  });
  expect(html).toContain('FR');
  expect(html).toContain('Calculating overall skill progress');
  expect(html).toContain('Loading topics');
  expect(html).not.toContain('Unknown');
});

import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

afterAll(closeRenderServer);

const skill = (skillId: string, status: string, overrides = {}) => ({
  skillId,
  title: `Title ${skillId}`,
  level: 'A1',
  status,
  prerequisites: [],
  available: true,
  contentVersionId: `${skillId}@1`,
  practisedSessions: 2,
  answers: 3,
  lastPractisedAt: 100,
  independentItems: 1,
  sessions: 1,
  correct: 0,
  incorrect: 1,
  reason: `Reason ${skillId}`,
  policyVersion: 'grammar-1',
  ...overrides
});

const renderPractice = (overrides = {}) =>
  renderSvelte('src/routes/app/practice/[language]/+page.svelte', {
    data: {
      language: 'fr',
      submissionKey: 'submission-key',
      skills: [
        skill('fr-a1-001', 'weak'),
        skill('fr-a1-002', 'practising', {
          answers: 1,
          practisedSessions: 1
        })
      ],
      recommendations: [
        {
          skillId: 'fr-a1-001',
          status: 'weak',
          practisedSessions: 2,
          answers: 3,
          lastPractisedAt: 100,
          reason: 'Review this topic'
        },
        {
          skillId: 'fr-a1-002',
          status: 'practising',
          practisedSessions: 1,
          answers: 1,
          lastPractisedAt: 200,
          reason: 'Continue practising this topic'
        }
      ],
      dueReviews: [],
      unfinished: null,
      error: null,
      ...overrides
    }
  });

it('shows started topics that need practice and keeps the unscoped start action', async () => {
  const html = await renderPractice();
  expect(html).toContain('Recommended practice');
  expect(html).toContain('Weak');
  expect(html).toContain('Practising');
  expect(html).toContain('Practised 2 times · 3 answers');
  expect(html).toContain('href="/app/learn/fr/lesson/fr-a1-001"');
  expect(html).toContain('All topics');
  expect(html).toContain('Start practice');
  expect(html).toContain('action="?/start"');
});

it('shows an empty state when no started topics need work', async () => {
  const html = await renderPractice({
    skills: [skill('fr-a1-001', 'secure')],
    recommendations: []
  });
  expect(html).toContain('No started topics need work yet');
});

it('shows a recoverable message when progress could not be loaded', async () => {
  const html = await renderPractice({
    skills: [],
    recommendations: [],
    error: 'Try again'
  });
  expect(html).toContain('role="alert"');
  expect(html).toContain('Try again');
  expect(html).not.toContain('No started topics need work yet');
  expect(html).not.toContain('No published skills are available');
});

it('offers Start practice when nothing is unfinished and never Start over', async () => {
  const html = await renderPractice();
  expect(html).toContain('Start practice');
  expect(html).not.toContain('Continue practice');
  expect(html).not.toContain('Start over');
});

it('offers only Continue practice, with a confirmed Start over, once a practice is started', async () => {
  const html = await renderPractice({
    unfinished: { id: 'practice:abc', answered: 2 }
  });
  expect(html).toContain('Continue practice');
  expect(html).not.toContain('Start practice');
  expect(html).toMatch(/2\s+answers so far/);
  expect(html).toContain('action="?/startOver"');
  expect(html).toMatch(/Your answers so\s+far stay in your history/);
});

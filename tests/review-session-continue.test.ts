import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

// A lesson opened from a grammar review leads back to that review once the
// answer needs nothing more, after its difficulty rating when it takes one.

afterAll(closeRenderServer);

const page = 'src/routes/app/learn/[language]/lesson/[skill]/+page.svelte';
const reviewId = 'grammar-review:b0000000-0000-4000-8000-000000000001';
const link = `href="/app/session/${encodeURIComponent(reviewId)}"`;

const feedback = (fields: Record<string, unknown>) => ({
  attemptId: 'attempt-1',
  questionId: 'fr-a1-001@1:q1',
  contentVersionId: 'fr-a1-001@1',
  reportSubmissionKey: 'report-key-2',
  answer: 'suis',
  expectedAnswer: 'suis',
  outcome: 'correct',
  evidenceKind: 'independent',
  receivedHelp: false,
  requiresRating: true,
  rating: null,
  notSure: false,
  ...fields
});

const data = (
  reviewSessionId: string | null,
  answered: Record<string, unknown> | null
) => ({
  language: 'fr',
  returnTo: '/app/learn/fr',
  unavailable: false,
  reportSubmissionKey: 'report-key',
  reviewSessionId,
  exercise: {
    studySessionId: reviewSessionId ?? 'study-a',
    submissionKey: 'answer-key',
    notice: null,
    question: null,
    answered: 1,
    total: 1
  },
  feedback: answered && feedback(answered),
  lesson: {
    skillId: 'fr-a1-001',
    contentVersionId: 'fr-a1-001@1',
    title: 'Être',
    explanation: 'Use être to say who you are.',
    examples: [],
    references: [],
    explanationLanguage: 'en',
    englishFallback: false,
    newerVersionAvailable: false
  }
});

const render = (pageData: ReturnType<typeof data>) =>
  renderSvelte(page, { data: pageData, form: null });

it('offers Continue Review Session after the difficulty rating', async () => {
  const waiting = await render(data(reviewId, {}));
  expect(waiting).toContain('How difficult was it to recall the answer?');
  expect(waiting).not.toContain('Continue Review Session');

  const rated = await render(data(reviewId, { rating: 'good' }));
  expect(rated).toContain('Continue Review Session');
  expect(rated).toContain(link);
  // The link sits at the bottom, after the lesson's report form.
  const reportForm = rated.lastIndexOf('<form');
  expect(reportForm).toBeGreaterThan(-1);
  expect(rated.lastIndexOf('Continue Review Session')).toBeGreaterThan(
    reportForm
  );
});

it('offers it at once when an answer takes no rating', async () => {
  for (const answered of [
    { outcome: 'incorrect' },
    { outcome: 'uncertain', notSure: true },
    { receivedHelp: true },
    { requiresRating: false }
  ])
    expect(await render(data(reviewId, answered))).toContain(link);
});

it('leaves it out before an answer and outside a grammar review', async () => {
  expect(await render(data(reviewId, null))).not.toContain(
    'Continue Review Session'
  );
  expect(await render(data(null, { rating: 'good' }))).not.toContain(
    'Continue Review Session'
  );
});

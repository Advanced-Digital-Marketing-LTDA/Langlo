import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

// The lesson page tells a learner who is finishing an earlier version of a
// lesson that a newer one exists (LANGLO-169).

afterAll(closeRenderServer);

const page = 'src/routes/app/learn/[language]/lesson/[skill]/+page.svelte';

const data = (newerVersionAvailable: boolean) => ({
  language: 'fr',
  unavailable: false,
  reportSubmissionKey: 'report-key',
  exercise: null,
  feedback: null,
  lesson: {
    skillId: 'fr-a1-001',
    contentVersionId: 'fr-a1-001@1',
    title: 'Être',
    explanation: 'Use être to say who you are.',
    examples: [],
    references: [],
    explanationLanguage: 'en',
    englishFallback: false,
    newerVersionAvailable
  }
});

it('shows the updated-lesson notice only when a newer version exists', async () => {
  const withNotice = await renderSvelte(page, {
    data: data(true),
    form: null
  });
  expect(withNotice).toContain('This lesson was updated.');
  expect(withNotice).toMatch(/your\s+next session uses the new one/u);
  const without = await renderSvelte(page, { data: data(false), form: null });
  expect(without).not.toContain('This lesson was updated.');
  expect(without).toContain('Use être to say who you are.');
});

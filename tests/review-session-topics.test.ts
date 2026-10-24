import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

// A grammar review's session page lists only the topics still to review, and
// says so once every topic is answered.

afterAll(closeRenderServer);

const page = 'src/routes/app/session/[id]/+page.svelte';

const data = (mode: string) => ({
  summary: {
    id: 'grammar-review:b0000000-0000-4000-8000-000000000002',
    language: 'fr',
    mode,
    state: 'active',
    answered: 1
  },
  skills: [],
  recommendedSkillId: null
});

it('tells the learner to finish a review once every topic is answered', async () => {
  const review = await renderSvelte(page, {
    data: data('mixed-review'),
    form: null
  });
  expect(review).toMatch(/All topics are answered\.\s+Finish the session/u);
  expect(review).not.toContain('No lessons are published');
  const practice = await renderSvelte(page, {
    data: data('practice'),
    form: null
  });
  expect(practice).toContain('No lessons are published in this track yet.');
  expect(practice).not.toContain('All topics are answered.');
});

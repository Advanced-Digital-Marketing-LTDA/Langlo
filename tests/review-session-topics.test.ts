import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

// A grammar review's session page lists the topics still to review, each
// linking to its lesson within the review. The review finishes by itself once
// every topic is reviewed, so the page never asks the learner to finish it.

afterAll(closeRenderServer);

const page = 'src/routes/app/session/[id]/+page.svelte';
const reviewId = 'grammar-review:b0000000-0000-4000-8000-000000000002';

it('lists the topics still to review, each linking into the review', async () => {
  const html = await renderSvelte(page, {
    data: {
      summary: {
        id: reviewId,
        language: 'fr',
        mode: 'mixed-review',
        state: 'active',
        answered: 1
      },
      skills: [
        {
          skillId: 'fr-a1-002',
          title: 'Nous sommes',
          available: true,
          answered: false,
          reviewed: false
        }
      ],
      recommendedSkillId: null
    },
    form: null
  });
  expect(html).toContain('Choose a topic');
  expect(html).toContain(
    `href="/app/learn/fr/lesson/fr-a1-002?session=${encodeURIComponent(reviewId)}"`
  );
  expect(html).not.toContain('All topics are answered.');
  expect(html).not.toContain('No lessons are published');
});

import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

const page = 'src/routes/app/session/[id]/results/+page.svelte';
const summary = {
  id: 'study-a',
  language: 'fr',
  state: 'completed',
  answered: 1,
  correct: 0,
  incorrect: 1,
  uncertain: 0,
  pending: 0,
  skills: ['fr-articles']
};
const mistake = (status: 'draft' | 'approved' | 'rejected' | null) => ({
  attemptId: 'attempt-a',
  skillId: 'fr-articles',
  prompt: 'Je ___ étudiant.',
  answer: 'suis',
  draftNoteId: status ? 'note-1' : null,
  draftStatus: status
});

afterAll(closeRenderServer);

const render = (status: 'draft' | 'approved' | 'rejected' | null) =>
  renderSvelte(page, {
    data: { summary, mistakes: [mistake(status)] },
    form: null
  });

it('offers the keep form only when no note exists', async () => {
  const html = await render(null);
  expect(html).toContain('Keep as flashcard');
  expect(html).not.toContain('Kept as a draft');
});

it('labels a pending draft and points at decks', async () => {
  const html = await render('draft');
  expect(html).toContain('Kept as a draft');
  expect(html).toContain('Approve it in');
  expect(html).not.toContain('Keep as flashcard');
});

it('reports an approved note instead of calling it a draft', async () => {
  const html = await render('approved');
  expect(html).toContain('Approved as a flashcard');
  expect(html).not.toContain('Kept as a draft');
  expect(html).not.toContain('Keep as flashcard');
});

it('reports a rejected note as final', async () => {
  const html = await render('rejected');
  expect(html).toContain('will not become a flashcard');
  expect(html).not.toContain('Kept as a draft');
  expect(html).not.toContain('Keep as flashcard');
});

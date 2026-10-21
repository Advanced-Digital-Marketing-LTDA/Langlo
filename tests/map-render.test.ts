import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

afterAll(closeRenderServer);

it('renders language tabs and a pending overall map state for enrolled tracks', async () => {
  const pending = new Promise<never>(() => undefined);
  const html = await renderSvelte('src/routes/app/map/+page.svelte', {
    data: {
      initialLanguage: 'de',
      initialSearch: '?language=de',
      submissionKey: '00000000-0000-4000-8000-000000000001',
      tracks: ['de', 'fr'].map((language) => ({
        language,
        level: 'A1',
        catalog: pending,
        progress: pending
      }))
    }
  });
  expect(html).toContain('aria-label="Enrolled languages"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('>German</button>');
  expect(html).toContain('>French</button>');
  expect(html).toContain('DE · starting level A1');
  expect(html).not.toContain('FR · starting level A1');
  expect(html).toContain('Calculating overall skill progress');
  expect(html).toContain('Loading topics…');
});

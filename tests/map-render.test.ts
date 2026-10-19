import { afterAll, expect, it } from 'vitest';
import { closeRenderServer, renderSvelte } from './helpers/render-svelte';

afterAll(closeRenderServer);

it('links each enrolled language to its track on the map', async () => {
  const pending = new Promise<never>(() => undefined);
  const html = await renderSvelte('src/routes/app/map/+page.svelte', {
    data: {
      tracks: ['de', 'fr'].map((language) => ({
        language,
        level: 'A1',
        catalog: pending,
        progress: pending
      }))
    }
  });
  expect(html).toContain('<nav aria-label="Enrolled languages">');
  expect(html).toContain('href="#track-de"');
  expect(html).toContain('href="#track-fr"');
  expect(html).toContain('id="track-de"');
  expect(html).toContain('id="track-fr"');
  expect(html).toContain('DE · starting level A1');
  expect(html).toContain('FR · starting level A1');
  expect(html).toContain('Loading topics…');
  expect(html).toContain('aria-busy="true"');
});

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const appCompose = readFileSync(
  new URL('../compose.yaml', import.meta.url),
  'utf8'
);

it('passes the public GlitchTip DSN into the application container', () => {
  expect(appCompose).toContain(
    'PUBLIC_GLITCHTIP_DSN: ${PUBLIC_GLITCHTIP_DSN:-}'
  );
  expect(appCompose).toContain('PUBLIC_APP_ENV: ${PUBLIC_APP_ENV:-production}');
  expect(appCompose).toContain(
    'PUBLIC_APP_BUILD_SHA: ${PUBLIC_APP_BUILD_SHA:-unknown}'
  );
});

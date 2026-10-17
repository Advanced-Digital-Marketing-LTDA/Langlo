import { expect } from '@playwright/test';
import { test } from './coverage-fixture';

test('reserved private paths retain no-store/noindex headers with trailing slashes', async ({
  request
}) => {
  for (const path of ['/login/', '/recover/', '/reset/', '/app/cards/']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()['cache-control'], path).toBe('private, no-store');
    expect(response.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
    expect(response.headers()['x-correlation-id'], path).toMatch(
      /^[0-9a-f-]{36}$/
    );
  }
});

import { describe, expect, it } from 'vitest';
import { limitRequestBody } from '../src/lib/server/request-body';

describe('request body limits', () => {
  it('reads a small form through a bounded request', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=learner%40example.test'
    });
    const form = await (await limitRequestBody(request)).formData();
    expect(form.get('email')).toBe('learner@example.test');
  });

  it('rejects an oversized form body without Content-Length', async () => {
    const request = new Request('http://localhost/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `value=${'x'.repeat(512 * 1024)}`
    });
    await expect(limitRequestBody(request, 8)).rejects.toMatchObject({
      code: 'REQUEST_BODY_TOO_LARGE'
    });
  });
});

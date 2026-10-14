import { expect, it } from 'vitest';
import { authRequestHeaders } from '../src/lib/server/auth-request';

it('uses the adapter address even when clients supply forged IP headers', () => {
  const headers = authRequestHeaders({
    request: new Request('http://localhost/api/auth/sign-up/email', {
      headers: {
        'x-forwarded-for': '192.0.2.99',
        'x-langlo-client-address': '192.0.2.98',
        cookie: 'synthetic-session',
        origin: 'http://localhost'
      }
    }),
    getClientAddress: () => '192.0.2.10'
  });
  expect(headers.get('x-langlo-client-address')).toBe('192.0.2.10');
  expect(headers.get('cookie')).toBe('synthetic-session');
  expect(headers.get('origin')).toBe('http://localhost');
});

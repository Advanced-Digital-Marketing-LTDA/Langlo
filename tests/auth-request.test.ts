import { afterEach, expect, it, vi } from 'vitest';
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

afterEach(() => vi.unstubAllEnvs());

it.each([
  [undefined, undefined],
  ['', '1'],
  ['x-real-ip', '1'],
  ['x-forwarded-for', '2'],
  ['x-forwarded-for', '1junk']
])(
  'rejects a missing or unsupported production policy (%s, %s)',
  (header, depth) => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('ADDRESS_HEADER', header);
    vi.stubEnv('XFF_DEPTH', depth);
    expect(() =>
      authRequestHeaders({
        request: new Request('https://example.test/api/auth/sign-up/email'),
        getClientAddress: () => '192.0.2.10'
      })
    ).toThrow();
  }
);

it.each(['', 'unknown', '192.0.2.1, 192.0.2.2'])(
  'rejects invalid adapter identity %s',
  (address) => {
    expect(() =>
      authRequestHeaders({
        request: new Request('http://localhost/api/auth/sign-up/email'),
        getClientAddress: () => address
      })
    ).toThrow();
  }
);

it.each(['192.0.2.10', '2001:db8::10'])(
  'accepts the fixed production policy and valid address %s',
  (address) => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('ADDRESS_HEADER', 'x-forwarded-for');
    vi.stubEnv('XFF_DEPTH', '1');
    const headers = authRequestHeaders({
      request: new Request('https://example.test/api/auth/sign-up/email', {
        headers: { 'x-langlo-client-address': '192.0.2.99' }
      }),
      getClientAddress: () => address
    });
    expect(headers.get('x-langlo-client-address')).toBe(address);
  }
);

import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig, ConfigError } from '../src/lib/server/config';

describe('runtime configuration', () => {
  it('rejects the shrunk suffix-host regression localhost.a.example', () => {
    expect(() =>
      parseRuntimeConfig({ APP_ORIGIN: 'http://localhost.a.example:3000' })
    ).toThrow('Invalid APP_ORIGIN');
  });
  it('disables unconfigured data without provider credentials', () => {
    expect(parseRuntimeConfig({})).toMatchObject({
      environment: 'development',
      origin: 'http://localhost:3000',
      dataEnabled: false
    });
  });
  it.each(['yes', '', '1', 'TRUE'])(
    'rejects malformed feature flag %s',
    (value) => {
      expect(() => parseRuntimeConfig({ DATA_ENABLED: value })).toThrow(
        ConfigError
      );
    }
  );
  it('rejects invalid production origin without disclosing the supplied value', () => {
    const secret =
      'https://synthetic-user:synthetic-password@langlo.app/reset?token=synthetic-query#synthetic-fragment';
    expect(() =>
      parseRuntimeConfig({ APP_ENV: 'production', APP_ORIGIN: secret })
    ).toThrow('Invalid APP_ORIGIN');
    try {
      parseRuntimeConfig({ APP_ENV: 'production', APP_ORIGIN: secret });
    } catch (error) {
      expect(String(error)).toBe('ConfigError: Invalid APP_ORIGIN');
    }
  });
  it.each(['https://langlo.app', 'https://example.org'])(
    'requires loopback origin outside production: %s',
    (origin) => {
      expect(() => parseRuntimeConfig({ APP_ORIGIN: origin })).toThrow(
        ConfigError
      );
    }
  );
  it('requires explicit production origin and complete enabled database config', () => {
    expect(() => parseRuntimeConfig({ APP_ENV: 'production' })).toThrow(
      'Invalid APP_ORIGIN'
    );
    expect(() => parseRuntimeConfig({ DATA_ENABLED: 'true' })).toThrow(
      'Invalid DATABASE_URL'
    );
    expect(() =>
      parseRuntimeConfig({
        DATA_ENABLED: 'true',
        DATABASE_URL: 'libsql://db.example'
      })
    ).toThrow('Invalid APP_ENV');
  });
  it('accepts local SQLite only when data is explicitly enabled', () => {
    expect(
      parseRuntimeConfig({
        DATA_ENABLED: 'true',
        DATABASE_URL: 'file:./.fixtures/local.db',
        BETTER_AUTH_SECRET: 'a'.repeat(40)
      }).dataEnabled
    ).toBe(true);
  });
  it('omits remote credentials from a selected local SQLite config', () => {
    expect(
      parseRuntimeConfig({
        DATA_ENABLED: 'true',
        DATABASE_URL: 'file:./.fixtures/local.db',
        TURSO_AUTH_TOKEN: 'synthetic-unused-token',
        BETTER_AUTH_SECRET: 'a'.repeat(40)
      }).databaseToken
    ).toBeUndefined();
  });
  it('returns only a trimmed token for a validated remote libSQL config', () => {
    expect(
      parseRuntimeConfig({
        APP_ENV: 'production',
        APP_ORIGIN: 'https://langlo.app',
        DATA_ENABLED: 'true',
        DATABASE_URL: 'libsql://dedicated.example',
        TURSO_AUTH_TOKEN: '  synthetic-remote-token\n',
        BETTER_AUTH_SECRET: 'b'.repeat(40)
      }).databaseToken
    ).toBe('synthetic-remote-token');
  });
  it.each([undefined, '', ' \t\n'])(
    'rejects an absent or blank production origin without leaking its value',
    (APP_ORIGIN) => {
      expect(() =>
        parseRuntimeConfig({ APP_ENV: 'production', APP_ORIGIN })
      ).toThrow('Invalid APP_ORIGIN');
    }
  );
  it('requires a token for selected production libSQL without emitting it', () => {
    expect(() =>
      parseRuntimeConfig({
        APP_ENV: 'production',
        APP_ORIGIN: 'https://langlo.app',
        DATA_ENABLED: 'true',
        DATABASE_URL: 'libsql://dedicated.example'
      })
    ).toThrow('Invalid TURSO_AUTH_TOKEN');
  });
});

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
        TURSO_AUTH_TOKEN_2: 'synthetic-unused-token',
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
        TURSO_AUTH_TOKEN_2: '  synthetic-remote-token\n',
        BETTER_AUTH_SECRET: 'b'.repeat(40),
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'ops@langlo.app',
        PROTON_SMTP_TOKEN: 'synthetic-smtp-token'
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
    ).toThrow('Invalid TURSO_AUTH_TOKEN_2');
  });
  it('requires the new token name even when the old variable is set', () => {
    const env = {
      APP_ENV: 'production',
      APP_ORIGIN: 'https://langlo.app',
      DATA_ENABLED: 'true',
      DATABASE_URL: 'libsql://dedicated.example',
      BETTER_AUTH_SECRET: 'b'.repeat(40),
      TURSO_AUTH_TOKEN: 'synthetic-legacy-token'
    };
    expect(() => parseRuntimeConfig(env)).toThrow('Invalid TURSO_AUTH_TOKEN_2');
    expect(
      parseRuntimeConfig({
        ...env,
        TURSO_AUTH_TOKEN_2: 'synthetic-current-token'
      }).databaseToken
    ).toBe('synthetic-current-token');
  });
  it('defaults to capture mail outside production', () => {
    expect(
      parseRuntimeConfig({
        DATA_ENABLED: 'true',
        DATABASE_URL: 'file:./.fixtures/local.db',
        BETTER_AUTH_SECRET: 'a'.repeat(40)
      }).auth?.mail?.transport
    ).toBe('capture');
  });
  it('ignores SMTP-only settings when recovery uses capture', () => {
    const config = parseRuntimeConfig({
      DATA_ENABLED: 'true',
      DATABASE_URL: 'file:./.fixtures/local.db',
      BETTER_AUTH_SECRET: 'a'.repeat(40),
      MAIL_TRANSPORT: 'capture',
      SMTP_HOST: 'synthetic-user:synthetic-secret@bad-host',
      SMTP_PORT: 'invalid-port'
    });
    expect(config.auth?.mail?.transport).toBe('capture');
    expect(config.auth?.mailError).toBeUndefined();
  });
  it('keeps auth available when production SMTP configuration is incomplete', () => {
    const production = {
      APP_ENV: 'production',
      APP_ORIGIN: 'https://langlo.app',
      DATA_ENABLED: 'true',
      DATABASE_URL: 'libsql://dedicated.example',
      TURSO_AUTH_TOKEN_2: 'synthetic-remote-token',
      BETTER_AUTH_SECRET: 'b'.repeat(40)
    };
    expect(parseRuntimeConfig(production).auth?.mailError?.variable).toBe(
      'MAIL_TRANSPORT'
    );
    expect(
      parseRuntimeConfig({ ...production, MAIL_TRANSPORT: 'capture' }).auth
        ?.mailError?.variable
    ).toBe('MAIL_TRANSPORT');
    expect(
      parseRuntimeConfig({
        ...production,
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'ops@langlo.app',
        PROTON_SMTP_TOKEN: 'synthetic-smtp-token'
      }).auth?.mail?.transport
    ).toBe('smtp');
    expect(
      parseRuntimeConfig({
        ...production,
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'ops@langlo.app',
        PROTON_SMTP_TOKEN: 'synthetic-smtp-token',
        SMTP_HOST: 'SMTP.ProtonMail.ch'
      }).auth?.mail?.smtpHost
    ).toBe('SMTP.ProtonMail.ch');
  });
  it('isolates bad SMTP settings to recovery while retaining validated data and auth', () => {
    const config = parseRuntimeConfig({
      APP_ENV: 'production',
      APP_ORIGIN: 'https://langlo.app',
      DATA_ENABLED: 'true',
      DATABASE_URL: 'libsql://dedicated.example',
      TURSO_AUTH_TOKEN_2: 'synthetic-remote-token',
      BETTER_AUTH_SECRET: 'b'.repeat(40),
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'Langlo <ops@langlo.app>',
      PROTON_SMTP_TOKEN: 'synthetic-smtp-token'
    });
    expect(config.dataEnabled).toBe(true);
    expect(config.auth?.secret).toBe('b'.repeat(40));
    expect(config.auth?.mail).toBeUndefined();
    expect(config.auth?.mailError?.variable).toBe('MAIL_FROM');
  });
});

describe('TypeSafe API key', () => {
  // Built at runtime so no secret-looking literal is committed.
  const syntheticKey = [
    'typesafe',
    'synthetic',
    'test',
    'key',
    '0'.repeat(12)
  ].join('-');
  const enabled = {
    DATA_ENABLED: 'true',
    DATABASE_URL: 'file:./.fixtures/dev.db',
    BETTER_AUTH_SECRET: 'synthetic-secret-synthetic-secret-0000'
  };
  it('is optional', () => {
    expect(parseRuntimeConfig(enabled).typesafeApiKey).toBeUndefined();
    expect(
      parseRuntimeConfig({ ...enabled, TYPESAFE_API_KEY: '' }).typesafeApiKey
    ).toBeUndefined();
  });
  it('is kept when set', () => {
    const key = syntheticKey;
    expect(
      parseRuntimeConfig({ ...enabled, TYPESAFE_API_KEY: key }).typesafeApiKey
    ).toBe(key);
  });
  it.each([
    ` ${syntheticKey}`,
    'short',
    syntheticKey.replace('-test-', ' test ')
  ])(
    'keeps the app up and records the error for %j without echoing it',
    (value) => {
      const config = parseRuntimeConfig({
        ...enabled,
        TYPESAFE_API_KEY: value
      });
      expect(config.typesafeApiKeyError).toBeInstanceOf(ConfigError);
      expect(config.typesafeApiKeyError?.message).toBe(
        'Invalid TYPESAFE_API_KEY'
      );
      expect(config.typesafeApiKeyError?.variable).toBe('TYPESAFE_API_KEY');
      expect(config.typesafeApiKey).toBeUndefined();
      expect(config.dataEnabled).toBe(true);
      expect(JSON.stringify(config)).not.toContain(value);
    }
  );
  it('is not read while data is disabled', () => {
    expect(
      parseRuntimeConfig({ TYPESAFE_API_KEY: 'short' }).typesafeApiKeyError
    ).toBeUndefined();
  });
});

describe('OpenAI API key', () => {
  const key = ['openai', 'synthetic', 'test', '0'.repeat(12)].join('-');
  const enabled = {
    DATA_ENABLED: 'true',
    DATABASE_URL: 'file:./.fixtures/dev.db',
    BETTER_AUTH_SECRET: 'synthetic-secret-synthetic-secret-0000'
  };

  it('is optional and kept only in private runtime config', () => {
    expect(parseRuntimeConfig(enabled).openAiApiKey).toBeUndefined();
    expect(
      parseRuntimeConfig({ ...enabled, OPENAI_API_KEY: key }).openAiApiKey
    ).toBe(key);
    expect(
      parseRuntimeConfig({ ...enabled, OPENAI_API_KEY: key })
    ).not.toHaveProperty('publicOpenAiApiKey');
  });

  it('disables Library AI for malformed values without echoing the value', () => {
    const value = ` ${key}`;
    const config = parseRuntimeConfig({ ...enabled, OPENAI_API_KEY: value });
    expect(config.openAiApiKey).toBeUndefined();
    expect(config.openAiApiKeyError?.variable).toBe('OPENAI_API_KEY');
    expect(JSON.stringify(config)).not.toContain(value);
  });
});

import { tmpdir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

const temporaryRoot = resolve(tmpdir());

/** Absolute, already-resolved path strictly inside the system temporary directory. */
const isContainedTemporaryPath = (value: string) =>
  isAbsolute(value) &&
  resolve(value) === value &&
  value.startsWith(temporaryRoot + sep);

/** Test-only escape hatch: disposable file databases under the system temp dir. */
const isTemporaryFileUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'file:' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (url.hostname !== '' && url.hostname !== 'localhost')
    )
      return false;
    const path = decodeURIComponent(url.pathname);
    return isContainedTemporaryPath(path) && /\.(db|sqlite)$/.test(path);
  } catch {
    return false;
  }
};

export class ConfigError extends Error {
  /** Name the invalid variable, never its supplied value; parser callers use fixed names. */
  constructor(variable: string) {
    super(`Invalid ${variable}`);
    this.name = 'ConfigError';
  }
}

export interface AuthMailConfig {
  transport: 'capture' | 'smtp';
  from?: string;
  smtpHost: string;
  smtpPort: number;
  protonSmtpToken?: string;
  captureDir?: string;
}

export interface AuthRuntimeConfig {
  secret: string;
  mail: AuthMailConfig;
}

export interface RuntimeConfig {
  environment: 'development' | 'test' | 'production';
  origin: string;
  dataEnabled: boolean;
  databaseUrl?: string;
  databaseToken?: string;
  revision: string;
  auth?: AuthRuntimeConfig;
}

/** Validate private runtime metadata without connecting to a provider; retain credentials only for selected remote libSQL. */
export function parseRuntimeConfig(
  env: Record<string, string | undefined>
): RuntimeConfig {
  const environment = env.APP_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment))
    throw new ConfigError('APP_ENV');
  const rawOrigin =
    env.APP_ORIGIN ??
    (environment === 'production' ? '' : 'http://localhost:3000');
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new ConfigError('APP_ORIGIN');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (environment === 'production'
      ? url.protocol !== 'https:'
      : !local || url.protocol !== 'http:')
  ) {
    throw new ConfigError('APP_ORIGIN');
  }
  const rawEnabled = env.DATA_ENABLED ?? 'false';
  if (!['true', 'false'].includes(rawEnabled))
    throw new ConfigError('DATA_ENABLED');
  const dataEnabled = rawEnabled === 'true';
  const databaseUrl = env.DATABASE_URL;
  let databaseToken: string | undefined;
  if (dataEnabled) {
    if (!databaseUrl) throw new ConfigError('DATABASE_URL');
    if (databaseUrl.startsWith('libsql://')) {
      if (environment !== 'production') throw new ConfigError('APP_ENV');
      let target: URL;
      try {
        target = new URL(databaseUrl);
      } catch {
        throw new ConfigError('DATABASE_URL');
      }
      if (
        !target.hostname ||
        target.username ||
        target.password ||
        target.search ||
        target.hash ||
        !['', '/'].includes(target.pathname)
      )
        throw new ConfigError('DATABASE_URL');
      databaseToken = env.TURSO_AUTH_TOKEN?.trim();
      if (!databaseToken) throw new ConfigError('TURSO_AUTH_TOKEN');
    } else if (!/^file:\.\/\.fixtures\/[a-zA-Z0-9_-]+\.db$/.test(databaseUrl)) {
      if (environment !== 'test' || !isTemporaryFileUrl(databaseUrl))
        throw new ConfigError('DATABASE_URL');
    } else if (environment === 'production') {
      throw new ConfigError('DATABASE_URL');
    }
  }
  const revision = env.APP_BUILD_SHA ?? 'unknown';
  if (revision !== 'unknown' && !/^[a-f0-9]{40}$/.test(revision))
    throw new ConfigError('APP_BUILD_SHA');
  return {
    environment: environment as RuntimeConfig['environment'],
    origin: url.origin,
    dataEnabled,
    databaseUrl: dataEnabled ? databaseUrl : undefined,
    databaseToken,
    revision,
    auth: dataEnabled ? parseAuthConfig(env) : undefined
  };
}

const emailPattern = /^[^\s@]{1,254}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

/** Auth exists only when data is enabled; secret/mail rules follow the selected transport. */
function parseAuthConfig(
  env: Record<string, string | undefined>
): AuthRuntimeConfig {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new ConfigError('BETTER_AUTH_SECRET');
  const rawTransport = env.MAIL_TRANSPORT ?? 'capture';
  if (!['capture', 'smtp'].includes(rawTransport))
    throw new ConfigError('MAIL_TRANSPORT');
  const transport = rawTransport as AuthMailConfig['transport'];
  const smtpHost = env.SMTP_HOST ?? 'smtp.protonmail.ch';
  let hostUrl: URL;
  try {
    hostUrl = new URL(`smtp://${smtpHost}`);
  } catch {
    throw new ConfigError('SMTP_HOST');
  }
  if (
    hostUrl.username ||
    hostUrl.password ||
    (hostUrl.pathname !== '/' && hostUrl.pathname !== '') ||
    hostUrl.search ||
    hostUrl.hash ||
    hostUrl.hostname !== smtpHost ||
    !/^[a-zA-Z0-9.-]+$/.test(smtpHost)
  )
    throw new ConfigError('SMTP_HOST');
  const rawPort = env.SMTP_PORT ?? '587';
  if (!/^[0-9]{1,5}$/.test(rawPort)) throw new ConfigError('SMTP_PORT');
  const smtpPort = Number(rawPort);
  if (!Number.isSafeInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    throw new ConfigError('SMTP_PORT');
  const mail: AuthMailConfig = { transport, smtpHost, smtpPort };
  if (transport === 'smtp') {
    const from = env.MAIL_FROM?.trim();
    if (!from || !emailPattern.test(from)) throw new ConfigError('MAIL_FROM');
    const token = env.PROTON_SMTP_TOKEN?.trim();
    if (!token) throw new ConfigError('PROTON_SMTP_TOKEN');
    mail.from = from;
    mail.protonSmtpToken = token;
  } else {
    const captureDir = env.MAIL_CAPTURE_DIR?.trim();
    if (captureDir) {
      if (!isContainedTemporaryPath(captureDir))
        throw new ConfigError('MAIL_CAPTURE_DIR');
      mail.captureDir = captureDir;
    }
  }
  return { secret, mail };
}

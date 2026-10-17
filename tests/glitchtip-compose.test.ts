import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const compose = readFileSync(
  new URL('../ops/glitchtip/compose.yaml', import.meta.url),
  'utf8'
);

it('requires Coolify secrets and configures Proton mail and persistent services', () => {
  expect(compose).toContain(
    'GLITCHTIP_DOMAIN: https://${GLITCHTIP_HOSTNAME:?Set GLITCHTIP_HOSTNAME in Coolify}'
  );
  expect(compose).toContain(
    'ALLOWED_HOSTS: ${GLITCHTIP_HOSTNAME:?Set GLITCHTIP_HOSTNAME in Coolify}'
  );
  expect(compose).toContain(
    'CSRF_TRUSTED_ORIGINS: https://${GLITCHTIP_HOSTNAME:?Set GLITCHTIP_HOSTNAME in Coolify}'
  );
  expect(compose).toContain(
    'GLITCHTIP_POSTGRES_PASSWORD:?Set GLITCHTIP_POSTGRES_PASSWORD in Coolify'
  );
  expect(compose).toContain(
    'GLITCHTIP_SECRET_KEY:?Set GLITCHTIP_SECRET_KEY in Coolify'
  );
  expect(compose).toContain('EMAIL_URL:?Set Proton SMTP EMAIL_URL in Coolify');
  expect(compose).toContain(
    'DEFAULT_FROM_EMAIL:?Set DEFAULT_FROM_EMAIL in Coolify'
  );
  expect(compose).toContain('postgres-data:/var/lib/postgresql');
  expect(compose).toContain('uploads:/code/uploads');
  expect(compose).toContain("GLITCHTIP_ENABLE_DUCKDB: 'True'");
  expect(compose).toContain(
    'GLITCHTIP_COLD_STORAGE_DIR: /code/uploads/cold-storage'
  );
});

it('keeps registration restricted and all configured data retention at 30 days', () => {
  expect(compose).toContain("ENABLE_USER_REGISTRATION: 'False'");
  expect(compose).toContain("ENABLE_ORGANIZATION_CREATION: 'False'");
  expect(compose).toContain("ENABLE_ADMIN: 'False'");
  expect(compose).toContain("ENABLE_OPENAPI: 'False'");
  expect(compose).toContain("GLITCHTIP_RETENTION_DAYS: '30'");
  expect(compose).toContain("GLITCHTIP_EVENT_RETENTION_DAYS: '30'");
  expect(compose).toContain("GLITCHTIP_TRANSACTION_RETENTION_DAYS: '30'");
  expect(compose).toContain("GLITCHTIP_FILE_RETENTION_DAYS: '30'");
  expect(compose).toContain("GLITCHTIP_RELEASE_RETENTION_DAYS: '30'");
});

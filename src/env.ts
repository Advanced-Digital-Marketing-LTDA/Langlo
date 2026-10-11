import { defineEnvVars } from '@sveltejs/kit/env';

// All variables are dynamic and private. Validation happens at the request boundary.
export const variables = defineEnvVars({
  APP_ENV: { schema: (value) => value },
  APP_ORIGIN: { schema: (value) => value },
  DATA_ENABLED: { schema: (value) => value },
  DATABASE_URL: { schema: (value) => value },
  TURSO_AUTH_TOKEN: { schema: (value) => value },
  APP_BUILD_SHA: { schema: (value) => value },
  BETTER_AUTH_SECRET: { schema: (value) => value },
  MAIL_TRANSPORT: { schema: (value) => value },
  MAIL_FROM: { schema: (value) => value },
  PROTON_SMTP_TOKEN: { schema: (value) => value },
  SMTP_HOST: { schema: (value) => value },
  SMTP_PORT: { schema: (value) => value },
  MAIL_CAPTURE_DIR: { schema: (value) => value }
});

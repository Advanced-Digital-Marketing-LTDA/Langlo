import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';
import {
  e2eAuthOrigin,
  e2eAuthPort,
  mailCaptureDirectory
} from './tests/fixtures/e2e-auth-mail.ts';

export default {
  agents: {
    default: {
      model: chatgpt('gpt-6-luna'),
      system: 'You are a thorough QA agent. Verify every outcome.'
    }
  },
  targets: [
    {
      engine: web(),
      app: {
        url: e2eAuthOrigin,
        command: {
          executable: 'node',
          args: ['tests/fixtures/e2e-auth-server.ts'],
          env: {
            HOST: '127.0.0.1',
            PORT: e2eAuthPort,
            APP_ENV: 'test',
            APP_ORIGIN: e2eAuthOrigin,
            MAIL_CAPTURE_DIR: mailCaptureDirectory
          },
          log: '.e2e/logs/app.log'
        }
      }
    }
  ],
  credentials: {
    learner: {
      username: 'e2e@example.test',
      password: 'e2e-password-0000'
    }
  }
} satisfies E2EConfig;

import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';

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
        url: 'http://localhost:4173',
        command: {
          executable: 'node',
          args: ['tests/fixtures/e2e-auth-server.ts'],
          env: {
            HOST: '127.0.0.1',
            PORT: '4173',
            APP_ENV: 'test',
            APP_ORIGIN: 'http://localhost:4173'
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

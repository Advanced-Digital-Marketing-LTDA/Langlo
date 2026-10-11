import type { RuntimeConfig } from './lib/server/config';

declare global {
  namespace App {
    interface Locals {
      correlationId: string;
      config?: RuntimeConfig;
      user?: { id: string; email: string; name: string } | null;
      session?: { id: string; userId: string; expiresAt: Date } | null;
    }
    interface Error {
      message: string;
      correlationId?: string;
    }
  }
}

export {};

import type {
  Client,
  InStatement,
  Transaction,
  TransactionMode
} from '@libsql/client';
import { LibsqlError } from '@libsql/client';
import { setTimeout as delay } from 'node:timers/promises';

// shortcut: remote transactions serialize too; split if throughput proves limiting.
const connectionQueues = new WeakMap<object, Set<() => void>>();

function releaseConnection(client: object, queue: Set<() => void>) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = queue.values().next().value;
    if (next) {
      queue.delete(next);
      next();
    } else {
      connectionQueues.delete(client);
    }
  };
}

function acquireConnection(client: object): Promise<() => void> {
  const active = connectionQueues.get(client);
  if (!active) {
    const queue = new Set<() => void>();
    connectionQueues.set(client, queue);
    return Promise.resolve(releaseConnection(client, queue));
  }
  return new Promise((resolve, reject) => {
    const resume = () => {
      clearTimeout(timer);
      resolve(releaseConnection(client, active));
    };
    const timer = setTimeout(() => {
      // Remove this waiter without releasing another request's active slot.
      active.delete(resume);
      reject(
        new LibsqlError(
          'Timed out waiting for the database connection',
          'SQLITE_BUSY'
        )
      );
    }, 5000);
    active.add(resume);
  });
}

/** Serialize a standalone statement with transactions using the same client. */
export async function executeWrite(
  client: Pick<Client, 'execute'>,
  statement: InStatement | string
) {
  const finish = await acquireConnection(client);
  try {
    return await client.execute(statement);
  } finally {
    finish();
  }
}

function releaseTransaction(transaction: Transaction, finish: () => void) {
  const terminal = {
    commit: async () => {
      try {
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      } finally {
        finish();
      }
    },
    rollback: async () => {
      try {
        await transaction.rollback();
      } finally {
        finish();
      }
    },
    close: () => {
      try {
        transaction.close();
      } finally {
        finish();
      }
    }
  };
  return new Proxy(transaction, {
    get(target, property) {
      if (Object.hasOwn(terminal, property))
        return terminal[property as keyof typeof terminal];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

async function beginTransaction(client: Client, mode: TransactionMode) {
  const finish = await acquireConnection(client);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return releaseTransaction(await client.transaction(mode), finish);
    } catch (error) {
      if (
        (error as { code?: string }).code !== 'SQLITE_BUSY' ||
        attempt === 7
      ) {
        finish();
        throw error;
      }
      // Back off only after the failed attempt finishes, then retry serially.
      await delay(10 * (attempt + 1));
    }
  }
}

export const beginWrite = (client: Client) => beginTransaction(client, 'write');
export const beginRead = (client: Client) => beginTransaction(client, 'read');

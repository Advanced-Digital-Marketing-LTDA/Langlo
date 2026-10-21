import type {
  Client,
  InStatement,
  Transaction,
  TransactionMode
} from '@libsql/client';
import { LibsqlError } from '@libsql/client';
import { setTimeout as delay } from 'node:timers/promises';
import { span } from './tracing';

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
  // Only a real wait gets a span; its absence in a trace means no queueing.
  return span(
    'db.queue-wait',
    () =>
      new Promise<() => void>((resolve, reject) => {
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
      }),
    { waiters: active.size }
  );
}

/**
 * Time how long a transaction holds the connection, which is what other
 * requests wait behind. The span stays open until `end` and reports how many
 * round trips the transaction made (BEGIN and COMMIT not counted).
 */
async function holdSpan(write: boolean) {
  let end!: () => void;
  const held = new Promise<void>((resolve) => {
    end = resolve;
  });
  const active = await new Promise<{
    setAttribute(key: string, value: number): void;
  }>((resolve, reject) => {
    // A span that fails before it starts must fail the caller, not hang it.
    span(
      'db.transaction',
      (current) => {
        resolve(current);
        return held;
      },
      { write }
    ).catch(reject);
  });
  return {
    end: (roundTrips: number) => {
      active.setAttribute('round_trips', roundTrips);
      end();
    }
  };
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

function releaseTransaction(
  transaction: Transaction,
  finish: () => void,
  trips: { count: number }
) {
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
      if (typeof value !== 'function') return value;
      // Every other method (execute, batch, executeMultiple) is one round trip,
      // whether it carries one statement or many.
      return (...args: unknown[]) => {
        trips.count += 1;
        return value.apply(target, args);
      };
    }
  });
}

/** Take the connection and start timing how long it is held. */
async function holdConnection(client: Client, write: boolean) {
  const release = await acquireConnection(client);
  let hold: Awaited<ReturnType<typeof holdSpan>>;
  try {
    hold = await holdSpan(write);
  } catch (error) {
    // The slot is taken: tracing trouble must not leave the connection held.
    release();
    throw error;
  }
  const trips = { count: 0 };
  let finished = false;
  const finish = () => {
    // commit() and the caller's final close() both finish a transaction.
    if (finished) return;
    finished = true;
    hold.end(trips.count);
    release();
  };
  return { finish, trips };
}

async function beginTransaction(client: Client, mode: TransactionMode) {
  const { finish, trips } = await holdConnection(client, mode === 'write');
  for (let attempt = 0; ; attempt += 1) {
    try {
      return releaseTransaction(await client.transaction(mode), finish, trips);
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

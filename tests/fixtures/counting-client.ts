import type { Client, InStatement, Transaction } from '@libsql/client';

// Each database call costs a network round trip in production, so tests count
// the calls a request makes and whether they overlap.

export type Counted = { sqls: string[]; peak: number; together: string[][] };

type Track = <T>(sql: string, run: () => Promise<T>) => Promise<T>;

/** Every call is held for a tick so calls issued together are seen as in flight together. */
function tracker(counted: Counted): Track {
  const active: string[] = [];
  return async (sql, run) => {
    counted.sqls.push(sql);
    active.push(sql);
    counted.peak = Math.max(counted.peak, active.length);
    counted.together.push([...active]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await run();
    } finally {
      active.splice(active.indexOf(sql), 1);
    }
  };
}

export const sqlOf = (statement: InStatement) =>
  typeof statement === 'string' ? statement : statement.sql;

type Override<T> = (base: T) => unknown;

/** The object itself, except for the methods that are replaced. */
export function overriding<T extends object>(
  target: T,
  replaced: Record<string, Override<T>>
): T {
  return new Proxy(target, {
    get(base, property) {
      const replacement =
        typeof property === 'string' ? replaced[property] : undefined;
      if (replacement) return replacement(base);
      const value = Reflect.get(base, property);
      return typeof value === 'function' ? value.bind(base) : value;
    }
  });
}

const statementCalls = <T extends Client | Transaction>(track: Track) => ({
  execute: (base: T) => (statement: InStatement) =>
    track(sqlOf(statement), () => base.execute(statement)),
  batch: (base: T) => (statements: InStatement[]) =>
    track('batch', () => base.batch(statements))
});

export function counting(client: Client, counted: Counted): Client {
  const track = tracker(counted);
  const inTransaction = (tx: Transaction) =>
    overriding(tx, {
      ...statementCalls<Transaction>(track),
      commit: (base) => () => track('commit', () => base.commit())
    });
  return overriding(client, {
    ...statementCalls<Client>(track),
    transaction: (base) => async (mode: 'write' | 'read') => {
      counted.sqls.push('begin');
      return inTransaction(await base.transaction(mode));
    }
  });
}

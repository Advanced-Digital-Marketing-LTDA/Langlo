// A remote client opens a stream per transaction. On the dev Turso database
// (2026-10-21 probe, docs/evidence/remote-reads-skip-queue-20261021.md) a read
// opened beside an open write transaction and saw the earlier snapshot, so a
// read is not queued. That is measured once on one database, not guaranteed:
// if the server answers SQLITE_BUSY, the read fails loudly after its retries.
// Writes still queue: the server serializes writers and ours adds a timeout.
// Kept free of imports so Node scripts that open the database can load it.
const remoteClients = new WeakSet<object>();

/** Mark a client as remote so its read transactions skip the queue. */
export function markRemoteClient(client: object) {
  remoteClients.add(client);
}

export function isRemoteClient(client: object) {
  return remoteClients.has(client);
}

const remoteUrl = /^(libsql|https?|wss?):/i;

/** Whether a database URL points at a remote libSQL server. */
export function isRemoteDatabaseUrl(databaseUrl: string) {
  return remoteUrl.test(databaseUrl);
}

// A remote client opens a stream per transaction: the server isolates snapshot
// reads from the open write transaction, so a read has no reason to queue.
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

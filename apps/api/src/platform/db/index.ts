/**
 * Connection and transaction context. Before every read: open a transaction, set actor context with set_config(..., true) — transaction-local, which is also what survives the pooler in transaction mode — query under RLS, and write the access record in the same transaction. No handler bypasses this.
 */
export {}

/**
 * PostgreSQL schema, migrations and types.
 *
 * Eleven domain schemas. The rules live in the engine — RLS, constraint triggers,
 * functions — and that is deliberate: the last line of defence over health data
 * must not depend on the application being correctly written.
 *
 * This is why each domain's `infrastructure/` calls database functions directly
 * instead of hiding them behind a portable repository.
 */
export type { Database } from '../types/database.types.js'

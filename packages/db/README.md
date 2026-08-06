# @allfitone/db

| Path                       | What it is                                                      |
| -------------------------- | --------------------------------------------------------------- |
| `supabase/config.toml`     | Versioned local-stack configuration                             |
| `supabase/migrations/`     | Single timestamped SQL migration history                        |
| `supabase/seed.sql`        | Development and integration-test data; never schema definitions |
| `supabase/tests/database/` | pgTAP tests for RLS, invariants and physical database behaviour |
| `types/`                   | Types generated from the schema. **Do not edit**                |

This is the standard Supabase CLI layout. Do not create a parallel
`packages/db/migrations` directory. The first real migration will create and
populate `supabase/migrations/`.

Supabase is used **only as PostgreSQL**: no `auth.uid()`, no `anon`/
`authenticated` roles. Standard engine features only. That is what keeps the
database host replaceable with no abstraction in between.

`allfit_api` is the runtime role, and there is exactly one.

Run database commands from the repository root:

```bash
bun run db:start
bun run db:status
bun run db:reset
bun run db:lint
bun run db:test
bun run db:migration:new -- <migration_name>
bun run db:stop
```

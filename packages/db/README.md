# @allfitone/db

| Folder        | What it is                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| `supabase/`   | Local configuration. `supabase start` provides the integration test database |
| `migrations/` | Single migration history, applied by one pipeline                            |
| `types/`      | Types generated from the schema. **Do not edit**                             |

Supabase is used **only as PostgreSQL**: no `auth.uid()`, no `anon`/
`authenticated` roles. Standard engine features only. That is what keeps the
database host replaceable with no abstraction in between.

`allfit_api` is the runtime role, and there is exactly one.

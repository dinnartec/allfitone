# Allfit One

Platform monorepo: the shared API, the worker, the three clients and the common
libraries.

**Read [`AGENTS.md`](./AGENTS.md) before writing code.** It is the working
agreement for everyone, human or AI, and it is normative. This file only covers
how to get the repository running.

Normative product and architecture documentation lives in `allfitone-docs`.

---

## What works today

Be aware of the actual state before you start:

|                                                        |                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `apps/api`                                             | `GET /health` plus the Studio hosted login flow, verified end to end against a real provider environment |
| `apps/worker`                                          | Empty. Starts and exits immediately                                                                      |
| `apps/studio-web`, `apps/backoffice-web`, `apps/space` | Not scaffolded. README only                                                                              |
| `packages/auth-provider`                               | Working. Token verification, code exchange, sessions revocation                                          |
| `packages/queue`                                       | Port defined; the Postgres adapter throws until `system.outbox_events` exists                            |
| `packages/contracts`                                   | Canonical OpenAPI with 18 paths. `generated/` not produced yet                                           |
| `packages/db`                                          | Empty. No migrations, no Supabase config yet                                                             |

Signing in works; **no session is established** and the subject is not resolved to
a person. Both need the schema.

Lint, typecheck, formatting, OpenAPI validation and the git hooks all run. Tests
cover the identity port and the Studio login routes; there are no integration
tests yet, because there is no database to run them against.

## Prerequisites

| Tool                                                 | Version    | Needed for                                |
| ---------------------------------------------------- | ---------- | ----------------------------------------- |
| [Bun](https://bun.sh)                                | 1.2+       | Install, tests, running TS in development |
| Node                                                 | 22+        | Production runtime, and what Vercel runs  |
| Docker                                               | any recent | Local database, once migrations exist     |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | latest     | Integration tests, once migrations exist  |

Docker and the Supabase CLI are not required yet — `packages/db` has no
migrations. Install them when the first vertical slice lands.

## Setup

```bash
git clone git@github.com:dinnartec/allfitone.git
cd allfitone

bun install          # also registers the git hooks via husky
cp .env.example .env.local
```

Fill in `.env.local`. In the WorkOS dashboard each Application has **its own
`client_id` and its own API key** — Space, Studio and Backoffice are three
Applications sharing one user directory. Reusing a single key across them fails
the code exchange with `invalid_client`, and only when somebody tries to sign in.

Those keys are server-side only. They never go into a client bundle.

```bash
bun run dev
```

`apps/api` comes up on `http://localhost:8080`. Check it:

```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

Any other route returns 404 until surfaces are mounted in
`apps/api/src/surfaces.ts`.

## Commands

Run from the repository root. Turbo runs each task across the workspaces and
caches results, so repeat runs are near-instant.

| Command                 | What it does                                 |
| ----------------------- | -------------------------------------------- |
| `bun run dev`           | Starts every app in watch mode               |
| `bun run test`          | Runs tests (`bun test`)                      |
| `bun run lint`          | ESLint, including the boundary rules         |
| `bun run typecheck`     | `tsc --noEmit` across workspaces             |
| `bun run build`         | Builds every deployable                      |
| `bun run format`        | Prettier over the repository                 |
| `bun run check:openapi` | Validates the canonical OpenAPI with Redocly |

For a single workspace, use a filter:

```bash
bun run dev --filter=@allfitone/api
bun run test --filter=@allfitone/auth-provider
```

## Git hooks

Installed by `bun install`. The split keeps pre-commit under about five seconds,
because a slow hook is a bypassed hook.

| Stage        | What runs                                                       |
| ------------ | --------------------------------------------------------------- |
| `pre-commit` | Prettier and ESLint over staged files                           |
| `commit-msg` | commitlint — Conventional Commits in English, closed scope list |
| `pre-push`   | Typecheck and tests                                             |

Commits look like `feat(identity): add contact change verification`. The valid
scopes are listed in `commitlint.config.js`; a typo fails the commit rather than
quietly creating a new scope.

**Never use `--no-verify`.** If a hook fails, fix the cause.

## Layout

```
apps/
  api/            Hono + TypeScript · the four REST surfaces
  worker/         Outbox consumers and scheduled jobs
  studio-web/     Client of /studio/v1
  backoffice-web/ Client of /backoffice/v1
  space/          Expo · client of /space/v1
packages/
  auth-provider/  Port and adapter for the identity provider
  queue/          Port and adapter for the job queue
  contracts/      OpenAPI specification and generated DTOs
  db/             Migrations, schema and types
```

`apps/` are things that **run**. `packages/` are things that get **used**.

Five deployables, one repository, one database. Full reasoning in `AGENTS.md`.

## Architecture in one paragraph

Modular monolith with vertical slices by domain and flat hexagonal layering
inside each slice. `/space/v1`, `/studio/v1`, `/catalog/v1` and `/backoffice/v1`
are four views of the same domain, not four backends. Business rules live in
PostgreSQL — RLS, constraint triggers, functions — because the last line of
defence over health data must not depend on the application being correctly
written. The mandatory counterpart is one door to the database: `allfit_api` is
the only runtime role.

Ports and adapters apply to the identity provider and the queue, not to the
database.

## Boundaries

Enforced in `eslint.config.js`; they fail CI, not code review:

1. Only `packages/auth-provider` imports the identity provider SDK.
2. Only `packages/queue` imports the queue SDK.
3. `packages/` never depends on the hosting provider.
4. An app never imports from another app.
5. A handler never executes SQL.

`AGENTS.md` section 5 documents what these do **not** cover yet.

## Troubleshooting

**Hooks are not running.** Run `bun install`; husky sets `core.hooksPath` from
the `prepare` script. Confirm with `git config core.hooksPath` — it should print
`.husky/_`.

**`Could not resolve workspace` from turbo.** The root `package.json` needs a
`packageManager` field. It is already there; if you changed Bun versions, update
it to match.

**Port 8080 is taken.** Set `PORT` and `API_PUBLIC_URL` in `.env.local`, and make the
redirect URI in the WorkOS dashboard match. On macOS, Docker Desktop often holds 8080.

**`API_PUBLIC_URL is not set` even though `.env.local` exists.** Turbo runs each
task from its own workspace directory, so Bun looks for `apps/api/.env.local` and
not the root one. The `dev` scripts pass `--env-file=../../.env.local` for exactly
this reason; a task added without it will not see the root file.

**Lint passes but you expected an error.** `no-restricted-imports` does not merge
across flat-config blocks — the last matching block wins. Patterns are composed
per scope in `eslint.config.js` for exactly this reason. If you add a rule, prove
it rejects a violating file before trusting it.

## Open items

- Data residency and DPA with the identity provider for health data under Law 1581. The only item that could still invalidate the provider choice.
- How the "this session satisfies AAL2" fact reaches the API. All Backoffice
  authorization depends on it.
- `/space/v1/auth/*` is missing from the OpenAPI contract. Space's headless login
  needs it.
- The contact-change operation is absent from the operations matrix, although its
  events are already declared in the data dictionary.
- `allfitone-docs` is out of date on ownership: it still names a per-product
  repository as owner of `supabase/`, the migrations and the API, never mentions
  `apps/worker`, and — since the contract moved here — its claim that "contracts
  remain in allfitone-docs" is no longer true.

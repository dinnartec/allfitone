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

|                          |                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`               | The four surfaces mounted — `/space/v1`, `/studio/v1`, `/backoffice/v1`, `/catalog/v1` — plus a readiness `GET /health`      |
| `apps/worker`            | Cron-invoked outbox jobs: invitation delivery, Backoffice authentication cleanup and account recovery                        |
| `apps/studio-web`        | Hosted login, profile, organizations and invitations                                                                         |
| `apps/backoffice-web`    | Password and TOTP sign-in; the home panel, people, gyms, catalogue, permissions, team, access log, break glass and diagnosis |
| `apps/space`             | Headless client of `/space/v1`: registration, sign-in and password recovery                                                  |
| `packages/auth-provider` | Token verification, code exchange, TOTP, session revocation and recovery delivery                                            |
| `packages/queue`         | Port and its PostgreSQL adapter over `system.outbox_events`                                                                  |
| `packages/contracts`     | Canonical OpenAPI with 119 paths, and the DTOs generated from it                                                             |
| `packages/db`            | 50 migrations and a pgTAP suite of 1034 assertions                                                                           |

Payments, planning execution and nutrition have no domain yet, so the Backoffice
screens that depend on them say so rather than showing an empty number.

## Prerequisites

| Tool                                                 | Version    | Needed for                                  |
| ---------------------------------------------------- | ---------- | ------------------------------------------- |
| [Bun](https://bun.sh)                                | 1.2+       | Install, tests, running TS in development   |
| Node                                                 | 22+        | Production runtime, and what Vercel runs    |
| Docker                                               | any recent | Local PostgreSQL stack and database tests   |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | 2.110.0    | Migrations, lint, pgTAP and generated types |

The Supabase CLI is installed as a project dependency and must be invoked with
`bunx supabase`; do not rely on a global installation. Docker is required for
local database development and for the database integration checks.

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
# {"status":"ok","checks":{"database":"ok"}}
```

It answers 503 with `"status":"degraded"` when PostgreSQL does not answer: the API
serves no route without it, so a probe that only proved the process was alive would
send traffic into an outage.

Any other route returns 404 until surfaces are mounted in
`apps/api/src/surfaces.ts`.

Studio runs at `http://localhost:3000` and Backoffice at `http://localhost:3001`.
The API follows `PORT` (8080 by default) and the worker `WORKER_PORT` (8090), which
is why they are separate variables: both read the same `.env.local`, so a single
`PORT` would put the second process on a port already taken.

`bun run dev` also starts Space, whose Metro bundler wants 8081. To work on one
product, start only what it needs:

```bash
bun run dev --filter=@allfitone/api --filter=@allfitone/backoffice-web
```

### Signing in to Backoffice locally

Backoffice authorises against PostgreSQL, not against the token, so a fresh
database has nobody who can sign in — and the `allfit_admin` grant is a
two-person ceremony precisely so that no operator can appoint themselves.

Create the user in the WorkOS **Backoffice** Application, copy its user id, and
run the ceremony against the local database:

```bash
bun --env-file=.env.local packages/db/scripts/bootstrap-local-operator.ts \
  --subject user_01YOURID --given-name Jimmy --family-name Rozo
```

It grants `allfit_admin` to you and to a local witness, then has the witness grant
you every duty through the same command **Equipo de Allfit** calls. The witness is
not a shortcut: a duty is never self-assigned, so on a database with one real
operator somebody else has to sign the grant. Pass `--duties a,b` to grant fewer.
It refuses any database that is not on this machine. Sign in at
`http://localhost:3001` and enrol TOTP.

Duties are temporary by design — 30 days here — and every Backoffice screen
refuses an operator whose duty expired, so "it worked yesterday" is the expected
experience, not a bug. Run the script again: it leaves you as you are and grants
only what is no longer in force.

Backoffice reads what Studio and Space write, so a local database that never ran
them shows empty screens. This fills that in, through the real commands wherever
one exists, and refuses any database that is not local:

```bash
bun packages/db/scripts/seed-local-demo.ts
```

It leaves a gym with a live and a lapsed team invitation, three people — one
without a verified email, so recovery fails closed as it should — and a
credential waiting in the verification queue. Everything it writes is named
`Demo`, and running it twice changes nothing.

## Commands

Run from the repository root. Turbo runs each task across the workspaces and
caches results, so repeat runs are near-instant.

| Command                   | What it does                                          |
| ------------------------- | ----------------------------------------------------- |
| `bun run dev`             | Starts every app in watch mode                        |
| `bun run test`            | Runs tests (`bun test`)                               |
| `bun run lint`            | ESLint, including the boundary rules                  |
| `bun run typecheck`       | `tsc --noEmit` across workspaces                      |
| `bun run build`           | Builds every deployable                               |
| `bun run format`          | Prettier over the repository                          |
| `bun run check:openapi`   | Validates the canonical OpenAPI with Redocly          |
| `bun run check:db-policy` | Validates migration history, names, seeds and secrets |
| `bun run db:reset`        | Rebuilds the local database from migrations           |
| `bun run db:test`         | Runs the database pgTAP suite                         |
| `bun run check:db-types`  | Verifies generated database types                     |

For a single workspace, use a filter:

```bash
bun run dev --filter=@allfitone/api
bun run test --filter=@allfitone/auth-provider
```

## Web deployments on Vercel

Create one Vercel project per web app from this same repository. Keep the build
and install commands on their detected defaults; the root `bun.lock` and
`packageManager` field make Vercel use Bun.

| Vercel project         | Root Directory        | Production domain       |
| ---------------------- | --------------------- | ----------------------- |
| `allfitone-studio`     | `apps/studio-web`     | `studio.allfit.one`     |
| `allfitone-backoffice` | `apps/backoffice-web` | `backoffice.allfit.one` |

For both projects:

- Set the production branch to `main`.
- Set `NEXT_PUBLIC_API_URL=https://api.allfit.one` for Production.
- Enable **Include source files outside of the Root Directory** so workspace
  packages remain available.
- Keep Vercel's **Skip deployments when there are no changes** optimization
  enabled; Turbo determines whether the selected workspace is affected.

Reserve `allfit.one` for the public product or marketing site. Point the two app
subdomains to their Vercel projects after adding them under **Settings →
Domains**. The API project must use `API_PUBLIC_URL=https://api.allfit.one`,
`STUDIO_WEB_URL=https://studio.allfit.one`, and
`BACKOFFICE_WEB_URL=https://backoffice.allfit.one` in Production.

The API runtime also requires a Supavisor transaction-pooler `DATABASE_URL` for
the `allfit_api` role and a 32-byte base64 `SESSION_ENCRYPTION_KEY`. Keep staging
and production values separate. Database migrations are deployed only through
the protected GitHub workflow documented in
[`allfitone-docs/platform/database/OPERATIONS.md`](https://github.com/dinnartec/allfitone-docs/blob/main/platform/database/OPERATIONS.md).

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

**`bun run db:test` fails after seeding demo data.** A few pgTAP assertions count
rows across the whole database, so whatever the demo seed or the bootstrap left
behind shifts them. Run `bun run db:reset` first — that is the database CI builds,
and the one the result is about.

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

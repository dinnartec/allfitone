# AGENTS.md

Working agreement for every contributor to this repository, human or AI.

This file is normative. If your instinct conflicts with something here, this file
wins. If this file conflicts with `allfitone-docs`, that repository wins — see
[Source of truth](#16-source-of-truth).

---

## 1. What this project is

Allfit One is a fitness platform with two products and one back office:

| Product               | Users                   | Surface          |
| --------------------- | ----------------------- | ---------------- |
| **Allfit Space**      | People who train        | `/space/v1`      |
| **Allfit Studio**     | Trainers, gyms, studios | `/studio/v1`     |
| **Allfit Backoffice** | Allfit's own staff      | `/backoffice/v1` |

**It handles health data.** Body measurements, health context, nutrition logs.
Under Colombian Law 1581 and Decree 1377 this is sensitive personal data, and the
system is designed to GDPR level.

That single fact drives most of the rules below. When a rule looks
disproportionate, this is why.

### Non-negotiables

1. A person owns their data. The platform never acts as them.
2. Every authorized read is logged before content is returned. If the audit write
   fails, the read does not happen.
3. Authorization fails closed. Absence of proof is denial, never a default allow.
4. Security boundaries live in PostgreSQL, not in application code.

---

## 2. Architecture

**Modular monolith with vertical slices by domain and flat hexagonal layering
inside each slice.**

Ports and adapters apply to the identity provider and the queue. They do **not**
apply to the database — see [Database](#8-database).

### Two independent axes

Do not conflate these:

- **Repository** — where code lives. One monorepo.
- **Deployable** — what ships as a unit. Five of them.

One repository producing five deployables is the normal case, not a compromise.

| Deployable       | Source                | How it ships                    |
| ---------------- | --------------------- | ------------------------------- |
| `api`            | `apps/api`            | Vercel Functions (Node runtime) |
| `worker`         | `apps/worker`         | Cron-invoked consumers          |
| `studio-web`     | `apps/studio-web`     | Web build                       |
| `backoffice-web` | `apps/backoffice-web` | Web build                       |
| `space`          | `apps/space`          | EAS Build to app stores         |

### One backend, four surfaces

`/space/v1`, `/studio/v1`, `/catalog/v1` and `/backoffice/v1` are different views
of the same domain, not different backends.

Every product flow crosses products: the professional assigns in Studio, the
person executes in Space, the result returns to Studio. Splitting the backend by
product would cut along the line of highest coupling.

If a split is ever needed, it happens **by domain** and only on measured evidence
— SLO, regulation, scale, or demonstrated incidents.

---

## 3. Repository layout

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

`apps/` are things that **run**. `packages/` are things that get **used**. If it
has no meaningful "start", it is a package.

Outside this repository: `allfitone-docs` (normative documentation) and
`allfitone-design-system` (published UI library).

---

## 4. Domain module anatomy

```
domains/<domain>/
  domain/           entities, value types, domain errors
  application/      use cases — the logic lives here
  infrastructure/   PostgreSQL access and database function calls
  handlers/         HTTP routes, grouped by surface
  dependencies.ts   module composition
  index.ts          public interface — the only entry point
```

### Rules

1. `handlers/` never executes SQL and never opens a connection. It calls
   `application/`.
2. `application/` knows nothing about HTTP. Data in, data out.
3. One domain reaches another **only through its `index.ts`**, never into its
   internals. This mirrors the database rule: no domain writes another domain's
   tables.
4. All four surfaces share the same use cases. What differs between
   `handlers/space.ts` and `handlers/studio.ts` is the projection, not the rule.

### Layer depth is per module, not uniform

`identity` will grow and earn its layers. `catalog` may stay flat forever. Keep
each module as flat as it can be; promote a file to a folder when it exceeds
roughly ten files. Do not create empty structure in anticipation.

### The eleven schemas, and what is not a domain

Domains: `identity`, `organizations`, `relationships`, `privacy`, `catalog`,
`planning`, `execution`, `nutrition`, `payments`, `support`.

- **`system`** (outbox, idempotency keys, job runs) is infrastructure. It lives in
  `platform/outbox` and `platform/idempotency`.
- **Privacy enforcement** — checking grants, writing the access record inside the
  read transaction — is invoked by every domain on every read, so it lives in
  `platform/privacy`. Consent **management** is a domain and lives in
  `domains/privacy`.

Create a domain module when it has code. Not before.

---

## 5. Boundaries

Five rules live in `eslint.config.js`. They fail CI, not code review.

1. Only `packages/auth-provider` imports the identity provider SDK.
2. Only `packages/queue` imports the queue SDK.
3. `packages/` never depends on the hosting provider.
4. An app never imports from another app. Shared code goes to `packages/`.
5. A handler never executes SQL.

These are not style preferences. They are the mechanism that keeps the
architecture true when nobody is reviewing carefully. Never disable one inline.

Two known limits, so nobody assumes more coverage than exists:

- Rule 4 matches import strings, so it catches `@allfitone/api` but not deep
  relative traversal such as `../../api/src/app.js`. Closing it needs
  `eslint-plugin-import`'s `no-restricted-paths`.
- Boundaries **between domains** — `domains/x` must not reach inside
  `domains/y` — are not enforced yet. They need `eslint-plugin-boundaries` and
  become worth adding once a second domain has code.

If you add or change a rule here, prove it works: write a file that violates it,
confirm ESLint rejects it, and confirm the legitimate case still passes. A
boundary rule that silently does nothing is worse than no rule, because it is
believed.

---

## 6. Identity and authorization

The provider authenticates. **Authorization is ours.**

### From the token, use only `sub` and `sid`

The access token also carries `org_id`, `role` and `permissions`. **Ignore them.**

Organizations, roles, relationships, consents and duties live in PostgreSQL and
are resolved inside the transaction. Reading authorization claims from the token
would create a second source of truth that silently drifts from the first.

`VerifiedToken` in `packages/auth-provider` deliberately cannot carry them. If you
find yourself wanting to widen that type, stop.

### Three applications, one directory

One provider environment per deployment environment, with three applications —
Space, Studio, Backoffice — sharing a single user directory.

The same human uses Space and Studio with one credential. But a token issued for
one surface does not operate against another: the API validates `client_id`
against the route and answers `wrong-surface` 403.

### Resolving a person

`sub` → `identity.access_accounts (provider, issuer, subject)` → `person_id`,
resolved **in the database**. No domain identifier ever travels in a token.

### Space is headless

Space has native screens and never talks to the provider directly. It sends
credentials to `/space/v1/auth/*`; the API makes the provider call with the API
key, which exists only on the server. Never put the API key in a client bundle.

---

## 7. Working with external providers

Every external provider sits behind a port in `packages/`:

- The port speaks **our** language, not the vendor's. If the interface mirrors the
  vendor response with renamed fields, it is an alias, not an abstraction.
- Test: could you write an adapter for a different vendor without editing the
  port? If not, the port leaks.
- Vendor errors are normalized inside the adapter and never escape it. This is not
  cosmetic — the identity provider distinguishes "email already registered" from
  "invalid email", and propagating that difference would reveal whether a person
  has an account.
- Never invent an SDK signature. Verify against the vendor's current
  documentation. A plausible-looking wrong call is worse than an unimplemented
  stub.

---

## 8. Database

**Business rules live in PostgreSQL**: row-level security policies, constraint
triggers, and functions. This is deliberate. The last line of defence over health
data must not depend on the application being correctly written.

Consequences you must respect:

- `infrastructure/` calls database functions directly. Do not build a portable
  repository abstraction to hide the engine — the engine is the point. Thin
  interfaces for test mocking are fine; portability layers are not.
- **One runtime role.** `allfit_api` is the only runtime database role. There is no
  per-surface role and no direct client access.
- Supabase is used **only as PostgreSQL**. No `auth.uid()`, no `anon`/
  `authenticated` roles, no proprietary features. This is what keeps the database
  host replaceable at zero cost.

### The read ritual

Every authorized read follows this sequence. It lives in `platform/db` and
`platform/privacy`, and nothing bypasses it:

1. Verify the JWT and validate `client_id` against the surface.
2. Resolve `sub` to a person in the database.
3. Open a transaction.
4. Set actor context with `set_config(..., true)` — transaction-local, which is
   also what survives the connection pooler in transaction mode.
5. Query. Policies filter by that context.
6. Write the access record **in the same transaction**.
7. Commit.

Steps 1, 2, 4 and 6 are application code. The database requires them but cannot
perform them for you. That is precisely why there is one API and one runtime role.

### Cross-system writes

PostgreSQL and external providers do not share a transaction. Any change that
must hold on both sides goes through the outbox with a pending state: the
effective value does not move until the external side confirms.

Never write to an external provider inside an HTTP request that also writes to the
database.

---

## 9. Code style

### Comments

- **All comments in English.** No exceptions. This includes TODOs and commit
  messages.
- **File header docblocks** may be as long as needed. Use them to explain what the
  module is for and, more importantly, _why_ it is shaped the way it is.
- **Every other comment: two lines maximum.**
- **Do not over-comment.** A comment that restates the code is noise. Comment the
  non-obvious: why a constraint exists, why an obvious approach was rejected, what
  breaks if this changes.

```ts
// Bad — restates the code
// increment the counter
counter++

// Good — explains what the reader cannot see
// Transaction-local: session-scoped config does not survive the pooler.
await sql`select set_config('app.actor_account_id', ${id}, true)`
```

### TypeScript

- `strict` is on and stays on. Never widen a type to silence an error.
- No `any`. Use `unknown` and narrow.
- No non-null assertions (`!`) to bypass a check the compiler is right about.
- Prefer explicit return types on exported functions.

### Naming

Use the domain vocabulary from `allfitone-docs`. A `service_relationship` is not
a "subscription" and a `person` is not a "user". Names carry meaning that took
real analysis to settle.

---

## 10. Quality bar

**A failing test is information about the code, not an obstacle to remove.**

When something fails, there are exactly three valid responses:

1. Fix the code.
2. Fix the test, if the test is wrong — and say explicitly why it was wrong.
3. Stop and ask.

There is no fourth option. Specifically, never:

- Add a special case so one test passes.
- Widen a type, add `any`, or cast to silence a compiler error.
- Mock the thing under test.
- Weaken or delete an assertion.
- Catch an exception and return a default to turn a test green.
- Branch on whether the code is running under test.
- Weaken an RLS policy, an invariant, or a lint rule.

**If a security test fails, the test is right.** Policies and invariants are not
adjusted to accommodate code.

A useful tell: if your fix makes the code longer and adds conditionals, it is
probably a patch. Fixes usually make code shorter or leave it the same length.

Correctness and clarity are the deliverable. Passing tests are evidence, not the
goal.

---

## 11. Testing

The taxonomy is already defined in `allfitone-docs`. Do not invent another.

| Class  | What it proves                                  |
| ------ | ----------------------------------------------- |
| `RLS`  | Row-level authorization. 186 cases specified    |
| `INT`  | Cross-table invariants `IX-01..35`              |
| `IDEM` | Command idempotency                             |
| `API`  | Endpoint behaviour against the OpenAPI contract |
| `PHY`  | Indexes, partitions, physical objects           |
| `UNIT` | Pure logic with no I/O                          |

Test IDs follow the documented form: `T-<DOMAIN>-<CLASS>-<NN>`, e.g.
`T-NUT-RLS-01`. Reference the operation or invariant the test covers.

### The pyramid is inverted here

Because the rules live in PostgreSQL, a unit test with mocked "business rules"
proves nothing — it tests the mock. **Integration tests against a real database
with RLS active are the layer that carries the weight.**

- Runner: `bun test`
- Integration database: Supabase CLI locally (`supabase start`), same engine and
  extensions as production, same for developers and CI

### Mandatory by category

These are binary obligations, not targets:

- Every RLS policy has a test proving it **allows** the permitted case **and
  denies** the forbidden one. Both. A policy with only the allow case is untested.
- Every invariant `IX-*` has an `INT` test.
- Every command has an `IDEM` test.
- Every endpoint has an `API` test against the contract.
- `PHY` tests when there is a performance or physical-shape claim to defend.

### TDD

**Write the test first by default.** For generated code this is the single
highest-leverage practice available: it converts "write good code" into "satisfy
this specific, checkable assertion".

Non-negotiable in three cases:

1. **RLS tests.** These assert something is forbidden. Written after the policy, a
   green test may be green because the setup never created the scenario. Write the
   test, **watch the forbidden access succeed**, then add the policy. A test that
   would stay green with the policy deleted is worse than no test.
2. **INT tests.** Same reasoning — the invariant must be observed to fail.
3. **Bug fixes.** Reproduce with a failing test first. If you never saw it fail,
   you do not know you fixed it.

Reasonable exceptions: scaffolding, configuration, and adapters that only
delegate.

---

## 12. Coverage

Coverage is **measured from day one and reported on every pull request, but does
not gate merges yet.** A percentage target on a near-empty repository is arbitrary
and drives testing toward trivia.

What gates merges today is the category obligations in section 11. They are tied
to specific risks rather than to a number, which makes them both stricter and
harder to game.

**After the first vertical slice ships**, whatever coverage stands at that point
becomes the floor, as a ratchet: it may rise, never fall.

Coverage is measured **per layer**, not globally:

| Counted                            | Excluded                                 |
| ---------------------------------- | ---------------------------------------- |
| `application/` — use cases         | `handlers/` — thin routing               |
| `domain/` — entities and rules     | Adapters that only delegate              |
| `packages/*/src` — ports and logic | `generated/`, configuration, scaffolding |

Mixing them produces a number that means nothing.

---

## 13. Git

### Commits

Conventional Commits, in English:

```
feat(identity): add contact change verification
fix(planning): correct session materialization boundary
test(nutrition): cover T-NUT-RLS-14 denial path
docs(readme): document surface mounting
```

Scope is the domain or package, and it is **required**. The valid list is closed
in `commitlint.config.js`, so a typo fails the commit instead of quietly creating
a new scope. Adding a scope means editing that file.

One logical change per commit.

### Hooks

Husky runs automatically. The split is deliberate — pre-commit must stay under
about five seconds, because a slow hook is a bypassed hook.

| Stage        | What runs                                      |
| ------------ | ---------------------------------------------- |
| `pre-commit` | Prettier and ESLint `--fix`, staged files only |
| `commit-msg` | commitlint                                     |
| `pre-push`   | Typecheck and unit tests for affected projects |
| CI           | Everything, including integration tests        |

RLS and INT tests do not run in hooks. They need Supabase running, and putting
them there would guarantee everyone skips the hooks.

---

## 14. CI

Every pull request must pass:

1. Lint, including the five boundary rules
2. Typecheck across affected projects
3. Unit tests
4. Integration tests against Supabase local — RLS, INT, IDEM, API
5. Build of affected deployables
6. Coverage report (informational until the ratchet is set)

Turborepo runs only what the change affects. Do not add steps that always run
everything.

---

## 15. Rules for AI agents

Everything above applies to you. These additionally:

**Never bypass verification.**
`git commit --no-verify` and `git push --no-verify` are forbidden without
exception, including for "quick scaffolding commits". If a hook fails, fix the
cause. Likewise, never add an inline `eslint-disable`.

**Never fake progress.**
An unimplemented stub that throws is honest. A method that returns plausible fake
data is a lie that will be discovered in production. If you cannot implement
something, say so and leave it throwing.

**Never invent an API.**
Do not guess SDK method signatures, response shapes, or configuration keys.
Verify against real documentation. If you cannot verify, write the shape, mark it
clearly as unverified, and say so in your response.

**Never add a dependency without justification.**
State what it does, why the standard library or an existing dependency is
insufficient, and what it costs. Wait for approval.

**Never edit generated files.**
`packages/contracts/generated/` and `packages/db/types/` are outputs. Change the
source and regenerate.

**Never touch authorization claims.**
Do not read `role`, `permissions` or `org_id` from a token, and do not widen
`VerifiedToken` to expose them.

**Never weaken security to make something work.**
Not a policy, not an invariant, not a constraint, not a boundary rule. If one
blocks you, it is telling you the approach is wrong.

**Report honestly.**
If tests fail, say so and show the output. If you skipped part of the task, say
which part and why. If you are unsure whether something works, say that instead of
implying it is verified. "Done" means done and checked.

**Ask when the answer changes the work.**
Routine judgement calls are yours. Decisions that would be expensive to reverse —
schema shape, a new boundary, a dependency, anything touching privacy or
authorization — go to a human first.

---

## 16. Source of truth

| Question                                                        | Where it is answered       |
| --------------------------------------------------------------- | -------------------------- |
| What the product does, user stories                             | `allfitone-docs/products/` |
| Architecture decisions, domain model, RLS matrix, API contracts | `allfitone-docs/platform/` |
| Domain vocabulary                                               | `allfitone-docs` glossary  |
| How we build and test                                           | This file                  |
| What the code actually does                                     | The code                   |

`allfitone-docs` is normative and outranks this file. Never copy its content here
— link to it. If an implementation decision starts to affect more than one
product, its definition moves there.

If documentation and code disagree, that is a finding worth reporting, not a gap
to paper over silently.

### Check the date

`allfitone-docs` changes. Before relying on an architecture decision, confirm its
state is `aceptada` or `vigente` and check whether a later ADR modifies it — a
superseded decision reads exactly like a current one. ADR numbering is not
chronological across topics.

---

## Open items

Track these; they are known gaps, not oversights:

- Data residency and DPA with the identity provider for health data under Law 1581. This is the only item that could still invalidate the provider choice.
- How the "this session satisfies AAL2" fact reaches the API. All Backoffice
  authorization depends on it.
- `/space/v1/auth/*` does not exist in the OpenAPI contract yet. Space's headless
  login needs it.
- The contact-change operation is absent from the operations matrix, although its
  events are already declared in the data dictionary.
- `allfitone-docs` still names a per-product repository as owner of the API and
  `supabase/`, and does not mention `apps/worker`.

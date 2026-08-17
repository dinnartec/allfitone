---
name: studio-backend-flow
description: Orchestrate an Allfit Studio backend domain package from Linear and canonical user stories through analysis, implementation, independent review, correction, verification and frontend handoff. Use when implementing, continuing, reviewing or closing one or more Studio BACK issues, especially work involving OpenAPI, PostgreSQL migrations or functions, RLS, handlers, generated types and RLS/INT/IDEM/API tests. Do not use for frontend-only work or unrelated products.
---

# Studio Backend Flow

Deliver a bounded Studio backend package with one writer, independent review and
an evidence-based handoff. Keep the parent agent responsible for scope, external
writes, Git publication and final acceptance.

## Required input

Resolve before implementation:

- Linear project and BACK issue identifiers or exact HU range.
- Domain package and intended base branch.
- Whether the user authorized Linear mutations.
- Whether the user authorized commits, push, pull-request creation or merge.

Treat unspecified external writes as unauthorized. Continue with local,
reversible work when possible and report the pending action.

## 1. Preflight

1. Read every applicable `AGENTS.md` completely.
2. Inspect Git status and preserve unrelated user changes.
3. Confirm the base revision and compare it with `main`.
4. Read the requested Linear issues through the connected Linear MCP.
5. Read the canonical Studio user stories, dependency graph and applicable
   architecture/database documents in `allfitone-docs`.
6. Inspect the current OpenAPI, migrations, domain modules, handler mounting and
   tests before proposing changes.
7. Stop if a required canonical source is unavailable or contradictory and the
   contradiction changes the implementation.

## 2. Analyze

Spawn `studio_analyst` for the bounded package. Keep it read-only. Require a
topological plan, per-HU current state, affected surfaces, test obligations and
human-gated decisions.

The parent agent must inspect the returned evidence itself. Do not delegate final
interpretation of canonical requirements. If no unresolved irreversible decision
remains, accept the brief and continue. Otherwise ask the user only for the
decision that materially changes the implementation.

If Linear synchronization was authorized, move the selected BACK issues to
`In Progress` only when implementation actually starts.

## 3. Implement

Spawn exactly one `studio_implementer` with the accepted brief and bounded HU
list. Do not run another workspace-writing agent concurrently in the same
worktree.

Require the implementation order:

1. Failing RLS, INT and bug-regression tests where applicable.
2. Canonical OpenAPI changes.
3. Forward-only migrations, PostgreSQL functions, invariants and RLS.
4. Application use cases and infrastructure calls.
5. Mounted HTTP handlers.
6. Generated DTO and database types through repository generators.
7. API, IDEM, UNIT and remaining integration tests.
8. Traceability updates required by the canonical documentation policy.

Never allow the worker to edit generated artifacts manually, invent an API,
weaken a test or policy, or substitute functionality with plausible data.

## 4. Verify and review

After the writer stops, the parent agent must inspect the diff and run the
smallest relevant checks. Then run the complete affected-domain gate required by
`AGENTS.md`.

Spawn `studio_reviewer` with the raw diff, requested HU list and actual command
results. Keep it independent and read-only. Require concrete findings rather than
style commentary.

If findings are verified, spawn `studio_corrector` with only those findings. Run
one new independent review after correction. Allow at most two correction/review
cycles; after that, report the unresolved blocker instead of looping.

The parent agent must rerun affected checks after every correction and perform the
final validation itself.

## 5. Publish and synchronize

Only perform GitHub or Linear writes when the invocation authorized them.

- Use English Conventional Commits with one logical change per commit.
- Never bypass hooks.
- Keep one domain-and-layer pull request for the package and reference every
  covered BACK issue.
- Move BACK issues to `In Review` only when the branch or PR is reviewable and
  required checks have run.
- Move a BACK issue to `Done` only after its code is merged into `main`, its
  required checks are green and its contract is consumable by frontend.
- Do not mark partially covered HUs complete.

The parent agent is the sole Linear writer and integration owner. Subagents may
read Linear context but must not mutate it.

## 6. Frontend handoff

Return a concise handoff containing:

- BACK issues and HUs merged into `main`.
- Endpoints and operations added or changed.
- Generated types frontend must consume.
- Authentication, role and organization behavior.
- Loading-independent error states such as forbidden, conflict and not found.
- Required fixtures or business preconditions for frontend and E2E tests.
- FRONT issues now unblocked.
- Known limitations, skipped checks and exact failures, if any.

Do not claim completion from agent output alone. Completion requires inspected
code, recorded verification and merge evidence.

## Parallelism policy

- Use parallel subagents first for read-heavy exploration, test inspection and
  independent review.
- Use one writer per worktree.
- Never parallelize writes to OpenAPI, migrations, RLS, generated types or the
  same domain module.
- Use separate Codex worktree chats for independent write streams. Keep each
  branch scoped to one domain package and reconcile shared contracts serially.

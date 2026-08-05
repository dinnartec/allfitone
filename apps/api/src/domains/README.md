# Domains

One module per domain, each with the same internal shape:

```
<domain>/
  domain/           entities, value types, domain errors
  application/      use cases — the logic lives here
  infrastructure/   PostgreSQL access and database function calls
  handlers/         HTTP routes, grouped by surface
  dependencies.ts   module composition
```

## Rules

1. `handlers/` never executes SQL or opens a connection. It calls `application/`.
2. `application/` knows nothing about HTTP. Data in, data out.
3. A domain reaches another **only through its `index.ts`**, never into its
   internals. This mirrors the database rule: no domain writes another domain's
   tables.
4. All four surfaces share the same use cases. What differs between
   `handlers/space.ts` and `handlers/studio.ts` is the projection, not the rule.

## Layer depth is per module

`identity` will grow and earn its layers. `catalog` may stay flat forever. Keep
each module as flat as it can be; promote a file to a folder past roughly ten
files. Do not create empty structure in anticipation.

## What is not a domain

- **`system`** (outbox, idempotency keys, job runs) is infrastructure: it lives in
  `platform/outbox` and `platform/idempotency`.
- **Privacy enforcement** — checking grants, writing the access record inside the
  read transaction — is invoked by every domain on every read, so it is
  `platform/privacy`. Consent **management** is a domain and lives in
  `domains/privacy`.

## Which exist

Only `identity`, the first vertical slice. The rest are created when they have
code, not before:

`organizations` · `relationships` · `privacy` · `catalog` · `planning`
`execution` · `nutrition` · `payments` · `support`

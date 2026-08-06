# @allfitone/contracts

| Path                             | What it is                                        |
| -------------------------------- | ------------------------------------------------- |
| `openapi/allfit-v1.openapi.yaml` | Canonical OpenAPI specification. Edited by hand   |
| `generated/`                     | Types and DTOs generated from it. **Do not edit** |

This package owns the executable API contract. Product requirements,
architecture decisions and traceability remain in `allfitone-docs`, where they
link back to this file instead of keeping another YAML copy.

Validate every contract change from the monorepo root:

```bash
bun run check:openapi
```

Commit the specification, generated DTOs, API implementation and affected
clients together. CI runs the same Redocly validation before lint, typecheck,
tests and builds.

Consumers: `apps/api`, `apps/studio-web`, `apps/backoffice-web`, `apps/space`.

## Pending

`/space/v1/auth/*` does not exist in the specification yet. Space uses headless
login with its own native screens, so it needs create session, refresh and sign
out.

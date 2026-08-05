# @allfitone/contracts

| Folder       | What it is                                             |
| ------------ | ------------------------------------------------------ |
| `openapi/`   | OpenAPI specification. Source of truth, edited by hand |
| `generated/` | Generated types and DTOs. **Do not edit**              |

Consumers: `apps/api`, `apps/studio-web`, `apps/backoffice-web`, `apps/space`.

## Pending

`/space/v1/auth/*` does not exist in the specification yet. Space uses headless
login with its own native screens, so it needs create session, refresh and sign
out.

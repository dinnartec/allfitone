# Postman

Postman is the development workbench for sending requests to the AllFit One API. It does not replace the canonical OpenAPI contract.

- **AllFit One — Development** contains the 36 contract operations mounted by the API plus `GET /health`.
- **Local Development** points to `http://localhost:8081`, the port configured in `.env.local`.
- `packages/contracts/openapi/allfit-v1.openapi.yaml` also describes future operations. They appear in the specification, but not in the runnable collection until their routes are mounted.

## Start

1. Run `bun run db:start` and `bun run dev`.
2. Open the **AllFit One** team workspace in Postman.
3. Select **Local Development**.
4. Begin with `00 - Platform / GET Health`.

Requests are grouped by Platform, Studio, Space, and Backoffice. Successful responses capture reusable IDs, catalog codes, ETags, and the Space access token in local environment values.

Studio authentication is browser-hosted. Complete the login in a browser and add the local `allfit_studio_session` cookie to Postman's cookie jar before sending protected Studio requests. Backoffice authentication can run in sequence inside Postman because its temporary and AAL2 cookies are written to the cookie jar.

Set passwords, verification codes, TOTP values, invitation tokens, session cookies, and access tokens only as local or secret values. Never share them or save response examples containing real personal, medical, nutrition, authentication, or media data.

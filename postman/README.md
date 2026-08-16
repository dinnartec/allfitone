# Postman

AllFit One uses Postman as an executable collaboration layer. It does not replace the canonical OpenAPI contract or the normative product documentation.

- Contract: `packages/contracts/openapi/allfit-v1.openapi.yaml`
- Operational collections: `postman/collections/`
- Shared, non-secret environments: `postman/environments/`
- Canonical runbook: `allfitone-docs/platform/api/POSTMAN_RUNBOOK.md`

Use the **Local** environment for authored journeys. The **Production** environment is restricted to the four unauthenticated `GET` requests in **AllFit One — Production Smoke**.

Keep credentials, TOTP codes, invitation tokens, bearer tokens, cookies, IDs, cursors, ETags, and signed URLs out of Git and shared Postman values. Credentials belong in Postman Local Vault; cookies belong in the cookie jar; transient IDs and ETags belong in local or run scope.

Do not save real response bodies or examples containing personal, medical, nutrition, authentication, or media data.

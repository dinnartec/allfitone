# Allfit Backoffice — web

Next.js client for `/backoffice/v1`, deployed independently from the other apps
in the monorepo.

## Local development

From the repository root:

```bash
bun run dev --filter=@allfitone/backoffice-web
```

The app runs at `http://localhost:3001` and reads the API origin from
`NEXT_PUBLIC_API_URL`.

## Vercel

- Project name: `allfitone-backoffice`
- Root Directory: `apps/backoffice-web`
- Production branch: `main`
- Production domain: `backoffice.allfit.one`
- Environment variable: `NEXT_PUBLIC_API_URL=https://api.allfit.one`

Keep **Include source files outside of the Root Directory** enabled. The app
consumes the generated contract from `@allfitone/contracts` and the published UI
library from `@allfitone/react`.

Backoffice authenticates directly against `/backoffice/v1` with email, password
and TOTP. Hosted AuthKit is used only for the password-reset page reached from the
email sent by WorkOS; it is not the login surface.

The browser stores no email, password, TOTP secret, QR or provider identifier.
Only minimal session timing state is synchronized between tabs. A successful
login proves AAL2 for that session but grants no operation by itself; future
screens must still check their platform duty in the backend transaction.

## Verification

```bash
bun run --filter=@allfitone/backoffice-web test
bun run --filter=@allfitone/backoffice-web lint
bun run --filter=@allfitone/backoffice-web typecheck
bun run --filter=@allfitone/backoffice-web build
bun run --filter=@allfitone/backoffice-web test:e2e
```

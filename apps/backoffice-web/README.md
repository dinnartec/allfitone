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

Keep **Include source files outside of the Root Directory** enabled. The app will
consume workspace packages such as `@allfitone/contracts` as product features
land.

Backoffice uses a hosted login with mandatory MFA and a session independent from
Studio. Signing in grants no authority by itself; every screen and action checks
authorization separately.

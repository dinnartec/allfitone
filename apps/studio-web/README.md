# Allfit Studio — web

Next.js client for `/studio/v1`, deployed independently from the other apps in
the monorepo.

## Local development

From the repository root:

```bash
bun run dev --filter=@allfitone/studio-web
```

The app runs at `http://localhost:3000` and reads the API origin from
`NEXT_PUBLIC_API_URL`.

## Vercel

- Project name: `allfitone-studio`
- Root Directory: `apps/studio-web`
- Production branch: `main`
- Production domain: `studio.allfit.one`
- Environment variable: `NEXT_PUBLIC_API_URL=https://api.allfit.one`

Keep **Include source files outside of the Root Directory** enabled. The app will
consume workspace packages such as `@allfitone/contracts` as product features
land.

Studio uses hosted login. The organization travels explicitly in the path under
`/organizations/{orgId}`; it is never resolved from the token or a stored
preference.

## Server-state cache

Studio uses TanStack Query for authenticated business reads and mutations. The
cache exists only in memory, is cleared on logout or an API `401`, and never
contains invitation tokens. Session recovery, entry context, onboarding, and
organization authorization remain outside the query cache because they are
security state machines rather than reusable presentation data.

Catalog responses retain their existing ETag-backed `sessionStorage` cache.
Organization and profile data are never persisted by TanStack Query.

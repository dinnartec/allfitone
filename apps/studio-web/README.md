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

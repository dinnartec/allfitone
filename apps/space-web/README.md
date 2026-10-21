# Allfit Space — web

Public landing of Allfit Space at `space.allfit.one`, in Spanish (`/es`) and
English (`/en`), with the legal drafts the app stores require. It has no forms
and talks to no API: accounts are created only in the app.

## Local development

From the repository root:

```bash
bun run dev --filter=@allfitone/space-web
```

The site runs at `http://localhost:3200`. `/` redirects to the language the
browser prefers, Spanish by default.

## Content

- Copy lives in `src/content/es.ts` and `src/content/en.ts`. The English
  dictionary is typed after the Spanish one, and `bun test src` rejects missing
  keys, empty strings and lowercase openings.
- Screens are real captures of the Space app, copied on purpose into
  `public/images` as WebP. A web app never imports from another app, so they are
  duplicated rather than shared with `apps/space`.
- The legal pages are drafts marked «Versión preliminar». The company name, tax
  ID, address and privacy contact are still pending and read as such.

## Store links

Until the app is published, the App Store and Google Play buttons read «Próximamente
en». Set either variable and that button becomes a link, with no code change:

- `NEXT_PUBLIC_APP_STORE_URL`
- `NEXT_PUBLIC_PLAY_STORE_URL`

## Tests

```bash
bun run test        # dictionaries and language negotiation
bun run test:e2e    # production build, routing and axe (WCAG 2.2 AA) on desktop and phone
```

## Vercel

- Project name: `allfitone-space-web`
- Root Directory: `apps/space-web`
- Production branch: `main`
- Production domain: `space.allfit.one` (a `space` CNAME at the DNS provider)

Keep **Include source files outside of the Root Directory** enabled so the
workspace resolves.

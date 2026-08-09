// Monorepo boundary rules.
//
// These are not style: they keep architectural decisions true when nobody is
// reading the pull request carefully. A failure here fails CI.
//
// These rules match the literal import specifier, not the resolved path. That
// covers workspace imports and package names, and it does NOT cover deep
// relative traversal such as `../../api/src/app.js`. See AGENTS.md section 5 —
// the gap is real and named rather than papered over.
//
// eslint-plugin-boundaries would close it, but v7 produced no diagnostics in
// this setup even with its own strict preset, so it was removed rather than left
// in place looking like protection.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// --- Provider isolation ------------------------------------------------------

// Only packages/auth-provider knows the identity provider. Without this the
// abstraction erodes on the first hurried `bun add`.
const NO_PROVIDER_SDK = {
  group: ['@workos-inc', '@workos-inc/*'],
  message: 'The provider SDK belongs in packages/auth-provider. Use its port.',
}

// Only packages/queue knows the queue.
const NO_QUEUE_SDK = {
  group: ['@vercel/queue', 'pg-boss', '@aws-sdk/client-sqs', '@aws-sdk/client-sns'],
  message: 'The queue SDK belongs in packages/queue. Use its port.',
}

// Product web apps consume visual decisions only through the React platform
// package. Foundations and implementation libraries remain private to the DS.
const UI_APPS = ['studio-web', 'backoffice-web']

const NO_REACT_ROOT = {
  name: '@allfitone/react',
  message: 'Use an explicit public @allfitone/react subpath.',
}

const NO_DIRECT_UI = {
  group: [
    '@allfitone/brand',
    '@allfitone/brand/*',
    '@allfitone/icons',
    '@allfitone/icons/*',
    '@allfitone/tokens',
    '@allfitone/tokens/*',
    '@base-ui/react',
    '@base-ui/react/*',
    'lucide-react',
    'lucide-react/*',
    'class-variance-authority',
    'clsx',
    'tailwind-merge',
    'shadcn',
    'tailwindcss',
    '@tailwindcss/*',
    'tw-animate-css',
  ],
  message: 'Studio and Backoffice use explicit @allfitone/react subpaths only.',
}

const NO_LOCAL_UI = {
  group: ['@/components/ui', '@/components/ui/*', '**/components/ui', '**/components/ui/**'],
  message: 'Product apps do not own UI primitives. Add the capability to the Design System.',
}

// Hosting primitives stay out of packages/. This is what lets apps/api move
// from Vercel to a container untouched.
const NO_HOSTING = {
  group: ['@vercel/*', 'next', 'next/*'],
  message: 'Shared libraries must not depend on the hosting provider.',
}

// Handlers never execute SQL. The read ritual — actor context plus access
// record in the same transaction — lives in platform/db.
// An app never imports another app. Shared code goes to packages/, and
// duplicated logic across apps is exactly what this prevents.
//
// Generated per app so each one blocks the OTHER four and never itself: a
// blanket pattern would reject a legitimate `./space/...` inside apps/space.
// Both spellings are covered — the workspace name and a relative path that
// traverses into a sibling app.
const APPS = ['api', 'worker', 'studio-web', 'backoffice-web', 'space']

const noOtherApps = (self) => ({
  group: APPS.filter((a) => a !== self).flatMap((a) => [
    `@allfitone/${a}`,
    `@allfitone/${a}/*`,
    `**/${a}/**`,
  ]),
  message: 'Apps do not import each other. Extract shared code to packages/.',
})

// A domain is reached through its index.ts and never from the inside. This is
// the code-level mirror of the database rule: no domain writes another domain's
// tables.
//
// Listed explicitly, like the apps, so a domain can still import its own
// internals. Adding a domain means adding it here — and until it is added, its
// internals are reachable, so the list is part of creating a domain.
const DOMAINS = ['identity', 'organizations']

// Brace expansion is NOT supported here — a `{a,b}` pattern silently matches
// nothing, which is the worst failure mode for a rule like this. Expanded.
const DOMAIN_LAYERS = ['domain', 'application', 'infrastructure', 'handlers']

const internalsOf = (domain) => DOMAIN_LAYERS.map((layer) => `**/domains/${domain}/${layer}/**`)

const noOtherDomainInternals = (self) => ({
  group: DOMAINS.filter((d) => d !== self).flatMap(internalsOf),
  message: 'Reach another domain through its index.ts, never into its internals.',
})

/** For everything that is not itself a domain: no domain internals at all. */
const NO_DOMAIN_INTERNALS = {
  group: internalsOf('*'),
  message: 'Reach a domain through its index.ts, never into its internals.',
}

const NO_DB_IN_HANDLERS = {
  group: ['postgres', 'pg', '**/platform/db', '**/platform/db/**'],
  message: 'Handlers do not touch the database. Call application/, which calls infrastructure/.',
}

// Empty groups are a schema error, and they happen naturally: with a single
// domain, "every other domain" is an empty list.
const restrict = (...patterns) => [
  'error',
  {
    paths: patterns.filter((pattern) => pattern.name),
    patterns: patterns.filter((pattern) => pattern.group?.length > 0),
  },
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/.next/**',
      '**/generated/**',
      'packages/db/types/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // --- Literal-specifier restrictions ---------------------------------------
  //
  // `no-restricted-imports` does not merge across flat-config blocks — the last
  // matching block wins. Patterns are therefore composed per scope. Splitting
  // them into one block per rule silently disables all but the last, which is
  // exactly the failure these rules exist to prevent.
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_QUEUE_SDK) },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_QUEUE_SDK, NO_HOSTING) },
  },
  {
    files: ['packages/auth-provider/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(NO_QUEUE_SDK, NO_HOSTING) },
  },
  {
    files: ['packages/queue/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_HOSTING) },
  },
  ...APPS.map((app) => ({
    files: [`apps/${app}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrict(
        NO_PROVIDER_SDK,
        NO_QUEUE_SDK,
        noOtherApps(app),
        NO_DOMAIN_INTERNALS,
        ...(UI_APPS.includes(app) ? [NO_REACT_ROOT, NO_DIRECT_UI, NO_LOCAL_UI] : []),
      ),
    },
  })),
  {
    files: UI_APPS.flatMap((app) => [`apps/${app}/**/*.{ts,tsx}`]),
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='svg']",
          message: 'Inline SVG is forbidden. Use a public Design System brand or icon export.',
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Inline visual styles are forbidden in Studio and Backoffice.',
        },
        {
          selector: "JSXAttribute[name.name='className'] > Literal",
          message: 'Literal visual classes are forbidden. Compose a public Design System API.',
        },
        {
          selector: "JSXAttribute[name.name='className'] > JSXExpressionContainer > Literal",
          message: 'Literal visual classes are forbidden. Compose a public Design System API.',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] > JSXExpressionContainer > TemplateLiteral[expressions.length=0]",
          message: 'Literal visual classes are forbidden. Compose a public Design System API.',
        },
      ],
    },
  },
  // Inside a domain: its own internals are fine, another domain's are not.
  ...DOMAINS.map((domain) => ({
    files: [`apps/api/src/domains/${domain}/**/*.ts`],
    rules: {
      'no-restricted-imports': restrict(
        NO_PROVIDER_SDK,
        NO_QUEUE_SDK,
        noOtherApps('api'),
        noOtherDomainInternals(domain),
      ),
    },
  })),
  {
    files: ['apps/api/src/domains/*/handlers/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        NO_PROVIDER_SDK,
        NO_QUEUE_SDK,
        noOtherApps('api'),
        noOtherDomainInternals('identity'),
        NO_DB_IN_HANDLERS,
      ),
    },
  },

  // Build tooling configuration: CommonJS, runs in Node, not part of the app
  // graph. `**/` is required — a bare `*.config.js` matches only the root, so
  // metro.config.js inside an app would go unchecked and then fail in CI.
  {
    files: ['**/*.config.js', '**/*.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)

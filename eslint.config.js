// Monorepo boundary rules.
//
// These are not style: they keep architectural decisions true when nobody is
// reading the pull request carefully. A failure here fails CI.
//
// IMPORTANT: `no-restricted-imports` does not merge across flat-config blocks —
// the last matching block wins. So patterns are composed into one rule per file
// scope instead of one block per rule. Splitting them silently disables all but
// the last, which is exactly the kind of failure these rules exist to prevent.
//
// Pending: boundaries between domains (`domains/x` must not reach inside
// `domains/y`) need eslint-plugin-boundaries. Add once more than one domain has
// code.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// 1. Only packages/auth-provider knows the identity provider.
//    Without this the abstraction erodes on the first hurried `bun add`.
const NO_PROVIDER_SDK = {
  group: ['@workos-inc', '@workos-inc/*'],
  message: 'The provider SDK belongs in packages/auth-provider. Use its port.',
}

// 2. Only packages/queue knows the queue.
const NO_QUEUE_SDK = {
  group: ['@vercel/queue', 'pg-boss', '@aws-sdk/client-sqs', '@aws-sdk/client-sns'],
  message: 'The queue SDK belongs in packages/queue. Use its port.',
}

// 3. Hosting primitives stay out of packages/.
//    This is what lets apps/api move from Vercel to a container untouched.
const NO_HOSTING = {
  group: ['@vercel/*', 'next', 'next/*'],
  message: 'Shared libraries must not depend on the hosting provider.',
}

// 4. An app never imports from another app. Shared code goes to packages/.
//
// Partial: `no-restricted-imports` matches the import string, not the resolved
// path, so this catches workspace imports but not deep relative traversal like
// `../../api/src/app.js`. Closing that needs eslint-plugin-import's
// no-restricted-paths, which resolves. Tracked in AGENTS.md section 5.
const NO_CROSS_APP = {
  group: [
    '@allfitone/api',
    '@allfitone/api/*',
    '@allfitone/worker',
    '@allfitone/worker/*',
    '@allfitone/studio-web',
    '@allfitone/studio-web/*',
    '@allfitone/backoffice-web',
    '@allfitone/backoffice-web/*',
    '@allfitone/space',
    '@allfitone/space/*',
    '**/apps/*/**',
  ],
  message: 'Apps do not import each other. Extract shared code to packages/.',
}

// 5. Handlers never execute SQL or open connections. The read ritual — actor
//    context plus access record in the same transaction — lives in platform/db.
const NO_DB_IN_HANDLERS = {
  group: ['postgres', 'pg', '**/platform/db', '**/platform/db/**'],
  message: 'Handlers do not touch the database. Call application/, which calls infrastructure/.',
}

const restrict = (...patterns) => ['error', { patterns }]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/generated/**',
      'packages/db/types/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // No `any`, and no non-null assertions to silence a check the compiler is
  // right about. See AGENTS.md section 9.
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

  // Default: nothing may reach a provider SDK directly.
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_QUEUE_SDK) },
  },

  // Shared libraries additionally may not depend on the host.
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_QUEUE_SDK, NO_HOSTING),
    },
  },

  // Each port's own package is the one place its SDK is allowed.
  {
    files: ['packages/auth-provider/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(NO_QUEUE_SDK, NO_HOSTING) },
  },
  {
    files: ['packages/queue/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_HOSTING) },
  },

  // Apps may use host primitives but never each other.
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrict(NO_PROVIDER_SDK, NO_QUEUE_SDK, NO_CROSS_APP),
    },
  },

  // Handlers carry every restriction above, plus no database access.
  {
    files: ['apps/api/src/domains/*/handlers/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        NO_PROVIDER_SDK,
        NO_QUEUE_SDK,
        NO_CROSS_APP,
        NO_DB_IN_HANDLERS,
      ),
    },
  },

  // Config files run in Node and are not part of the app graph.
  {
    files: ['*.config.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
)

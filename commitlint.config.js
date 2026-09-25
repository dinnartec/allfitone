// Conventional Commits, in English. See AGENTS.md section 13.
//
// Scope is the domain or package the change belongs to. Keeping the list closed
// means a typo fails the commit instead of quietly creating a new scope.

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'api',
        'worker',
        'studio-web',
        'backoffice-web',
        'space',
        // packages
        'auth-provider',
        'queue',
        'contracts',
        'db',
        'notifications',
        'telemetry',
        // domains inside apps/api
        'identity',
        'organizations',
        'relationships',
        'privacy',
        'catalog',
        'planning',
        'execution',
        'nutrition',
        'payments',
        'support',
        'platform',
        // repository-wide
        'repo',
        'ci',
        'deps',
      ],
    ],
    'scope-empty': [2, 'never'],
    // Forbid Title Case and SHOUTING, but allow acronyms inside the subject.
    // This domain is full of them — JWKS, JWT, RLS, MFA, DTO, SQL — and a strict
    // lower-case rule would fight the vocabulary on every commit.
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
}

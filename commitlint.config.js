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
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
  },
}

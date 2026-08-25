const banPrismaService = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: '../prisma/prisma.service',
          importNames: ['PrismaService'],
          message:
            'Domain modules must inject TenantPrisma, never PrismaService directly. ' +
            'PrismaService is reserved for auth/ and prisma/ internals (see kindergarten-docs §2.4).',
        },
        {
          name: './prisma.service',
          importNames: ['PrismaService'],
          message:
            'Domain modules must inject TenantPrisma, never PrismaService directly.',
        },
      ],
      patterns: [
        {
          group: ['**/prisma/prisma.service'],
          importNames: ['PrismaService'],
          message:
            'Domain modules must inject TenantPrisma, never PrismaService directly. ' +
            'PrismaService is reserved for auth/ and prisma/ internals (see kindergarten-docs §2.4).',
        },
      ],
    },
  ],
};

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      // Rule with no exceptions (kindergarten-docs 01-stage1-plan.md §2.4):
      // every module except auth/, prisma/ internals, and rbac/ injects
      // TenantPrisma, never PrismaService. One leaked raw client is one
      // un-tenant-scoped query away from a cross-client data leak.
      //
      // rbac/ is exempted deliberately: making PermissionGuard depend on
      // request-scoped TenantPrisma made the *guard itself* request-scoped,
      // which broke Nest's global-guard DI (Reflector resolved to
      // undefined inside canActivate — see permission-resolver.service.ts).
      // RBAC infrastructure runs for every route, including @Public() ones
      // with no tenant yet, and always threads tenantId/userId through
      // method params explicitly instead of relying on request scope.
      files: ['src/**/*.ts'],
      excludedFiles: [
        'src/auth/**/*.ts',
        'src/prisma/**/*.ts',
        'src/rbac/**/*.ts',
        'src/health/**/*.ts', // a health check pings the DB directly, no tenant involved
        // An inbound Telegram update carries a chat_id, not a JWT — there
        // is no tenant until the token (or an existing binding row)
        // resolves one, same reasoning as rbac/ above.
        'src/telegram/**/*.ts',
        // The pg-boss worker runs outside any HTTP request — there is no
        // request-scoped TenantPrisma to inject in a background process,
        // so it takes tenantId explicitly from the job payload instead
        // (same reasoning as rbac/ and telegram/ above).
        'src/notifications/notification-worker.service.ts',
        // Same reasoning — the export worker resolves ReportsService via
        // a synthetic per-tenant request context (ModuleRef +
        // ContextIdFactory) rather than a real HTTP request, and needs
        // raw PrismaService for its own job-status bookkeeping.
        'src/reports/export-worker.service.ts',
        // A nightly cron sweep across *every* tenant by definition has no
        // single request's tenant to scope to — same reasoning as the
        // export worker above.
        'src/notifications/debt-reminder.service.ts',
        '**/*.spec.ts',
      ],
      rules: banPrismaService,
    },
  ],
};

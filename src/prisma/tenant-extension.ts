import { Prisma, PrismaClient } from '@prisma/client';

/**
 * The tenant seam (kindergarten-docs/docs/01-stage1-plan.md §2.4).
 *
 * Every read is forced to filter by tenantId, every write is forced to
 * carry it. Derived from the Prisma DMMF instead of a hand-maintained list,
 * so a newly added model is automatically protected the moment it gets a
 * `tenantId` field — no second place to remember to update.
 *
 * Models with no `tenantId` column (Tenant itself, the global Permission
 * catalog, and join tables scoped transitively through a parent that does
 * carry tenantId — RolePermission, UserRole, UserBranch,
 * UserPermissionOverride) are left untouched here; callers must scope
 * those through the tenant-scoped parent record.
 *
 * Typing note: this is a `query`-component extension, so Prisma's static
 * types are unchanged — `create()` calls still require `tenantId` in
 * their input type even though this extension overwrites it at runtime.
 * Convention: pass `tenantId: tenantPrisma.tenantId` explicitly at create
 * call sites anyway (see audit.service.ts). It costs one field, keeps
 * full type-checking on the rest of the payload, and turns this extension
 * into a verified safety net instead of the only source of truth.
 */
const MODELS_WITHOUT_TENANT_ID = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => !model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name),
);

const READ_AND_MUTATE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
]);

export function forTenant(client: PrismaClient, tenantId: string) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || MODELS_WITHOUT_TENANT_ID.has(model)) {
            return query(args);
          }

          const a = args as Record<string, any>;

          if (READ_AND_MUTATE_OPS.has(operation)) {
            a.where = { ...a.where, tenantId };
          }

          if (operation === 'create') {
            a.data = { ...a.data, tenantId };
          }

          if (operation === 'createMany' && Array.isArray(a.data)) {
            a.data = a.data.map((row: Record<string, any>) => ({ ...row, tenantId }));
          }

          if (operation === 'upsert') {
            a.where = { ...a.where, tenantId };
            a.create = { ...a.create, tenantId };
          }

          return query(a);
        },
      },
    },
  });
}

export type TenantScopedClient = ReturnType<typeof forTenant>;

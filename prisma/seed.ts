/**
 * Dev/staging bootstrap: one tenant, one branch, the permission catalog,
 * the seeded system roles with sensible default grants (01-stage1-plan.md
 * §5.6), and an Owner user to log in with. Idempotent — safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSION_CATALOG, PermissionKey } from '../src/rbac/permission-catalog';

const prisma = new PrismaClient();

type Grant = { key: PermissionKey; scope: 'all' | 'branch' | 'own_group' | 'today' | 'self' };

const ALL_GRANTS: Grant[] = PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'all' }));

// Default grants for the seeded system roles (01-stage1-plan.md §5.6).
// Fully editable afterwards via the roles API once it exists — these are
// starting templates, not hardcoded policy.
const ROLE_GRANTS: Record<string, Grant[]> = {
  owner: ALL_GRANTS,

  director: PERMISSION_CATALOG.filter(
    (p) => !['period:reopen', 'role:manage:sensitive'].includes(p.key),
  ).map((p) => ({ key: p.key, scope: 'all' })),

  administrator: [
    { key: 'child:read', scope: 'all' },
    { key: 'child:create', scope: 'all' },
    { key: 'child:update', scope: 'all' },
    { key: 'child:status', scope: 'all' },
    { key: 'group:read', scope: 'all' },
    { key: 'group:manage', scope: 'all' },
    { key: 'guardian:read', scope: 'all' },
    { key: 'guardian:manage', scope: 'all' },
    { key: 'consent:read', scope: 'all' },
    { key: 'consent:manage', scope: 'all' },
    { key: 'user:manage', scope: 'all' },
    { key: 'role:manage', scope: 'all' },
    { key: 'settings:manage', scope: 'all' },
    { key: 'branch:manage', scope: 'all' },
    { key: 'holiday:manage', scope: 'all' },
    { key: 'announcement:manage', scope: 'all' },
    { key: 'notification:send', scope: 'all' },
    { key: 'notification_template:manage', scope: 'all' },
    { key: 'report:read', scope: 'all' },
    { key: 'dashboard:read', scope: 'all' },
    { key: 'file:read', scope: 'all' },
    { key: 'file:manage', scope: 'all' },
  ],

  accountant: [
    { key: 'child:read', scope: 'branch' },
    { key: 'guardian:read', scope: 'branch' },
    { key: 'tariff:manage', scope: 'all' },
    { key: 'charge:read', scope: 'all' },
    { key: 'charge:generate', scope: 'all' },
    { key: 'charge:reverse', scope: 'all' },
    { key: 'payment:read', scope: 'all' },
    { key: 'payment:create', scope: 'all' },
    { key: 'payment:cancel', scope: 'all' },
    { key: 'discount:manage', scope: 'all' },
    { key: 'period:close', scope: 'all' },
    { key: 'debt:read', scope: 'all' },
    { key: 'billing_rules:manage', scope: 'all' },
    { key: 'expense:read', scope: 'all' },
    { key: 'expense:manage', scope: 'all' },
    { key: 'report:read', scope: 'all' },
    { key: 'dashboard:read', scope: 'all' },
    { key: 'import:manage', scope: 'all' },
    { key: 'file:read', scope: 'branch' },
  ],

  teacher: [
    { key: 'child:read', scope: 'own_group' },
    { key: 'medical:alerts', scope: 'own_group' },
    { key: 'attendance:read', scope: 'own_group' },
    { key: 'attendance:checkin', scope: 'own_group' },
    { key: 'attendance:checkout', scope: 'own_group' },
    { key: 'pickup:read', scope: 'own_group' },
    { key: 'file:read', scope: 'own_group' },
  ],

  reception: [
    { key: 'child:read', scope: 'branch' },
    { key: 'guardian:read', scope: 'branch' },
    { key: 'attendance:read', scope: 'today' },
    { key: 'attendance:checkin', scope: 'today' },
    { key: 'attendance:checkout', scope: 'today' },
    { key: 'pickup:read', scope: 'branch' },
    { key: 'pickup:manage', scope: 'branch' },
    { key: 'pickup:temporary', scope: 'branch' },
  ],

  nurse: [
    { key: 'child:read', scope: 'branch' },
    { key: 'medical:read', scope: 'branch' },
    { key: 'medical:write', scope: 'branch' },
    { key: 'medical:alerts', scope: 'branch' },
  ],
};

// The five templates from 05-telegram-spec.md §5 — both languages
// mandatory, variables[] declared up front so a typo'd placeholder fails
// loudly on the next PUT rather than rendering literal text to parents.
const DEFAULT_TEMPLATES: {
  key: string;
  bodyUz: string;
  bodyRu: string;
  variables: string[];
}[] = [
  {
    key: 'child_arrived',
    bodyUz: "{child} bog'chaga keldi. Vaqt: {time}",
    bodyRu: '{child} прибыл(а) в детский сад. Время: {time}',
    variables: ['child', 'time'],
  },
  {
    key: 'child_departed',
    bodyUz: "{child} bog'chadan ketdi. Kim olib ketdi: {pickup}. Vaqt: {time}",
    bodyRu: '{child} покинул(а) детский сад. Забрал(а): {pickup}. Время: {time}',
    variables: ['child', 'pickup', 'time'],
  },
  {
    key: 'payment_received',
    bodyUz: "To'lov qabul qilindi: {amount}. Kvitansiya: {receipt}",
    bodyRu: 'Платёж принят: {amount}. Квитанция: {receipt}',
    variables: ['amount', 'receipt'],
  },
  {
    key: 'charge_created',
    bodyUz: "{month} uchun hisob: {amount}. To'lov muddati: {due}",
    bodyRu: 'Начисление за {month}: {amount}. Срок оплаты: {due}',
    variables: ['month', 'amount', 'due'],
  },
  {
    key: 'debt_reminder',
    bodyUz: "Qarzdorlik: {amount}. Iltimos, {due} gacha to'lang.",
    bodyRu: 'Задолженность: {amount}. Просим оплатить до {due}.',
    variables: ['amount', 'due'],
  },
  {
    key: 'event_reminder',
    bodyUz: "Eslatma: {event}. Sana: {date}, vaqt: {time}.",
    bodyRu: 'Напоминание: {event}. Дата: {date}, время: {time}.',
    variables: ['event', 'date', 'time'],
  },
  // Deliberately vague per 05-telegram-spec.md §5: "Never send medical
  // information via Telegram. Health incidents notify with 'please
  // contact the kindergarten,' nothing more" — {message} is a short,
  // non-clinical pointer ("your child needs attention"), never symptoms
  // or diagnosis.
  {
    key: 'emergency',
    bodyUz: "DIQQAT: {child} bilan bog'liq {message}. Iltimos, bog'cha bilan zudlik bilan bog'laning: {phone}",
    bodyRu: 'ВНИМАНИЕ: {message} по поводу {child}. Пожалуйста, немедленно свяжитесь с детским садом: {phone}',
    variables: ['child', 'message', 'phone'],
  },
];

const SYSTEM_ROLES: { code: string; nameUz: string; nameRu: string; isProtected?: boolean }[] = [
  { code: 'owner', nameUz: 'Egasi', nameRu: 'Владелец', isProtected: true },
  { code: 'director', nameUz: 'Direktor', nameRu: 'Директор' },
  { code: 'administrator', nameUz: 'Administrator', nameRu: 'Администратор' },
  { code: 'accountant', nameUz: 'Buxgalter', nameRu: 'Бухгалтер' },
  { code: 'teacher', nameUz: 'Tarbiyachi', nameRu: 'Воспитатель' },
  { code: 'reception', nameUz: 'Qabulxona', nameRu: 'Ресепшн' },
  { code: 'nurse', nameUz: 'Hamshira', nameRu: 'Медсестра' },
];

async function syncPermissionCatalog() {
  for (const perm of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      create: {
        key: perm.key,
        permGroup: perm.group,
        descriptionUz: perm.descriptionUz,
        descriptionRu: perm.descriptionRu,
        allowedScopes: [...perm.scopes],
        sensitive: perm.sensitive ?? false,
      },
      update: {
        permGroup: perm.group,
        descriptionUz: perm.descriptionUz,
        descriptionRu: perm.descriptionRu,
        allowedScopes: [...perm.scopes],
        sensitive: perm.sensitive ?? false,
        deprecated: false,
      },
    });
  }
  console.log(`Permission catalog synced: ${PERMISSION_CATALOG.length} keys`);
}

async function main() {
  const tenantCode = process.env.SEED_TENANT_CODE ?? 'demo';
  const tenantName = process.env.SEED_TENANT_NAME ?? 'Demo Kindergarten';
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

  await syncPermissionCatalog();

  const tenant = await prisma.tenant.upsert({
    where: { code: tenantCode },
    create: { code: tenantCode, name: tenantName },
    update: { name: tenantName },
  });
  console.log(`Tenant: ${tenant.code} (${tenant.id})`);

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'main' } },
    create: { tenantId: tenant.id, code: 'main', name: `${tenantName} — Main` },
    update: {},
  });
  console.log(`Branch: ${branch.code} (${branch.id})`);

  await prisma.setting.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, displayName: tenantName },
    update: {},
  });

  for (const t of DEFAULT_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { tenantId_templateKey: { tenantId: tenant.id, templateKey: t.key } },
      create: {
        tenantId: tenant.id,
        templateKey: t.key,
        bodyUz: t.bodyUz,
        bodyRu: t.bodyRu,
        variables: t.variables,
        // charge_created/debt_reminder amounts are visible by default —
        // a tenant can flip this off per §5 "Privacy defaults".
        includeAmounts: true,
      },
      update: {},
    });
  }
  console.log(`Notification templates: ${DEFAULT_TEMPLATES.length} seeded`);

  const roleIdByCode = new Map<string, string>();
  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: def.code } },
      create: {
        tenantId: tenant.id,
        code: def.code,
        nameUz: def.nameUz,
        nameRu: def.nameRu,
        isSystem: true,
        isProtected: def.isProtected ?? false,
      },
      update: { nameUz: def.nameUz, nameRu: def.nameRu, isSystem: true },
    });
    roleIdByCode.set(def.code, role.id);

    const grants = ROLE_GRANTS[def.code] ?? [];
    for (const grant of grants) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: role.id, permissionKey: grant.key } },
        create: { roleId: role.id, permissionKey: grant.key, scope: grant.scope },
        update: { scope: grant.scope },
      });
    }
    console.log(`Role: ${def.code} — ${grants.length} grant(s)`);
  }

  const ownerRoleId = roleIdByCode.get('owner')!;
  const passwordHash = await argon2.hash(ownerPassword, { type: argon2.argon2id });

  const owner = await prisma.appUser.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: ownerEmail } },
    create: {
      tenantId: tenant.id,
      fullName: 'Owner',
      email: ownerEmail,
      phone: '+998900000000',
      passwordHash,
      status: 'active',
    },
    update: {},
  });

  // NOTE: user_role.branch_id is documented as "NULL = all branches", and
  // 01-schema.sql even adds a partial unique index for that NULL case
  // (uq_user_role_allbranch) — but branch_id is also part of the composite
  // PRIMARY KEY (user_id, role_id, branch_id), and Postgres silently forces
  // every primary-key column NOT NULL. So branch_id can never actually be
  // NULL as delivered; the "all branches" case is unreachable. Harmless
  // for Stage 1 (single branch, so "this branch" and "all branches" are
  // the same set) but this needs a schema fix — drop branch_id from the
  // PK and rely solely on uq_user_role_allbranch + a second partial unique
  // index for the non-null case — before a second branch is added.
  await prisma.userRole.upsert({
    where: { userId_roleId_branchId: { userId: owner.id, roleId: ownerRoleId, branchId: branch.id } },
    create: { userId: owner.id, roleId: ownerRoleId, branchId: branch.id },
    update: {},
  });

  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId: owner.id, branchId: branch.id } },
    create: { userId: owner.id, branchId: branch.id },
    update: {},
  });

  console.log(`\nOwner login: ${ownerEmail} / ${ownerPassword}`);
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

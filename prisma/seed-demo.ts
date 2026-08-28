/**
 * Realistic demo/test dataset: groups, staff (one per non-owner role),
 * children + guardians, tariffs, a full month of attendance history, a
 * committed billing run, payments (some deliberately partial/missing, to
 * produce real debts), and a couple of discounts.
 *
 * Deliberately drives the real HTTP API rather than writing to the
 * database directly — every record goes through the same validation,
 * RBAC, and billing-engine code path a real admin's browser would hit, so
 * the data this produces is guaranteed internally consistent (correct
 * proration, correct ledger rows, correct debt totals) without
 * duplicating any of that logic here.
 *
 * Requires: `npm run seed` has already run (needs the tenant/branch/roles
 * it creates and logs in as the Owner it creates), and the API server is
 * running and reachable at APP_URL.
 *
 * NEVER run this against a tenant real users depend on — it creates fake
 * children and guardians. Refuses to run when NODE_ENV=production unless
 * ALLOW_DEMO_SEED_IN_PRODUCTION=true is ALSO set — a deliberate two-step
 * opt-in, not a single flag flip, so this can't land in the wrong tenant
 * by accident. The intended production use is a separate, isolated demo
 * tenant on the same server (different SEED_TENANT_CODE / SEED_OWNER_EMAIL
 * from the real one — see DEPLOYMENT.md) — never the real tenant itself.
 */
import { randomUUID } from 'node:crypto';

const inProduction = process.env.NODE_ENV === 'production';
const prodOverride = process.env.ALLOW_DEMO_SEED_IN_PRODUCTION === 'true';

if (inProduction && !prodOverride) {
  console.error(
    'seed-demo will not run with NODE_ENV=production — this creates fake ' +
      'children and guardians, which must never touch a real tenant. Point ' +
      'it at a local/dev/staging database, or set ' +
      'ALLOW_DEMO_SEED_IN_PRODUCTION=true against an isolated demo tenant ' +
      '(see DEPLOYMENT.md) if you specifically mean to run this in production.',
  );
  process.exit(1);
}

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';

if (inProduction && prodOverride) {
  console.warn(
    `ALLOW_DEMO_SEED_IN_PRODUCTION=true — running against a PRODUCTION server, ` +
      `logging in as "${OWNER_EMAIL}". This MUST be an isolated demo tenant's ` +
      `owner, never the real one. Ctrl-C now if that's not true. Continuing in 5s...`,
  );
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:3010';
const API_PREFIX = process.env.API_PREFIX ?? '/api/v1';
const BASE = `${APP_URL}${API_PREFIX}`;
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

let token = '';

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotent?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotent) headers['Idempotency-Key'] = randomUUID();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Tashkent has no DST and is a fixed UTC+5 year-round — an explicit
// offset here means the server derives the intended calendar day
// regardless of what timezone this script itself runs in.
function isoDateTime(y: number, m: number, d: number, hh: number, mm: number): string {
  return `${isoDate(y, m, d)}T${pad2(hh)}:${pad2(mm)}:00+05:00`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// --- name pools (Uzbek) ----------------------------------------------
const MALE_FIRST = [
  'Aziz', 'Bekzod', 'Sardor', 'Jasur', 'Otabek', 'Farrux', 'Shavkat', 'Umid', 'Davron', 'Nodir',
];
const FEMALE_FIRST = [
  'Malika', 'Dilnoza', 'Nilufar', 'Gulnora', 'Zarina', 'Madina', 'Feruza', 'Shahnoza', 'Sevara', 'Nigora',
];
const SURNAMES_M = [
  'Aliyev', 'Karimov', 'Yusupov', 'Rashidov', 'Nazarov', 'Xolmatov', 'Sodiqov', 'Toshpulatov', 'Mirzayev', 'Qodirov',
];
const SURNAMES_F = [
  'Aliyeva', 'Karimova', 'Yusupova', 'Rashidova', 'Nazarova', 'Xolmatova', 'Sodiqova', 'Toshpulatova', 'Mirzayeva', 'Qodirova',
];

function randomPerson(): { firstName: string; lastName: string; gender: 'male' | 'female' } {
  const gender = Math.random() < 0.5 ? 'male' : 'female';
  return gender === 'male'
    ? { firstName: pick(MALE_FIRST), lastName: pick(SURNAMES_M), gender }
    : { firstName: pick(FEMALE_FIRST), lastName: pick(SURNAMES_F), gender };
}

let phoneCounter = 900000001;
function nextStaffPhone(): string {
  return `+998${phoneCounter++}`;
}
let guardianPhoneCounter = 901000001;
function nextGuardianPhone(): string {
  return `+998${guardianPhoneCounter++}`;
}

async function main() {
  if (inProduction && prodOverride) await delay(5000);

  console.log(`Target API: ${BASE}`);

  const login = await api<{ accessToken: string }>('POST', '/auth/login', {
    login: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  token = login.accessToken;
  console.log('Logged in as Owner.');

  const branches = await api<{ id: string; code: string }[]>('GET', '/branches');
  const branch = branches.find((b) => b.code === 'main') ?? branches[0];
  if (!branch) throw new Error("No branch found — run 'npm run seed' first.");
  console.log(`Branch: ${branch.code} (${branch.id})`);

  const roles = await api<{ id: string; code: string }[]>('GET', '/roles?includeSystem=true');
  const roleId = (code: string): string => {
    const r = roles.find((x) => x.code === code);
    if (!r) throw new Error(`Role '${code}' not found — run 'npm run seed' first.`);
    return r.id;
  };

  // --- groups ------------------------------------------------------
  console.log('\nCreating groups...');
  const groupDefs = [
    { name: 'Kichkintoylar (1-2 yosh)', ageMinMonths: 12, ageMaxMonths: 24 },
    { name: "O'rtacha guruh (2-4 yosh)", ageMinMonths: 25, ageMaxMonths: 48 },
    { name: 'Katta guruh (4-6 yosh)', ageMinMonths: 49, ageMaxMonths: 72 },
  ];
  const groups: { id: string; name: string; ageMinMonths: number; ageMaxMonths: number }[] = [];
  for (const g of groupDefs) {
    const created = await api<{ id: string }>('POST', '/groups', {
      branchId: branch.id,
      name: g.name,
      ageMinMonths: g.ageMinMonths,
      ageMaxMonths: g.ageMaxMonths,
      capacity: 25,
    });
    groups.push({ id: created.id, ...g });
    console.log(`  Group: ${g.name} (${created.id})`);
  }

  // --- staff (one per non-owner role) -------------------------------
  console.log('\nCreating staff users...');
  const staffDefs = [
    { role: 'director', fullName: 'Sardor Rashidov' },
    { role: 'administrator', fullName: 'Nilufar Karimova' },
    { role: 'accountant', fullName: 'Dilnoza Yusupova' },
    { role: 'teacher', fullName: 'Gulnora Nazarova' },
    { role: 'reception', fullName: 'Aziz Mirzayev' },
    { role: 'nurse', fullName: 'Feruza Sodiqova' },
  ];
  for (const s of staffDefs) {
    const created = await api<{ id: string }>('POST', '/users', {
      fullName: s.fullName,
      phone: nextStaffPhone(),
      email: `${s.role}@alishaxkids.uz`,
      password: 'TempPass1234!',
      roleId: roleId(s.role),
      branchIds: [branch.id],
    });
    console.log(`  ${s.role}: ${s.fullName} (${created.id})`);
  }

  // --- tariffs -------------------------------------------------------
  console.log('\nCreating tariffs...');
  const monthlyTariff = await api<{ id: string }>('POST', '/tariffs', {
    name: "Oylik to'lov",
    kind: 'monthly_fixed',
    amountTiyin: '180000000', // 1,800,000 so'm
  });
  console.log(`  monthly_fixed: Oylik to'lov (${monthlyTariff.id})`);

  const mealTariff = await api<{ id: string }>('POST', '/tariffs', {
    name: 'Ovqatlanish',
    kind: 'meal',
    amountTiyin: '35000000', // 350,000 so'm, prorated per attended day
  });
  console.log(`  meal: Ovqatlanish (${mealTariff.id})`);

  // --- billing period target: the most recently completed calendar
  // month, so there's a full month of history to bill against.
  const now = new Date();
  const billYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const billMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() is 0-indexed
  console.log(`\nBilling target month: ${billYear}-${pad2(billMonth)}`);

  // Assignments (tariffs, enrollment) start a month before the billing
  // month, comfortably before it — otherwise childrenWithActiveTariffs()
  // wouldn't pick them up for that period.
  const enrollYear = billMonth === 1 ? billYear - 1 : billYear;
  const enrollMonth = billMonth === 1 ? 12 : billMonth - 1;
  const enrollDate = isoDate(enrollYear, enrollMonth, 1);

  // --- children + guardians ------------------------------------------
  console.log('\nCreating children + guardians...');
  type Child = { id: string; groupId: string };
  const children: Child[] = [];
  const CHILDREN_PER_GROUP = 5;

  for (const group of groups) {
    for (let i = 0; i < CHILDREN_PER_GROUP; i++) {
      const kid = randomPerson();
      const ageMonths = randInt(group.ageMinMonths, group.ageMaxMonths);
      const birth = new Date(now);
      birth.setMonth(birth.getMonth() - ageMonths);
      const birthDate = isoDate(birth.getFullYear(), birth.getMonth() + 1, birth.getDate());

      const child = await api<{ id: string }>('POST', '/children', {
        branchId: branch.id,
        firstName: kid.firstName,
        lastName: kid.lastName,
        birthDate,
        gender: kid.gender,
        enrollmentDate: enrollDate,
      });

      const guardian = randomPerson();
      const isFather = guardian.gender === 'male';
      const createdGuardian = await api<{ id: string }>('POST', '/guardians', {
        fullName: guardian.firstName + ' ' + guardian.lastName,
        phone: nextGuardianPhone(),
        preferredLanguage: 'uz',
      });
      await api('POST', `/children/${child.id}/guardians`, {
        guardianId: createdGuardian.id,
        relationship: isFather ? 'father' : 'mother',
        isPayer: true,
        isEmergencyContact: true,
        isPrimaryContact: true,
      });

      await api('POST', `/groups/${group.id}/children`, {
        childId: child.id,
        effectiveDate: enrollDate,
      });

      await api('POST', `/children/${child.id}/tariffs`, {
        tariffId: monthlyTariff.id,
        effectiveFrom: enrollDate,
      });
      await api('POST', `/children/${child.id}/tariffs`, {
        tariffId: mealTariff.id,
        effectiveFrom: enrollDate,
      });

      children.push({ id: child.id, groupId: group.id });
    }
    console.log(`  ${CHILDREN_PER_GROUP} children in ${group.name}`);
  }
  console.log(`  ${children.length} children total.`);

  // --- discounts: 2 children get a 10% discount ----------------------
  console.log('\nCreating discounts...');
  for (const child of children.slice(0, 2)) {
    await api('POST', `/children/${child.id}/discounts`, {
      kind: 'percent',
      value: 1000, // 1000 basis points = 10%
      validFrom: enrollDate,
      reason: "Doimiy mijoz chegirmasi",
    });
  }
  console.log('  2 discounts created.');

  // --- attendance: every weekday of the billing month, ~85% turnout --
  console.log(`\nSeeding attendance for ${billYear}-${pad2(billMonth)}...`);
  const totalDays = daysInMonth(billYear, billMonth);
  let attendanceCount = 0;
  for (const child of children) {
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(Date.UTC(billYear, billMonth - 1, d));
      const dow = date.getUTCDay(); // 0=Sun..6=Sat
      if (dow === 0 || dow === 6) continue; // weekends
      if (Math.random() > 0.85) continue; // ~15% absence rate

      const inHour = randInt(7, 9);
      const inMin = randInt(0, 59);
      const outHour = randInt(17, 19);
      const outMin = randInt(0, 59);

      await api('POST', '/attendance/check-in', {
        childId: child.id,
        at: isoDateTime(billYear, billMonth, d, inHour, inMin),
      });
      await api('POST', '/attendance/check-out', {
        childId: child.id,
        at: isoDateTime(billYear, billMonth, d, outHour, outMin),
      });
      attendanceCount++;
    }
  }
  console.log(`  ${attendanceCount} attended days recorded.`);

  // --- billing run: preview then commit -------------------------------
  console.log('\nRunning billing...');
  const run = await api<{ id: string }>('POST', '/billing-runs', {
    year: billYear,
    month: billMonth,
  });
  console.log(`  Preview created: ${run.id}`);
  await api('POST', `/billing-runs/${run.id}/commit`, undefined, { idempotent: true });
  console.log('  Committed.');

  // --- payments: most children pay in full, a few partial/none -------
  console.log('\nRecording payments...');
  const payYear = billMonth === 12 ? billYear + 1 : billYear;
  const payMonth = billMonth === 12 ? 1 : billMonth + 1;
  const dueDateForPayments = isoDate(payYear, payMonth, 5);
  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const charges = await api<{ amountTiyin: string }[]>(
      'GET',
      `/children/${child.id}/charges`,
    );
    const total = charges.reduce((acc, c) => acc + BigInt(c.amountTiyin), 0n);
    if (total <= 0n) continue;

    // Last child in the list: no payment at all (full debt).
    if (i === children.length - 1) {
      unpaidCount++;
      continue;
    }
    // Two children before that: partial payment (~50%, full debt owed).
    const isPartial = i === children.length - 2 || i === children.length - 3;
    const amount = isPartial ? total / 2n : total;

    await api(
      'POST',
      '/payments',
      {
        childId: child.id,
        amountTiyin: amount.toString(),
        method: pick(['cash', 'card', 'bank'] as const),
        paidAt: dueDateForPayments,
      },
      { idempotent: true },
    );
    if (isPartial) partialCount++;
    else paidCount++;
  }
  console.log(`  ${paidCount} paid in full, ${partialCount} partial, ${unpaidCount} unpaid (debt).`);

  console.log('\nDemo seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

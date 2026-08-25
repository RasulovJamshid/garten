import { CreateChildDto } from '../children/dto/create-child.dto';
import { CreateGuardianDto } from '../guardians/dto/create-guardian.dto';
import { CreateGroupDto } from '../groups/dto/create-group.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { CreateExpenseDto } from '../expenses/dto/expense.dto';
import { normalizePhone } from '../common/phone';

export interface ImportLookup {
  branchIdByCode: Map<string, string>;
  roleIdByCode: Map<string, string>;
}

export interface ParsedRow<T> {
  data?: T;
  errors: string[];
}

export interface OpeningBalanceRow {
  childId: string;
  amountTiyin: string;
  asOfDate: string;
  note?: string;
}

export interface UserImportRow {
  dto: CreateUserDto;
  password: string;
}

export interface ImportHandler<T> {
  templateColumns: { key: string; header: string }[];
  parseRow(raw: Record<string, string>, lookup: ImportLookup): ParsedRow<T>;
}

const EXPENSE_TYPES = new Set([
  'electricity',
  'gas',
  'cold_water',
  'hot_water',
  'heating',
  'waste',
  'internet',
  'telephone',
  'security',
  'rent',
  'other',
]);

function required(raw: Record<string, string>, field: string, errors: string[]): string {
  const v = raw[field];
  if (!v) errors.push(`"${field}" is required`);
  return v ?? '';
}

function isValidDate(s: string): boolean {
  return !Number.isNaN(Date.parse(s));
}

function randomPassword(): string {
  // 12 chars, alnum — plenty for an admin-distributed temp password that
  // must be changed on first real login (Stage 1 has no forced-change
  // flow yet, so this is communicated out of band by whoever ran the import).
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

export const IMPORT_HANDLERS: Record<string, ImportHandler<any>> = {
  children: {
    templateColumns: [
      { key: 'firstName', header: 'firstName' },
      { key: 'lastName', header: 'lastName' },
      { key: 'middleName', header: 'middleName' },
      { key: 'birthDate', header: 'birthDate (YYYY-MM-DD)' },
      { key: 'gender', header: 'gender (male|female)' },
      { key: 'branchCode', header: 'branchCode' },
      { key: 'enrollmentDate', header: 'enrollmentDate (YYYY-MM-DD)' },
    ],
    parseRow(raw, lookup): ParsedRow<CreateChildDto> {
      const errors: string[] = [];
      const firstName = required(raw, 'firstName', errors);
      const lastName = required(raw, 'lastName', errors);
      const birthDate = required(raw, 'birthDate', errors);
      if (birthDate && !isValidDate(birthDate)) errors.push('"birthDate" is not a valid date');
      const branchCode = required(raw, 'branchCode', errors);
      const branchId = branchCode ? lookup.branchIdByCode.get(branchCode) : undefined;
      if (branchCode && !branchId) errors.push(`Unknown branchCode "${branchCode}"`);
      if (raw.gender && !['male', 'female'].includes(raw.gender)) {
        errors.push('"gender" must be male or female');
      }
      if (raw.enrollmentDate && !isValidDate(raw.enrollmentDate)) {
        errors.push('"enrollmentDate" is not a valid date');
      }
      if (errors.length > 0) return { errors };
      return {
        errors: [],
        data: {
          branchId: branchId!,
          firstName,
          lastName,
          middleName: raw.middleName || undefined,
          birthDate,
          gender: raw.gender || undefined,
          enrollmentDate: raw.enrollmentDate || undefined,
        },
      };
    },
  },

  guardians: {
    templateColumns: [
      { key: 'fullName', header: 'fullName' },
      { key: 'phone', header: 'phone' },
      { key: 'email', header: 'email' },
      { key: 'preferredLanguage', header: 'preferredLanguage (uz|ru)' },
    ],
    parseRow(raw): ParsedRow<CreateGuardianDto> {
      const errors: string[] = [];
      const fullName = required(raw, 'fullName', errors);
      const rawPhone = required(raw, 'phone', errors);
      if (raw.preferredLanguage && !['uz', 'ru'].includes(raw.preferredLanguage)) {
        errors.push('"preferredLanguage" must be uz or ru');
      }
      if (errors.length > 0) return { errors };
      return {
        errors: [],
        data: {
          fullName,
          phone: normalizePhone(rawPhone),
          email: raw.email || undefined,
          preferredLanguage: raw.preferredLanguage as 'uz' | 'ru' | undefined,
        } as CreateGuardianDto,
      };
    },
  },

  groups: {
    templateColumns: [
      { key: 'name', header: 'name' },
      { key: 'branchCode', header: 'branchCode' },
      { key: 'capacity', header: 'capacity' },
      { key: 'ageMinMonths', header: 'ageMinMonths' },
      { key: 'ageMaxMonths', header: 'ageMaxMonths' },
    ],
    parseRow(raw, lookup): ParsedRow<CreateGroupDto> {
      const errors: string[] = [];
      const name = required(raw, 'name', errors);
      const branchCode = required(raw, 'branchCode', errors);
      const branchId = branchCode ? lookup.branchIdByCode.get(branchCode) : undefined;
      if (branchCode && !branchId) errors.push(`Unknown branchCode "${branchCode}"`);
      if (raw.capacity && Number.isNaN(Number(raw.capacity)))
        errors.push('"capacity" must be a number');
      if (errors.length > 0) return { errors };
      return {
        errors: [],
        data: {
          branchId: branchId!,
          name,
          capacity: raw.capacity ? Number(raw.capacity) : undefined,
          ageMinMonths: raw.ageMinMonths ? Number(raw.ageMinMonths) : undefined,
          ageMaxMonths: raw.ageMaxMonths ? Number(raw.ageMaxMonths) : undefined,
        },
      };
    },
  },

  users: {
    templateColumns: [
      { key: 'fullName', header: 'fullName' },
      { key: 'phone', header: 'phone' },
      { key: 'email', header: 'email' },
      { key: 'roleCode', header: 'roleCode' },
      { key: 'branchCode', header: 'branchCode' },
    ],
    parseRow(raw, lookup): ParsedRow<UserImportRow> {
      const errors: string[] = [];
      const fullName = required(raw, 'fullName', errors);
      const phone = required(raw, 'phone', errors);
      const roleCode = required(raw, 'roleCode', errors);
      const branchCode = required(raw, 'branchCode', errors);
      const roleId = roleCode ? lookup.roleIdByCode.get(roleCode) : undefined;
      if (roleCode && !roleId) errors.push(`Unknown roleCode "${roleCode}"`);
      const branchId = branchCode ? lookup.branchIdByCode.get(branchCode) : undefined;
      if (branchCode && !branchId) errors.push(`Unknown branchCode "${branchCode}"`);
      if (errors.length > 0) return { errors };
      const password = randomPassword();
      return {
        errors: [],
        data: {
          password,
          dto: {
            fullName,
            phone: normalizePhone(phone),
            email: raw.email || undefined,
            password,
            roleId: roleId!,
            branchIds: [branchId!],
          },
        },
      };
    },
  },

  opening_balances: {
    templateColumns: [
      { key: 'childId', header: 'childId (uuid)' },
      { key: 'amountTiyin', header: 'amountTiyin' },
      { key: 'asOfDate', header: 'asOfDate (YYYY-MM-DD)' },
      { key: 'note', header: 'note' },
    ],
    parseRow(raw): ParsedRow<OpeningBalanceRow> {
      const errors: string[] = [];
      const childId = required(raw, 'childId', errors);
      const amountRaw = required(raw, 'amountTiyin', errors);
      if (amountRaw && !/^\d+$/.test(amountRaw)) {
        errors.push('"amountTiyin" must be a non-negative integer string');
      }
      const asOfDate = raw.asOfDate || new Date().toISOString().slice(0, 10);
      if (!isValidDate(asOfDate)) errors.push('"asOfDate" is not a valid date');
      if (errors.length > 0) return { errors };
      return {
        errors: [],
        data: { childId, amountTiyin: amountRaw, asOfDate, note: raw.note || undefined },
      };
    },
  },

  expenses: {
    templateColumns: [
      { key: 'branchCode', header: 'branchCode' },
      { key: 'type', header: 'type' },
      { key: 'provider', header: 'provider' },
      { key: 'billingYear', header: 'billingYear' },
      { key: 'billingMonth', header: 'billingMonth' },
      { key: 'amountTiyin', header: 'amountTiyin' },
      { key: 'dueDate', header: 'dueDate (YYYY-MM-DD)' },
    ],
    parseRow(raw, lookup): ParsedRow<CreateExpenseDto> {
      const errors: string[] = [];
      const branchCode = required(raw, 'branchCode', errors);
      const branchId = branchCode ? lookup.branchIdByCode.get(branchCode) : undefined;
      if (branchCode && !branchId) errors.push(`Unknown branchCode "${branchCode}"`);
      const type = required(raw, 'type', errors);
      if (type && !EXPENSE_TYPES.has(type))
        errors.push(`"type" must be one of: ${[...EXPENSE_TYPES].join(', ')}`);
      const billingYear = Number(required(raw, 'billingYear', errors));
      const billingMonth = Number(required(raw, 'billingMonth', errors));
      const amountTiyin = required(raw, 'amountTiyin', errors);
      if (amountTiyin && !/^\d+$/.test(amountTiyin)) {
        errors.push('"amountTiyin" must be a non-negative integer string');
      }
      if (errors.length > 0) return { errors };
      return {
        errors: [],
        data: {
          branchId: branchId!,
          type: type as CreateExpenseDto['type'],
          provider: raw.provider || undefined,
          billingYear,
          billingMonth,
          amountTiyin,
          dueDate: raw.dueDate || undefined,
        },
      };
    },
  },
};

export type ImportEntity = keyof typeof IMPORT_HANDLERS;

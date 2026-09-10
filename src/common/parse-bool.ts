import { AppErrors } from './exceptions/app.exception';

/**
 * Query strings have no booleans. An unparseable value is a 422 rather
 * than a silent `false` — a filter that quietly does nothing is the same
 * class of bug as a scope that quietly matches nothing.
 */
export function parseBool(value: string | undefined, field: string): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw AppErrors.validationFailed({ [field]: "Expected 'true' or 'false'" });
}

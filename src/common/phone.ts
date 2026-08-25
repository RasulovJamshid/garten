/**
 * Normalizes to +998XXXXXXXXX. Guardians are deduplicated by (tenantId,
 * phone) — this happens server-side on write so "998901234567",
 * "901234567", and "+998 90 123 45 67" all collapse to one record
 * (api-spec §5, ops-reference migration runbook phase 2).
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('998') && digits.length === 12) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;
  if (digits.startsWith('8') && digits.length === 10) return `+998${digits.slice(1)}`;
  return `+${digits}`;
}

import { z } from 'zod';

/**
 * Every variable the app depends on, validated once at boot. A server that
 * starts with e.g. JWT_SECRET undefined is a silent catastrophe — fail fast
 * instead (kindergarten-docs/docs/06-ops-reference.md §3).
 */
const csv = () =>
  z.string().transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

// z.coerce.boolean() just calls Boolean(value), so the STRING "false" is
// truthy and coerces to `true` — a real footgun for env vars. Parse the
// literal text instead. `.default()` is applied at the string stage (not
// after `.transform`) so it supplies a string the transform can consume.
const boolString = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', ''])
    .default(defaultValue ? 'true' : 'false')
    .catch('false')
    .transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  APP_URL: z.string().url(),
  // Explicit allow-list, never reflected wholesale: `credentials: true`
  // paired with a reflected/wildcard origin (main.ts previously did
  // `origin: true`) lets any website read authenticated responses using
  // the browser's ambient cookies — a real CORS hole, not a theoretical
  // one. Defaults to APP_URL alone so a fresh deployment is closed by
  // default rather than silently permissive.
  CORS_ORIGINS: csv().optional(),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./data/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: boolString(true),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(20),
  ALLOWED_MIME: csv().default('image/jpeg,image/png,image/webp,application/pdf'),

  TELEGRAM_ENABLED: boolString(false),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(25),

  DEFAULT_TIMEZONE: z.string().default('Asia/Tashkent'),
  DEFAULT_LANGUAGE: z.enum(['uz', 'ru']).default('ru'),
  DEFAULT_CURRENCY: z.string().default('UZS'),

  PGBOSS_SCHEMA: z.string().default('jobs'),
  JOB_CONCURRENCY: z.coerce.number().int().positive().default(5),
  // api-spec §11: "Under ~5,000 rows, generate synchronously and stream
  // the file" — above it, queue a background export_job instead.
  // Configurable so it can be lowered for testing without touching code.
  REPORT_ASYNC_ROW_THRESHOLD: z.coerce.number().int().positive().default(5000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),

  SEED_TENANT_CODE: z.string().default('demo'),
  SEED_TENANT_NAME: z.string().default('Demo Kindergarten'),
  SEED_OWNER_EMAIL: z.string().email().default('owner@demo.local'),
  SEED_OWNER_PASSWORD: z.string().default('ChangeMe12345!'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${details}`);
    throw new Error('Invalid environment configuration. See above for details.');
  }

  if (result.data.STORAGE_DRIVER === 's3') {
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      if (!result.data[key]) {
        throw new Error(`STORAGE_DRIVER=s3 but ${key} is not set`);
      }
    }
  }

  if (result.data.TELEGRAM_ENABLED) {
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME'] as const) {
      if (!result.data[key]) {
        throw new Error(`TELEGRAM_ENABLED=true but ${key} is not set`);
      }
    }
    if (result.data.TELEGRAM_MODE === 'webhook' && !result.data.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error('TELEGRAM_MODE=webhook but TELEGRAM_WEBHOOK_SECRET is not set');
    }
  }

  return result.data;
}

import * as Sentry from '@sentry/node';

/**
 * Must be imported before anything else in main.ts (Sentry's own
 * requirement, for its auto-instrumentation to attach before other
 * modules load). Reads process.env directly rather than AppConfigService
 * — Nest hasn't bootstrapped yet at this point, so the DI container and
 * its validated env schema don't exist yet either. A missing SENTRY_DSN
 * is a no-op, not an error: error reporting is optional infrastructure,
 * never something that should block boot.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

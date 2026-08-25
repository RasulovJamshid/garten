/**
 * pg-boss ships ESM-only (no CJS entry point), which Jest's CommonJS
 * transform pipeline can't load ("Cannot use import statement outside a
 * module") — a well-known Jest/ESM friction point, unrelated to anything
 * in this app. e2e tests exercise HTTP + DB behavior, not background job
 * processing, so a no-op stub is not just a workaround but the right
 * fake here: every PgBossService method resolves immediately, keeping
 * AppModule's real bootstrap (JobsModule -> PgBossService -> pg-boss)
 * loadable under test without ever touching a real job queue.
 */
export class PgBoss {
  on(): void {}
  async start(): Promise<this> {
    return this;
  }
  async stop(): Promise<void> {}
  async createQueue(): Promise<void> {}
  async send(): Promise<string | null> {
    return null;
  }
  async schedule(): Promise<void> {}
  async work(): Promise<string> {
    return 'mock-worker-id';
  }
}

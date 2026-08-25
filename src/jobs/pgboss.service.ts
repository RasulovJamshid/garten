import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import type { JobWithMetadata, ScheduleOptions, SendOptions, WorkOptions } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';

/**
 * Thin wrapper around a single pg-boss instance, started once at boot and
 * stopped gracefully on shutdown (kindergarten-docs 01-stage1-plan.md §8 —
 * async work, e.g. Telegram sends, must never block the request that
 * triggered it). Domain modules never construct PgBoss themselves; they
 * inject this and call `send`/`work`.
 *
 * `send`/`work` await `ready` rather than assume `onApplicationBootstrap`
 * already ran: Nest does not order `onApplicationBootstrap` across
 * modules that aren't directly connected in the import graph, and
 * JobsModule is `@Global()` precisely so it has no such edge to whatever
 * calls in — a consumer's own bootstrap hook (e.g.
 * NotificationWorkerService registering its queue) can and does fire
 * before this one.
 */
@Injectable()
export class PgBossService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  private boss?: PgBoss;
  private resolveReady!: () => void;
  private readonly ready = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });

  constructor(private readonly config: AppConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const schema = this.config.get('PGBOSS_SCHEMA');
    this.boss = new PgBoss({
      connectionString: this.config.get('DATABASE_URL'),
      schema,
    });
    this.boss.on('error', (err: Error) => this.logger.error(err));
    await this.boss.start();
    this.logger.log(`pg-boss started (schema=${schema})`);
    this.resolveReady();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss) {
      await this.boss.stop({ graceful: true, timeout: 5000 });
    }
  }

  private async instance(): Promise<PgBoss> {
    await this.ready;
    return this.boss!;
  }

  // pg-boss v12 requires every queue to be explicitly declared
  // (createQueue) before send/work will touch it — unlike older versions,
  // it no longer auto-creates one on first send. create_queue is an
  // upsert under the hood, so calling it repeatedly is harmless; memoized
  // per-process just to skip the redundant round trip.
  private readonly knownQueues = new Set<string>();
  private async ensureQueue(boss: PgBoss, name: string): Promise<void> {
    if (this.knownQueues.has(name)) return;
    await boss.createQueue(name);
    this.knownQueues.add(name);
  }

  async send(name: string, data: object, options?: SendOptions) {
    const boss = await this.instance();
    await this.ensureQueue(boss, name);
    return boss.send(name, data, options ?? {});
  }

  /**
   * Cron-scheduled recurring job (e.g. the nightly debt-reminder sweep).
   * `schedule` re-declaring the same name/cron on every boot is a no-op
   * upsert in pg-boss, so this is safe to call unconditionally at startup
   * rather than needing a one-time migration step.
   */
  async schedule(
    name: string,
    cron: string,
    data: object,
    options?: ScheduleOptions,
  ): Promise<void> {
    const boss = await this.instance();
    await this.ensureQueue(boss, name);
    await boss.schedule(name, cron, data, options ?? {});
  }

  async work<ReqData>(
    name: string,
    options: WorkOptions,
    handler: (job: JobWithMetadata<ReqData>) => Promise<void>,
  ) {
    const boss = await this.instance();
    await this.ensureQueue(boss, name);
    // Every queue in this app processes one job per fetch (batchSize
    // defaults to 1), so a thrown error only ever fails the single job
    // that threw it — never a neighbour swept up in the same batch.
    return boss.work<ReqData>(
      name,
      { ...options, includeMetadata: true } as WorkOptions,
      async (jobs) => {
        for (const job of jobs as unknown as JobWithMetadata<ReqData>[]) {
          await handler(job);
        }
      },
    );
  }
}

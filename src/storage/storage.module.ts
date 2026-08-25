import { Global, Inject, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { AppConfigModule } from '../config/config.module';
import { StorageDriver } from './storage-driver.interface';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';

export const STORAGE = Symbol('STORAGE');

/**
 * Fails loudly on misconfiguration — a server that starts with
 * STORAGE_DRIVER=s3 and bad credentials would accept uploads and lose
 * them (kindergarten-docs/src/storage.ts). Logs rather than throws: a
 * transient MinIO outage at boot shouldn't crash-loop the whole API when
 * every other module is fine; GET /health surfaces STORAGE_UNAVAILABLE
 * for as long as it stays down.
 */
class StorageHealthCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('StorageHealthCheck');

  constructor(@Inject(STORAGE) private readonly storage: StorageDriver) {}

  async onApplicationBootstrap() {
    const healthy = await this.storage.healthCheck();
    if (!healthy) {
      this.logger.error(`Storage driver '${this.storage.name}' failed its health check at boot`);
    } else {
      this.logger.log(`Storage driver '${this.storage.name}' ready`);
    }
  }
}

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: STORAGE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): StorageDriver => {
        const driver = config.get('STORAGE_DRIVER');

        if (driver === 's3') {
          return new S3StorageDriver({
            endpoint: config.get('S3_ENDPOINT'),
            region: config.get('S3_REGION'),
            bucket: config.get('S3_BUCKET')!,
            accessKey: config.get('S3_ACCESS_KEY')!,
            secretKey: config.get('S3_SECRET_KEY')!,
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
          });
        }

        return new LocalStorageDriver(config.get('STORAGE_LOCAL_PATH'));
      },
    },
    StorageHealthCheck,
  ],
  exports: [STORAGE],
})
export class StorageModule {}

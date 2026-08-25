import { Readable } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { StorageDriver, assertSafeKey } from './storage-driver.interface';

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** resolve + verify the result is still inside root — the real guard. */
  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('INVALID_OBJECT_KEY');
    }
    return full;
  }

  async put(key: string, body: Buffer | Readable): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // write to a temp file then rename: a crash mid-write must not leave
    // a half-written file that looks valid to a later read
    const tmp = `${path}.${randomUUID()}.tmp`;
    if (Buffer.isBuffer(body)) {
      await pipeline(Readable.from(body), createWriteStream(tmp));
    } else {
      await pipeline(body, createWriteStream(tmp));
    }
    await rename(tmp, path);
  }

  async getStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await stat(path); // throws ENOENT -> mapped to NOT_FOUND by the caller
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e; // deleting a missing file is a no-op
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      const probe = join(this.root, '.healthcheck');
      await pipeline(Readable.from(Buffer.from('ok')), createWriteStream(probe));
      await unlink(probe);
      return true;
    } catch {
      return false;
    }
  }
}

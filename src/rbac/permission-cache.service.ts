import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { PermissionScope } from '../common/auth-context';

/**
 * Cache key is `${userId}:${permissionsVersion}`. Bumping the tenant's
 * permissionsVersion on any role/grant/assignment change makes every old
 * key unreachable — no Redis pub/sub, no stale-permission window
 * (01-stage1-plan.md §5.4).
 */
@Injectable()
export class PermissionCacheService {
  private readonly cache = new LRUCache<string, ReadonlyMap<string, PermissionScope>>({
    max: 5000,
    ttl: 60_000,
  });

  get(key: string): ReadonlyMap<string, PermissionScope> | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: ReadonlyMap<string, PermissionScope>): void {
    this.cache.set(key, value);
  }
}

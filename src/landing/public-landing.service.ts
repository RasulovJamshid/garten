import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PublicTenantPrisma } from '../prisma/public-tenant-prisma.provider';
import { TenantScopedClient } from '../prisma/tenant-extension';
import { AppConfigService } from '../config/app-config.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { STORAGE } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage-driver.interface';
import { LandingLocale, localizeContent } from './block-content';
import { LandingSnapshot } from './landing.service';

/**
 * The anonymous half of the landing module — the only unauthenticated read
 * path over tenant data in the app.
 *
 * Two rules it exists to keep:
 *
 * 1. The tenant seam still holds. `TenantPrisma` is unusable here (it
 *    reads `tid` off the verified JWT), so the tenant is resolved once,
 *    from a checkable `tenant.code`, through PublicTenantPrisma — which
 *    hands back the same `forTenant()`-wrapped client every authenticated
 *    request uses. No raw PrismaService, no hand-written tenant filters.
 *
 * 2. It serves the published snapshot only. Draft rows are never read
 *    here, so an unfinished edit cannot reach a visitor even by mistake.
 */
@Injectable()
export class PublicLandingService {
  constructor(
    private readonly publicPrisma: PublicTenantPrisma,
    private readonly config: AppConfigService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /**
   * The tenant code arrives from an anonymous URL, so it is treated as
   * untrusted input: it identifies a row to look up, never a value to
   * filter on directly. Only an `active` tenant resolves — a suspended
   * kindergarten's site goes dark with the rest of its account — and a
   * miss is the same 404 as an unpublished page, so this does not become
   * a probe for which tenant codes exist.
   */
  private async scope(code: string | undefined): Promise<TenantScopedClient> {
    const tenantCode = code ?? this.config.get('LANDING_DEFAULT_TENANT_CODE');
    if (!tenantCode) {
      throw AppErrors.notFound(
        'No tenant specified. Use /public/landing/{tenantCode}, or set LANDING_DEFAULT_TENANT_CODE.',
      );
    }
    const resolved = await this.publicPrisma.byCode(tenantCode);
    if (!resolved) throw AppErrors.notFound('Landing page not found');
    return resolved.db;
  }

  private async snapshot(db: TenantScopedClient, slug: string): Promise<LandingSnapshot> {
    const page = await db.landingPage.findFirst({
      where: { slug },
      select: { publishedSnapshot: true },
    });
    // A page that exists but was never published is a 404 to the public,
    // not an empty 200 — the marketing site should fall back to its own
    // static content rather than render a blank hero.
    if (!page?.publishedSnapshot) throw AppErrors.notFound('Landing page not published');
    return page.publishedSnapshot as unknown as LandingSnapshot;
  }

  /**
   * The whole public payload, flattened to one locale. Returns an ETag
   * alongside it: this response changes only on publish, so repeat
   * visitors and any CDN in front of the API should be getting 304s.
   */
  async getPage(tenantCode: string | undefined, locale: LandingLocale, slug = 'home') {
    const db = await this.scope(tenantCode);
    const snapshot = await this.snapshot(db, slug);
    const code = tenantCode ?? this.config.get('LANDING_DEFAULT_TENANT_CODE');

    const body = {
      slug: snapshot.slug,
      locale,
      version: snapshot.version,
      publishedAt: snapshot.publishedAt,
      seo: localizeContent(snapshot.seo, locale),
      blocks: snapshot.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        content: localizeContent(block.content, locale),
      })),
      /** Every file id inside `content` is fetched from here — the public
       *  site never needs to know /files/:id exists or that it needs a
       *  token. Carries the global API prefix so a client can append a
       *  file id and use it as-is against this API's origin. */
      mediaBaseUrl: `${this.config.get('API_PREFIX')}/public/landing/${code}/media`,
    };

    return { body, etag: this.etag(snapshot.version, locale, snapshot.publishedAt) };
  }

  private etag(version: number, locale: string, publishedAt: string): string {
    const hash = createHash('sha1').update(`${version}:${locale}:${publishedAt}`).digest('hex');
    return `W/"${hash}"`;
  }

  /**
   * Anonymous image reads, scoped by the published content itself rather
   * than by a flag on the file row: a file is public exactly while some
   * published block still references it. Republishing without an image
   * revokes it, with nothing to remember to clean up — and no other file
   * in the tenant is reachable here even if its id is guessed.
   */
  async getMedia(tenantCode: string | undefined, slug: string, fileId: string) {
    const db = await this.scope(tenantCode);
    const snapshot = await this.snapshot(db, slug);
    if (!snapshot.fileIds.includes(fileId)) {
      throw AppErrors.notFound('File is not part of the published landing page');
    }

    const file = await db.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!file) throw AppErrors.notFound('File not found');
    // Belt and braces against a stale snapshot pointing at a file that has
    // since been replaced by something else: this route serves images only.
    if (!file.mimeType.startsWith('image/')) throw AppErrors.notFound('File not found');

    const stream = await this.storage.getStream(file.objectKey);
    return { file, stream };
  }
}

import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PublicLandingService } from './public-landing.service';
import { LandingLocale } from './block-content';
import { PublicLandingQueryDto } from './dto/landing.dto';

/**
 * The only anonymous read path over tenant data in the API.
 *
 * Everything here is deliberately narrow: published content only, images
 * only, one tenant resolved from a checked `tenant.code`, and its own
 * rate limit. `@Public()` is what makes it anonymous — both global guards
 * check that flag first (jwt-auth.guard.ts, permission.guard.ts).
 *
 * CORS note: the marketing site is a different origin from the admin UI,
 * so its origin must be added to CORS_ORIGINS or every browser call fails
 * preflight. The allow-list is not loosened for this route — these
 * responses carry no cookies and nothing user-specific, but the app-wide
 * `credentials: true` means a reflected origin would still be the hole
 * env.schema.ts warns about.
 */
@ApiTags('public')
@Controller('public/landing')
export class PublicLandingController {
  constructor(private readonly landing: PublicLandingService) {}

  @ApiOperation({
    summary: 'Get the published landing page for the default tenant (public, no auth)',
    description:
      'Same payload as GET /public/landing/{tenantCode}, for single-kindergarten deployments ' +
      'where the marketing site should not have to know a tenant code. 404 unless ' +
      'LANDING_DEFAULT_TENANT_CODE is set. Declared before the :tenantCode route so the ' +
      'bare path is not read as a code.',
  })
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  async defaultPage(
    @Query() query: PublicLandingQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.respondWithPage(undefined, query, req, res);
  }

  @ApiOperation({
    summary: 'Get the published landing page (public, no auth)',
    description:
      'The live marketing content for one kindergarten, flattened to a single language. ' +
      'Serves the published snapshot only — drafts are never visible here. 404 until the ' +
      'page has been published at least once. Responds with an ETag; send If-None-Match to ' +
      'get a 304, since this changes only when someone publishes.',
  })
  @Public()
  // Far below the 300/min default: this is an anonymous, IP-keyed,
  // fully cacheable endpoint (AppThrottlerGuard falls back to req.ip when
  // there is no user), so a legitimate visitor needs a couple of calls and
  // anything more is a scrape.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':tenantCode')
  async page(
    @Param('tenantCode') tenantCode: string,
    @Query() query: PublicLandingQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.respondWithPage(tenantCode, query, req, res);
  }

  private async respondWithPage(
    tenantCode: string | undefined,
    query: PublicLandingQueryDto,
    req: Request,
    res: Response,
  ) {
    const locale = (query.lang ?? 'ru') as LandingLocale;
    const { body, etag } = await this.landing.getPage(tenantCode, locale);

    res.setHeader('ETag', etag);
    res.setHeader('Content-Language', locale);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json(body);
  }

  @ApiOperation({
    summary: 'Get an image used by the published landing page (public, no auth)',
    description:
      'Serves a file only while some published block still references it — access is derived ' +
      'from the live content, not from a flag, so republishing without an image revokes it. ' +
      'Images only; every other file in the tenant stays behind GET /files/:id and file:read.',
  })
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Header('X-Content-Type-Options', 'nosniff')
  @Get(':tenantCode/media/:fileId')
  async media(
    @Param('tenantCode') tenantCode: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.landing.getMedia(tenantCode, 'home', fileId);

    res.setHeader('Content-Type', file.mimeType);
    // `inline`, unlike GET /files/:id — this one is meant to render in an
    // <img>, not to download.
    res.setHeader('Content-Disposition', 'inline');
    // Object keys are immutable, so a given file id always has the same
    // bytes: safe to cache hard. Revocation happens at the snapshot check
    // above, which a cached image legitimately outlives.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    stream.pipe(res);
  }
}

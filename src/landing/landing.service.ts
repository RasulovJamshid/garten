import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { collectFileIds, parseBlockContent } from './block-content';
import {
  CreateBlockDto,
  PublishDto,
  ReorderBlocksDto,
  UpdateBlockDto,
  UpdateSeoDto,
} from './dto/landing.dto';

/** The only page slug the admin UI exposes today; the column exists so
 *  "About us", "Admissions" etc. can be added without another table. */
const HOME_SLUG = 'home';

/**
 * What `landing_page.published_snapshot` holds. Frozen at publish time and
 * read verbatim by the anonymous endpoint — one row, no joins, and an
 * in-progress draft edit can never reach a visitor.
 */
export interface LandingSnapshot {
  slug: string;
  version: number;
  seo: Record<string, unknown> | null;
  blocks: { id: string; type: string; position: number; content: unknown }[];
  /** Flattened from every block + the SEO image: the allow-list the public
   *  media route serves from, so it never has to walk the blocks itself. */
  fileIds: string[];
  publishedAt: string;
}

@Injectable()
export class LandingService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every landing endpoint funnels through here, so a tenant that has
   * never opened the editor still gets a working (empty) page rather than
   * a 404 the admin UI would have to special-case.
   */
  private async page(slug = HOME_SLUG) {
    const existing = await this.tenantPrisma.db.landingPage.findFirst({ where: { slug } });
    if (existing) return existing;
    return this.tenantPrisma.db.landingPage.create({
      data: { tenantId: this.tenantPrisma.tenantId, slug },
    });
  }

  async getDraft(slug = HOME_SLUG) {
    const page = await this.page(slug);
    const blocks = await this.tenantPrisma.db.landingBlock.findMany({
      where: { pageId: page.id },
      orderBy: { position: 'asc' },
    });
    const published = page.publishedSnapshot as LandingSnapshot | null;

    return {
      id: page.id,
      slug: page.slug,
      seo: page.seo,
      blocks,
      version: page.version,
      publishedAt: page.publishedAt,
      publishedVersion: published?.version ?? null,
      /** Cheap "you have unsaved changes" signal for the editor's Publish
       *  button — a draft edit always bumps updatedAt past publishedAt. */
      hasUnpublishedChanges: this.isDirty(page, blocks),
    };
  }

  private isDirty(
    page: { publishedAt: Date | null; updatedAt: Date },
    blocks: { updatedAt: Date }[],
  ): boolean {
    if (!page.publishedAt) return true;
    const lastEdit = blocks.reduce(
      (latest, b) => (b.updatedAt > latest ? b.updatedAt : latest),
      page.updatedAt,
    );
    return lastEdit > page.publishedAt;
  }

  async createBlock(ctx: AuthContext, dto: CreateBlockDto) {
    const page = await this.page();
    const content = parseBlockContent(dto.type, dto.content);
    await this.assertFilesExist(collectFileIds(content));

    const position = dto.position ?? (await this.nextPosition(page.id));

    const block = await this.tenantPrisma.db.landingBlock.create({
      data: {
        tenantId: ctx.tenantId,
        pageId: page.id,
        type: dto.type,
        position,
        isVisible: dto.isVisible ?? true,
        content: content as Prisma.InputJsonValue,
        fileIds: collectFileIds(content),
        updatedBy: ctx.userId,
      },
    });
    await this.touch(page.id, ctx.userId);

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.block.create',
      entityType: 'landing_block',
      entityId: block.id,
      newValue: { type: block.type, position: block.position },
    });

    return block;
  }

  private async nextPosition(pageId: string): Promise<number> {
    const last = await this.tenantPrisma.db.landingBlock.findFirst({
      where: { pageId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last ? last.position + 1 : 0;
  }

  async updateBlock(ctx: AuthContext, id: string, dto: UpdateBlockDto) {
    const before = await this.findBlockOrThrow(id);

    const data: Prisma.LandingBlockUpdateInput = { updatedBy: ctx.userId };
    if (dto.content !== undefined) {
      // Validated against the block's OWN type — `type` is immutable after
      // creation, because changing it would leave content of the old shape
      // sitting under a schema that never validated it.
      const content = parseBlockContent(before.type, dto.content);
      await this.assertFilesExist(collectFileIds(content));
      data.content = content as Prisma.InputJsonValue;
      data.fileIds = collectFileIds(content);
    }
    if (dto.isVisible !== undefined) data.isVisible = dto.isVisible;

    const updated = await this.tenantPrisma.db.landingBlock.update({ where: { id }, data });
    await this.touch(before.pageId, ctx.userId);

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.block.update',
      entityType: 'landing_block',
      entityId: id,
      oldValue: { isVisible: before.isVisible, content: before.content as object },
      newValue: { isVisible: updated.isVisible, content: updated.content as object },
    });

    return updated;
  }

  async deleteBlock(ctx: AuthContext, id: string) {
    const block = await this.findBlockOrThrow(id);
    // Hard delete: a removed draft section has no reporting value, and the
    // published snapshot still holds a copy until the next publish, so the
    // live site is unaffected until someone deliberately republishes.
    await this.tenantPrisma.db.landingBlock.delete({ where: { id } });
    await this.touch(block.pageId, ctx.userId);

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.block.delete',
      entityType: 'landing_block',
      entityId: id,
      oldValue: { type: block.type, content: block.content as object },
    });
  }

  async reorder(ctx: AuthContext, dto: ReorderBlocksDto) {
    const page = await this.page();
    const owned = await this.tenantPrisma.db.landingBlock.findMany({
      where: { pageId: page.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((b) => b.id));
    for (const item of dto.blocks) {
      if (!ownedIds.has(item.id)) throw AppErrors.notFound(`Block ${item.id} is not on this page`);
    }

    await this.tenantPrisma.db.$transaction(
      dto.blocks.map((item) =>
        this.tenantPrisma.db.landingBlock.update({
          where: { id: item.id },
          data: { position: item.position, updatedBy: ctx.userId },
        }),
      ),
    );
    await this.touch(page.id, ctx.userId);

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.reorder',
      entityType: 'landing_page',
      entityId: page.id,
      newValue: { order: dto.blocks },
    });

    return this.tenantPrisma.db.landingBlock.findMany({
      where: { pageId: page.id },
      orderBy: { position: 'asc' },
    });
  }

  async updateSeo(ctx: AuthContext, dto: UpdateSeoDto) {
    const page = await this.page();
    if (dto.ogImageFileId) await this.assertFilesExist([dto.ogImageFileId]);

    const updated = await this.tenantPrisma.db.landingPage.update({
      where: { id: page.id },
      data: { seo: dto as unknown as Prisma.InputJsonValue, updatedBy: ctx.userId },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.seo.update',
      entityType: 'landing_page',
      entityId: page.id,
      oldValue: (page.seo as Record<string, unknown>) ?? undefined,
      newValue: dto as unknown as Record<string, unknown>,
    });

    return updated;
  }

  /**
   * Freezes the current draft into `published_snapshot` and appends a
   * version row. Separate permission from editing (`landing:publish`) —
   * drafting is editorial, pushing to the public internet is not.
   */
  async publish(ctx: AuthContext, dto: PublishDto) {
    const page = await this.page();
    const blocks = await this.tenantPrisma.db.landingBlock.findMany({
      where: { pageId: page.id, isVisible: true },
      orderBy: { position: 'asc' },
    });

    const seo = (page.seo as Record<string, unknown> | null) ?? null;
    const version = page.version + 1;
    const publishedAt = new Date();

    const snapshot: LandingSnapshot = {
      slug: page.slug,
      version,
      seo,
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        position: b.position,
        content: b.content,
      })),
      fileIds: [...new Set([...blocks.flatMap((b) => b.fileIds), ...collectFileIds(seo)])],
      publishedAt: publishedAt.toISOString(),
    };

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.landingPage.update({
        where: { id: page.id },
        data: {
          publishedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          publishedAt,
          publishedBy: ctx.userId,
          version,
        },
      });
      await tx.landingPageVersion.create({
        data: {
          tenantId: ctx.tenantId,
          pageId: page.id,
          version,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          note: dto.note,
          publishedAt,
          publishedBy: ctx.userId,
        },
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.publish',
      entityType: 'landing_page',
      entityId: page.id,
      newValue: { version, blocks: blocks.length, note: dto.note },
    });

    return { version, publishedAt, blocks: blocks.length };
  }

  async listVersions() {
    const page = await this.page();
    return this.tenantPrisma.db.landingPageVersion.findMany({
      where: { pageId: page.id },
      // The snapshot itself can be large; the history list only needs
      // headers. Fetch one via GET /landing/versions/:version.
      select: { id: true, version: true, note: true, publishedAt: true, publishedBy: true },
      orderBy: { version: 'desc' },
    });
  }

  async getVersion(version: number) {
    const page = await this.page();
    const row = await this.tenantPrisma.db.landingPageVersion.findFirst({
      where: { pageId: page.id, version },
    });
    if (!row) throw AppErrors.notFound(`Version ${version} not found`);
    return row;
  }

  /**
   * Replays an old snapshot back over the draft blocks and republishes it
   * as a NEW version — history stays append-only, so a restore is itself
   * undoable rather than rewriting what was live before.
   */
  async restore(ctx: AuthContext, version: number) {
    const page = await this.page();
    const target = await this.getVersion(version);
    const snapshot = target.snapshot as unknown as LandingSnapshot;
    const nextVersion = page.version + 1;
    const publishedAt = new Date();

    const restored: LandingSnapshot = {
      ...snapshot,
      version: nextVersion,
      publishedAt: publishedAt.toISOString(),
    };

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.landingBlock.deleteMany({ where: { pageId: page.id } });
      for (const block of snapshot.blocks) {
        await tx.landingBlock.create({
          data: {
            tenantId: ctx.tenantId,
            pageId: page.id,
            type: block.type,
            position: block.position,
            isVisible: true,
            content: block.content as Prisma.InputJsonValue,
            fileIds: collectFileIds(block.content),
            updatedBy: ctx.userId,
          },
        });
      }
      await tx.landingPage.update({
        where: { id: page.id },
        data: {
          seo: (snapshot.seo ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          publishedSnapshot: restored as unknown as Prisma.InputJsonValue,
          publishedAt,
          publishedBy: ctx.userId,
          version: nextVersion,
          updatedBy: ctx.userId,
        },
      });
      await tx.landingPageVersion.create({
        data: {
          tenantId: ctx.tenantId,
          pageId: page.id,
          version: nextVersion,
          snapshot: restored as unknown as Prisma.InputJsonValue,
          note: `Restored from version ${version}`,
          publishedAt,
          publishedBy: ctx.userId,
        },
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'landing.restore',
      entityType: 'landing_page',
      entityId: page.id,
      newValue: { restoredFrom: version, version: nextVersion },
    });

    return { version: nextVersion, restoredFrom: version, publishedAt };
  }

  private async findBlockOrThrow(id: string) {
    const block = await this.tenantPrisma.db.landingBlock.findFirst({ where: { id } });
    if (!block) throw AppErrors.notFound('Landing block not found');
    return block;
  }

  /**
   * Referenced files must exist, belong to this tenant, and be images —
   * checked at write time rather than at render time, because a dangling
   * id only shows up as a hole on the live public site.
   */
  private async assertFilesExist(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.tenantPrisma.db.file.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, mimeType: true },
    });
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const id of ids) {
      const file = byId.get(id);
      if (!file) throw AppErrors.validationFailed(`File ${id} does not exist`);
      if (!file.mimeType.startsWith('image/')) {
        throw AppErrors.validationFailed(
          `File ${id} is ${file.mimeType}; landing blocks may only reference images`,
        );
      }
    }
  }

  /** Keeps `updatedAt`/`updatedBy` on the page true whenever any block on
   *  it changes — that timestamp is what `hasUnpublishedChanges` compares. */
  private touch(pageId: string, userId: string) {
    return this.tenantPrisma.db.landingPage.update({
      where: { id: pageId },
      data: { updatedBy: userId, updatedAt: new Date() },
    });
  }
}

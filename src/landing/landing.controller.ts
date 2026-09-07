import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LandingService } from './landing.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { BLOCK_SCHEMAS, LANDING_BLOCK_TYPES, LANDING_LOCALES } from './block-content';
import {
  CreateBlockDto,
  PublishDto,
  ReorderBlocksDto,
  UpdateBlockDto,
  UpdateSeoDto,
} from './dto/landing.dto';

/**
 * Editing side of the public landing page. Everything here reads and
 * writes the DRAFT; nothing a visitor sees changes until POST /landing/
 * publish — which is a separate permission on purpose.
 */
@ApiTags('landing')
@Controller('landing')
export class LandingController {
  constructor(private readonly landing: LandingService) {}

  @ApiOperation({
    summary: 'Get the landing page draft',
    description:
      'Blocks in display order with every locale intact, plus SEO, the published version and ' +
      'whether the draft has changes not yet published. Doubles as the editor preview — this is ' +
      'the authenticated view of exactly what publishing would make live.',
  })
  @Get()
  @RequirePermissions('landing:manage')
  get() {
    return this.landing.getDraft();
  }

  @ApiOperation({
    summary: 'List the available block types and their content schemas',
    description:
      'The section catalog, straight from code (src/landing/block-content.ts). The admin UI ' +
      'renders its per-block form from this rather than hardcoding field lists, so a section ' +
      'type added on the server shows up in the editor without a frontend release.',
  })
  @Get('block-types')
  @RequirePermissions('landing:manage')
  blockTypes() {
    return {
      locales: LANDING_LOCALES,
      types: LANDING_BLOCK_TYPES.map((type) => ({
        type,
        // A machine-readable shape per type; zod-to-json-schema is not a
        // dependency, so this is the field list the form builder needs.
        fields: Object.keys(BLOCK_SCHEMAS[type].shape),
      })),
    };
  }

  @ApiOperation({ summary: 'Add a block to the landing page' })
  @Post('blocks')
  @RequirePermissions('landing:manage')
  createBlock(@Auth() ctx: AuthContext, @Body() dto: CreateBlockDto) {
    return this.landing.createBlock(ctx, dto);
  }

  // Declared ahead of 'blocks/:id': Nest matches routes in declaration
  // order, so the literal segment has to win before ':id' swallows
  // "reorder" as a block id.
  @ApiOperation({
    summary: 'Reorder blocks',
    description: 'Send every block with its new position — applied in one transaction.',
  })
  @Put('blocks/reorder')
  @RequirePermissions('landing:manage')
  reorder(@Auth() ctx: AuthContext, @Body() dto: ReorderBlocksDto) {
    return this.landing.reorder(ctx, dto);
  }

  @ApiOperation({
    summary: 'Update a block',
    description:
      "Content is validated against the block's existing type; `type` itself is immutable.",
  })
  @Put('blocks/:id')
  @RequirePermissions('landing:manage')
  updateBlock(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateBlockDto) {
    return this.landing.updateBlock(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Delete a block',
    description:
      'Removes it from the draft only — the live page keeps the block until the next publish.',
  })
  @Delete('blocks/:id')
  @RequirePermissions('landing:manage')
  deleteBlock(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.landing.deleteBlock(ctx, id);
  }

  @ApiOperation({ summary: 'Update page SEO / social preview metadata' })
  @Put('seo')
  @RequirePermissions('landing:manage')
  updateSeo(@Auth() ctx: AuthContext, @Body() dto: UpdateSeoDto) {
    return this.landing.updateSeo(ctx, dto);
  }

  @ApiOperation({
    summary: 'Publish the draft',
    description:
      'Freezes the visible blocks into the snapshot the public endpoint serves and appends a ' +
      'version. Requires landing:publish — a content editor with only landing:manage can ' +
      'prepare changes but not push them live.',
  })
  @Post('publish')
  @RequirePermissions('landing:publish')
  publish(@Auth() ctx: AuthContext, @Body() dto: PublishDto) {
    return this.landing.publish(ctx, dto);
  }

  @ApiOperation({ summary: 'List published versions' })
  @Get('versions')
  @RequirePermissions('landing:manage')
  versions() {
    return this.landing.listVersions();
  }

  @ApiOperation({ summary: 'Get one published version, including its full snapshot' })
  @Get('versions/:version')
  @RequirePermissions('landing:manage')
  version(@Param('version', ParseIntPipe) version: number) {
    return this.landing.getVersion(version);
  }

  @ApiOperation({
    summary: 'Restore a previous version',
    description:
      'Replays that snapshot over the draft and publishes it as a new version — history stays ' +
      'append-only, so the restore is itself undoable.',
  })
  @Post('versions/:version/restore')
  @RequirePermissions('landing:publish')
  restore(@Auth() ctx: AuthContext, @Param('version', ParseIntPipe) version: number) {
    return this.landing.restore(ctx, version);
  }
}

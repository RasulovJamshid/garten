import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChildrenService } from './children.service';
import { MedicalService } from './medical.service';
import { DocumentsService } from './documents.service';
import { ConsentsService } from './consents.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { ChildStatusDto } from './dto/child-status.dto';
import { CreateChildDocumentDto, UpdateChildDocumentDto } from './dto/child-document.dto';
import { UpdateMedicalDto } from './dto/update-medical.dto';
import { RecordConsentDto } from './dto/consent.dto';

@ApiTags('children')
@Controller('children')
export class ChildrenController {
  constructor(
    private readonly children: ChildrenService,
    private readonly medical: MedicalService,
    private readonly documents: DocumentsService,
    private readonly consents: ConsentsService,
  ) {}

  @ApiOperation({
    summary: 'List children',
    description:
      'Paginated, filterable by status, groupId, and free-text search (q). Requires child:read; ' +
      "results are scoped to the caller's branch/group depending on their granted scope.",
  })
  @Get()
  @RequirePermissions('child:read')
  list(
    @Auth() ctx: AuthContext,
    @Query('status') status?: string,
    @Query('groupId') groupId?: string,
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.children.list(ctx, {
      status,
      groupId,
      q,
      page: Number(page) || 1,
      limit: Number(limit) || 50,
    });
  }

  @ApiOperation({
    summary: 'Create a child',
    description: 'Registers a new child record. Requires child:create.',
  })
  @Post()
  @RequirePermissions('child:create')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateChildDto) {
    return this.children.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Get a child by ID',
    description: 'Returns full profile detail for a single child. Requires child:read.',
  })
  @Get(':id')
  @RequirePermissions('child:read')
  get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.children.findOneOrThrow(ctx, id);
  }

  @ApiOperation({
    summary: 'Update a child',
    description: "Updates a child's profile fields. Requires child:update.",
  })
  @Patch(':id')
  @RequirePermissions('child:update')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateChildDto) {
    return this.children.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: "Change a child's status",
    description:
      'Transitions a child between statuses (e.g. active, graduated, withdrawn) and records the ' +
      'transition in the status history. Setting status to withdrawn or graduated stamps the ' +
      'withdrawal date from dto.effectiveDate. Requires child:status.',
  })
  @Post(':id/status')
  @RequirePermissions('child:status')
  setStatus(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ChildStatusDto) {
    return this.children.setStatus(ctx, id, dto);
  }

  @ApiOperation({
    summary: "Get a child's status history",
    description: 'Returns the full status-change history for a child. Requires child:read.',
  })
  @Get(':id/history')
  @RequirePermissions('child:read')
  history(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.children.history(ctx, id);
  }

  @ApiOperation({
    summary: 'Delete a child',
    description:
      'Permanently removes a child record. Requires child:delete, a sensitive permission — ' +
      'see the RBAC §5.5 safety rails (privilege-escalation and sensitive-permission gating).',
  })
  @Delete(':id')
  @RequirePermissions('child:delete')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.children.remove(ctx, id);
  }

  // --- documents ---------------------------------------------------------

  @ApiOperation({
    summary: "List a child's documents",
    description: 'Returns metadata for every document on file for this child. Requires child:read.',
  })
  @Get(':id/documents')
  @RequirePermissions('child:read')
  listDocuments(@Param('id') id: string) {
    return this.documents.list(id);
  }

  @ApiOperation({
    summary: "Add a document to a child's file",
    description:
      'Attaches a document record (e.g. a scanned ID or medical form) to a child. Requires ' +
      'child:update. The document itself is uploaded separately via the files module.',
  })
  @Post(':id/documents')
  @RequirePermissions('child:update')
  createDocument(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateChildDocumentDto,
  ) {
    return this.documents.create(ctx, id, dto);
  }

  @ApiOperation({
    summary: "Update a child's document metadata",
    description: 'Edits an existing document record for this child. Requires child:update.',
  })
  @Patch(':id/documents/:docId')
  @RequirePermissions('child:update')
  updateDocument(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: UpdateChildDocumentDto,
  ) {
    return this.documents.update(ctx, id, docId, dto);
  }

  @ApiOperation({
    summary: "Verify a child's document",
    description:
      'Marks a document as staff-verified (e.g. an ID checked against the original). Requires ' +
      'child:update.',
  })
  @Post(':id/documents/:docId/verify')
  @RequirePermissions('child:update')
  verifyDocument(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('docId') docId: string) {
    return this.documents.verify(ctx, id, docId);
  }

  // --- medical -------------------------------------------------------

  @ApiOperation({
    summary: "Get a child's medical record",
    description: 'Requires medical:read — a separate permission from general child:read.',
  })
  @Get(':id/medical')
  @RequirePermissions('medical:read')
  getMedical(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.medical.get(ctx, id);
  }

  @ApiOperation({
    summary: "Replace a child's medical record",
    description:
      'Full replace (PUT, not PATCH) of medical data — allergies, conditions, medications, etc. ' +
      'Requires medical:write.',
  })
  @Put(':id/medical')
  @RequirePermissions('medical:write')
  updateMedical(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateMedicalDto) {
    return this.medical.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: "Get a child's medical alerts",
    description:
      'Returns the short list of critical medical flags (e.g. severe allergies) meant for staff ' +
      'to see at a glance, separate from the full medical record. Requires medical:alerts.',
  })
  @Get(':id/medical/alerts')
  @RequirePermissions('medical:alerts')
  medicalAlerts(@Param('id') id: string) {
    return this.medical.alerts(id);
  }

  // --- consent ---------------------------------------------------------

  @ApiOperation({
    summary: "List a child's consents",
    description:
      'Returns recorded parental consents (e.g. photo/media release, field trips) for this child. ' +
      'Requires consent:read.',
  })
  @Get(':id/consents')
  @RequirePermissions('consent:read')
  listConsents(@Param('id') id: string) {
    return this.consents.list(id);
  }

  @ApiOperation({
    summary: 'Record a consent',
    description: 'Records a new parental consent for this child. Requires consent:manage.',
  })
  @Post(':id/consents')
  @RequirePermissions('consent:manage')
  recordConsent(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: RecordConsentDto) {
    return this.consents.record(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Revoke a consent',
    description: 'Revokes a previously recorded consent. Requires consent:manage.',
  })
  @Post(':id/consents/:consentId/revoke')
  @RequirePermissions('consent:manage')
  revokeConsent(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Param('consentId') consentId: string,
  ) {
    return this.consents.revoke(ctx, id, consentId);
  }
}

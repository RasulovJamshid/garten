import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Post()
  @RequirePermissions('child:create')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateChildDto) {
    return this.children.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermissions('child:read')
  get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.children.findOneOrThrow(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('child:update')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateChildDto) {
    return this.children.update(ctx, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('child:status')
  setStatus(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ChildStatusDto) {
    return this.children.setStatus(ctx, id, dto);
  }

  @Get(':id/history')
  @RequirePermissions('child:read')
  history(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.children.history(ctx, id);
  }

  @Delete(':id')
  @RequirePermissions('child:delete')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.children.remove(ctx, id);
  }

  // --- documents ---------------------------------------------------------

  @Get(':id/documents')
  @RequirePermissions('child:read')
  listDocuments(@Param('id') id: string) {
    return this.documents.list(id);
  }

  @Post(':id/documents')
  @RequirePermissions('child:update')
  createDocument(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateChildDocumentDto,
  ) {
    return this.documents.create(ctx, id, dto);
  }

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

  @Post(':id/documents/:docId/verify')
  @RequirePermissions('child:update')
  verifyDocument(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('docId') docId: string) {
    return this.documents.verify(ctx, id, docId);
  }

  // --- medical -------------------------------------------------------

  @Get(':id/medical')
  @RequirePermissions('medical:read')
  getMedical(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.medical.get(ctx, id);
  }

  @Put(':id/medical')
  @RequirePermissions('medical:write')
  updateMedical(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateMedicalDto) {
    return this.medical.update(ctx, id, dto);
  }

  @Get(':id/medical/alerts')
  @RequirePermissions('medical:alerts')
  medicalAlerts(@Param('id') id: string) {
    return this.medical.alerts(id);
  }

  // --- consent ---------------------------------------------------------

  @Get(':id/consents')
  @RequirePermissions('consent:read')
  listConsents(@Param('id') id: string) {
    return this.consents.list(id);
  }

  @Post(':id/consents')
  @RequirePermissions('consent:manage')
  recordConsent(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: RecordConsentDto) {
    return this.consents.record(ctx, id, dto);
  }

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

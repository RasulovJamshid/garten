import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ImportsService } from './imports.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CommitImportDto } from './dto/commit-import.dto';

@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @ApiOperation({
    summary: 'Download an import template',
    description:
      'Returns a blank .xlsx template for the given entity (e.g. "children") to fill in and re-upload.',
  })
  @Get('templates/:entity')
  @RequirePermissions('import:manage')
  async template(@Param('entity') entity: string, @Res() res: Response) {
    const buffer = await this.imports.template(entity);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-template.xlsx"`);
    res.send(buffer);
  }

  @ApiOperation({
    summary: 'Validate an import file',
    description:
      'Uploads a spreadsheet (multipart, field "file") for the given ?entity= and validates it ' +
      'row by row without writing anything — creates an import job whose ID is passed to ' +
      'POST /commit to actually apply it.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Post('validate')
  @RequirePermissions('import:manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async validate(
    @Auth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File,
    @Query('entity') entity?: string,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'No file uploaded (field: file)',
      });
    }
    if (!entity) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Query param "entity" is required',
      });
    }
    return this.imports.validate(ctx, entity, {
      buffer: file.buffer,
      originalname: file.originalname,
      size: file.size,
    });
  }

  @ApiOperation({
    summary: 'Commit a validated import',
    description:
      'Applies a previously validated import job (dto.importJobId). Set dto.skipInvalid to true ' +
      'to import only the rows that passed validation rather than rejecting the whole file.',
  })
  @Post('commit')
  @RequirePermissions('import:manage')
  commit(@Auth() ctx: AuthContext, @Body() dto: CommitImportDto) {
    return this.imports.commit(ctx, dto.importJobId, dto.skipInvalid ?? false);
  }

  @ApiOperation({
    summary: 'Get an import job by ID',
  })
  @Get(':id')
  @RequirePermissions('import:manage')
  get(@Param('id') id: string) {
    return this.imports.get(id);
  }
}

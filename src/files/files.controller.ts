import {
  BadRequestException,
  Controller,
  Delete,
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
import { FilesService } from './files.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @ApiOperation({
    summary: 'Upload a file',
    description:
      'Multipart upload, field name "file". Optionally tagged to an entity via entityType/' +
      'entityId query params. Stored via the local or S3/MinIO driver depending on ' +
      'STORAGE_DRIVER — callers never see which. Requires file:manage.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Post()
  @RequirePermissions('file:manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(
    @Auth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    if (!file)
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'No file uploaded (field name: file)',
      });
    return this.files.upload(ctx, file, entityType, entityId);
  }

  @ApiOperation({
    summary: 'Download a file',
    description:
      "Streams the file's bytes directly — files are never exposed via a presigned URL, so " +
      'access control is enforced on every download, not just at upload time. Requires file:read.',
  })
  @Get(':id')
  @RequirePermissions('file:read')
  async download(@Auth() ctx: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const { file, stream } = await this.files.download(ctx, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }

  @ApiOperation({
    summary: 'Delete a file',
  })
  @Delete(':id')
  @RequirePermissions('file:manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.files.remove(ctx, id);
  }
}

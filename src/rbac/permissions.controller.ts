import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION_CATALOG } from './permission-catalog';

/**
 * Read-only view of the code catalog. Permissions cannot be created via
 * API — a grant with no enforcing endpoint is a silent security hole
 * (api-spec §3).
 */
@ApiTags('permissions')
@Controller('permissions')
export class PermissionsController {
  @ApiOperation({
    summary: 'List all permissions',
    description:
      'Read-only view of the code-owned permission catalog — every permission key that exists, ' +
      "the scopes it supports, and whether it's marked sensitive. Permissions themselves cannot " +
      'be created via the API (see class comment); this is what role-editing UIs list from.',
  })
  @Get()
  list(@Query('group') group?: string, @Query('includeDeprecated') includeDeprecated?: string) {
    const items = PERMISSION_CATALOG.filter((p) => !group || p.group === group);
    return {
      data: items.map((p) => ({
        key: p.key,
        group: p.group,
        descriptionUz: p.descriptionUz,
        descriptionRu: p.descriptionRu,
        allowedScopes: p.scopes,
        sensitive: p.sensitive ?? false,
        deprecated: false,
      })),
      includeDeprecated: includeDeprecated === 'true',
    };
  }

  @ApiOperation({
    summary: 'List permission groups',
    description: 'The distinct group names permissions are organized under (e.g. "children").',
  })
  @Get('groups')
  groups() {
    const groups = [...new Set(PERMISSION_CATALOG.map((p) => p.group))];
    return { data: groups };
  }
}

import { ApiProperty } from '@nestjs/swagger';

/**
 * The `meta` half of every list envelope
 * (frontend-integration-guide.md §7). Tables drive off `total`/`pages`
 * rather than counting `data.length`.
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: '1-based' })
  page!: number;

  @ApiProperty({ example: 50, description: 'Capped at 200' })
  limit!: number;

  @ApiProperty({ example: 342 })
  total!: number;

  @ApiProperty({ example: 7 })
  pages!: number;
}

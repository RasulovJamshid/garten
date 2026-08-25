import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsDefined, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateDiscountDto {
  @ApiProperty({ enum: ['percent', 'fixed'] })
  @IsIn(['percent', 'fixed'])
  kind!: 'percent' | 'fixed';

  @ApiProperty({
    description:
      'For kind=fixed: integer tiyin as a string. For kind=percent: basis points (1000 = 10%).',
  })
  // Union type (string | number) can't take a single type-specific
  // class-validator decorator; @IsDefined marks it "known" to the global
  // ValidationPipe's whitelist so it isn't stripped/rejected. The actual
  // shape check happens in parseDiscountValue(), keyed off `kind`.
  @IsDefined()
  value!: string | number;

  @ApiProperty()
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiProperty()
  @IsString()
  reason!: string;
}

export function parseDiscountValue(dto: CreateDiscountDto): {
  valueTiyin?: bigint;
  valueBp?: number;
} {
  if (dto.kind === 'fixed') {
    if (typeof dto.value !== 'string' || !/^\d+$/.test(dto.value)) {
      throw new Error('value must be a non-negative integer tiyin string for kind=fixed');
    }
    return { valueTiyin: BigInt(dto.value) };
  }
  const bp = Number(dto.value);
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
    throw new Error('value must be an integer basis-points value 0-10000 for kind=percent');
  }
  return { valueBp: bp };
}

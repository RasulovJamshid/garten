import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from './validation-pipe';
import { CreateChildDto } from '../children/dto/create-child.dto';
import { UpdateMedicalDto } from '../children/dto/update-medical.dto';

const pipe = createValidationPipe();
const child = {
  branchId: '97f01f74-ad44-4d73-91a8-6a7874e409c8',
  firstName: 'Flow',
  lastName: 'Audit',
};

describe('request validation contract', () => {
  it.each(['2026-02-31', '2025-02-29', '2026-13-01'])(
    'rejects impossible birth date %s at the HTTP boundary',
    async (birthDate) => {
      try {
        await pipe.transform({ ...child, birthDate }, { type: 'body', metatype: CreateChildDto });
        throw new Error('Expected validation rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'VALIDATION_FAILED',
          details: { birthDate: expect.any(Array) },
        });
      }
    },
  );
  it('accepts real leap days', async () => {
    const result = await pipe.transform(
      { ...child, birthDate: '2024-02-29' },
      { type: 'body', metatype: CreateChildDto },
    );
    expect(result.birthDate).toBe('2024-02-29');
  });
  it('preserves nested array field paths without returning submitted values', async () => {
    try {
      await pipe.transform(
        { medications: [{ name: 'Test', validFrom: '2026-02-31' }] },
        { type: 'body', metatype: UpdateMedicalDto },
      );
      throw new Error('Expected validation rejection');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        details: { 'medications.0.validFrom': expect.any(Array) },
      });
      expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(
        '2026-02-31',
      );
    }
  });
});

import { z } from 'zod';
import { billingRulesSchema } from '../billing/validate-billing-rules';

/** Share the rules editor's schema with runtime validation. */
function convert(schema: z.ZodTypeAny): any {
  const def = schema._def;
  switch (def.typeName) {
    case 'ZodEffects':
      return convert(def.schema);
    case 'ZodObject': {
      const shape = def.shape();
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(shape).map(([key, value]) => [key, convert(value as z.ZodTypeAny)]),
        ),
        required: Object.keys(shape),
        additionalProperties: false,
      };
    }
    case 'ZodString':
      return {
        type: 'string',
        ...Object.fromEntries(
          def.checks
            .filter((check: any) => check.kind === 'regex')
            .map((check: any) => ['pattern', check.regex.source]),
        ),
      };
    case 'ZodNumber': {
      const result: any = {
        type: def.checks.some((check: any) => check.kind === 'int') ? 'integer' : 'number',
      };
      for (const check of def.checks) {
        if (check.kind === 'min') {
          result.minimum = check.value;
          if (!check.inclusive) result.exclusiveMinimum = true;
        }
        if (check.kind === 'max') {
          result.maximum = check.value;
          if (!check.inclusive) result.exclusiveMaximum = true;
        }
      }
      return result;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodLiteral':
      return { type: typeof def.value, enum: [def.value] };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodArray':
      return { type: 'array', items: convert(def.type) };
    case 'ZodRecord':
      return {
        type: 'object',
        properties: Object.fromEntries(
          def.keyType.options.map((key: string) => [key, convert(def.valueType)]),
        ),
        additionalProperties: false,
      };
    case 'ZodUnion':
      return { anyOf: def.options.map(convert) };
    case 'ZodTuple':
      return {
        type: 'array',
        minItems: def.items.length,
        maxItems: def.items.length,
        items: { anyOf: def.items.map(convert) },
      };
    default:
      throw new Error(`Unsupported billing schema node: ${def.typeName}`);
  }
}

export const billingRulesOpenApi = convert(billingRulesSchema);

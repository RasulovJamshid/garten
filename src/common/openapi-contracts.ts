import { billingRulesOpenApi } from './billing-rules-openapi';
import { OpenAPIObject } from '@nestjs/swagger';
import contracts from './response-contracts.json';

export function applyResponseContracts(
  document: OpenAPIObject,
  source: Record<string, any> = contracts,
) {
  for (const path of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = path[method];
      if (!operation?.operationId) continue;
      const contract = source[operation.operationId];
      if (!contract) continue;
      operation.security = contract.public ? [] : [{ bearer: [] }];
      if (
        ['PaymentsController_create', 'BillingRunsController_commit'].includes(
          operation.operationId,
        )
      ) {
        operation.parameters ??= [];
        if (
          !operation.parameters.some(
            (p) => 'in' in p && p.in === 'header' && p.name.toLowerCase() === 'idempotency-key',
          )
        )
          operation.parameters.push({
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Stable key for retrying this exact operation',
          });
      }
      const requestBody = operation.requestBody;
      if (requestBody && 'content' in requestBody) {
        const multipart = requestBody.content['multipart/form-data']?.schema;
        if (multipart && !('$ref' in multipart) && multipart.properties?.file)
          multipart.required = [...new Set([...(multipart.required ?? []), 'file'])];
      }
      for (const parameter of operation.parameters ?? []) {
        if ('in' in parameter && parameter.in === 'query' && parameter.name in contract.query)
          parameter.required = contract.query[parameter.name];
      }
      const successes = Object.keys(operation.responses).filter((status) => /^2/.test(status));
      const binary = successes.some((status) => {
        const response = operation.responses[status];
        return (
          response &&
          'content' in response &&
          response.content &&
          Object.keys(response.content).some((mime) => mime !== 'application/json')
        );
      });
      let responseSchema = contract.schema;
      if (method === 'get' && responseSchema?.type === 'array') {
        operation.parameters ??= [];
        for (const name of ['page', 'limit'])
          if (!operation.parameters.some((p) => 'name' in p && p.name === name))
            operation.parameters.push({
              name,
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                ...(name === 'limit' ? { maximum: 200, default: 50 } : { default: 1 }),
              },
              description: 'Opt in to a paginated {data, meta} response.',
            });
        responseSchema = {
          oneOf: [
            responseSchema,
            {
              type: 'object',
              required: ['data', 'meta'],
              properties: {
                data: responseSchema,
                meta: {
                  type: 'object',
                  required: ['page', 'limit', 'total', 'pages'],
                  properties: Object.fromEntries(
                    ['page', 'limit', 'total', 'pages'].map((key) => [key, { type: 'integer' }]),
                  ),
                },
              },
            },
          ],
        };
      }
      if (!binary && responseSchema) {
        for (const status of successes) delete operation.responses[status];
        operation.responses[contract.status] = {
          description: 'Success',
          content: { 'application/json': { schema: responseSchema } },
        };
      }
      const binaryContent = (mime: string) => ({
        [mime]: { schema: { type: 'string' as const, format: 'binary' } },
      });
      const id = operation.operationId;
      if (id === 'PaymentsController_receipt')
        operation.responses['200'] = {
          description: 'HTML or PDF receipt',
          content: {
            'text/html': { schema: { type: 'string' } },
            ...binaryContent('application/pdf'),
          },
        };
      if (
        [
          'FilesController_download',
          'PublicLandingController_media',
          'ImportsController_template',
        ].includes(id)
      )
        operation.responses['200'] = {
          description: 'File bytes',
          content: binaryContent(
            id === 'ImportsController_template'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/octet-stream',
          ),
        };
      if (id.startsWith('ReportsController_')) {
        operation.responses['200'] = {
          description: 'Report rows or a generated file; selected by format',
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            ...binaryContent('application/pdf'),
            ...binaryContent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
          },
        };
        operation.responses['202'] = {
          description: 'Queued export',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['jobId', 'status'],
                properties: {
                  jobId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            },
          },
        };
      }
      if (['PublicLandingController_page', 'PublicLandingController_defaultPage'].includes(id))
        operation.responses['304'] = { description: 'ETag matches; no response body' };
      if (
        !contract.schema &&
        !id.startsWith('ReportsController_') &&
        !operation.responses[contract.status]?.hasOwnProperty('content')
      )
        operation.responses[contract.status] = { description: 'Success; no response body' };
      document.components ??= {};
      document.components.schemas ??= {};
      document.components.schemas.ApiErrorEnvelope = {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'traceId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              traceId: { type: 'string' },
              details: {},
            },
          },
        },
      };
      for (const status of [400, 401, 403, 404, 409, 422])
        operation.responses[status] ??= {
          description: 'Request rejected',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
          },
        };
    }
  }
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.BillingRulesDefinition = billingRulesOpenApi;
  for (const name of ['CreateBillingRulesDto', 'SimulateBillingDto']) {
    const schema = document.components.schemas[name];
    if (schema && !('$ref' in schema) && schema.properties?.rules)
      schema.properties.rules = { $ref: '#/components/schemas/BillingRulesDefinition' };
  }
  return document;
}

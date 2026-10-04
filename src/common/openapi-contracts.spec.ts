import contracts from './response-contracts.json';
import { applyResponseContracts } from './openapi-contracts';

describe('frontend response contract', () => {
  const source = contracts as Record<string, any>;
  it('includes child names and nullable group fields in the directory', () => {
    const child = source.ChildrenController_list.schema.properties.data.items;
    expect(child.properties.firstName.type).toBe('string');
    expect(child.properties.groupId.nullable).toBe(true);
    expect(child.properties.hasDebt).toBeDefined();
  });
  it('documents actual attendance POST status and returned child', () => {
    expect(source.AttendanceController_checkIn.status).toBe(201);
    expect(
      source.AttendanceController_checkIn.schema.properties.child.properties.firstName,
    ).toBeDefined();
    expect(source.AttendanceController_checkIn.schema.properties.attendanceDate.format).toBe(
      'date-time',
    );
  });
  it('makes collection pagination and optional filters explicit', () => {
    const document: any = {
      paths: {
        '/payments': {
          get: {
            operationId: 'PaymentsController_list',
            responses: { 200: { description: '' } },
            parameters: [{ name: 'childId', in: 'query', required: true }],
          },
        },
      },
    };
    applyResponseContracts(document);
    const operation = document.paths['/payments'].get;
    expect(operation.parameters.find((p: any) => p.name === 'childId').required).toBe(false);
    expect(operation.parameters.find((p: any) => p.name === 'page').required).toBe(false);
    expect(
      operation.responses[200].content['application/json'].schema.oneOf[1].properties.meta,
    ).toBeDefined();
  });
});

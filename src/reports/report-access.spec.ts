import { AuthContext, PermissionScope } from '../common/auth-context';
import { assertExportAccess, captureReportAccess } from './report-access';

const context = (scope: PermissionScope = 'branch', branches = ['A'], groups = ['G']) =>
  new AuthContext(
    'user',
    'tenant',
    branches,
    groups,
    new Map([
      ['report:read', 'all'],
      ['child:read', scope],
    ]),
  );
describe('export download authorization', () => {
  it('requires correction access for attendance correction exports', () => {
    const reader = new AuthContext(
      'user',
      'tenant',
      [],
      [],
      new Map([
        ['report:read', 'all'],
        ['attendance:read', 'all'],
      ]),
    );
    expect(() => captureReportAccess(reader, 'attendance/corrections')).toThrow();
    const corrector = new AuthContext(
      'user',
      'tenant',
      [],
      [],
      new Map([
        ['report:read', 'all'],
        ['attendance:correct', 'all'],
      ]),
    );
    expect(
      captureReportAccess(corrector, 'attendance/corrections').permissions['attendance:correct'],
    ).toBe('all');
  });
  const original = context();
  const job = {
    createdBy: 'user',
    reportKey: 'children/active',
    expiresAt: new Date(Date.now() + 60000),
    params: { __access: captureReportAccess(original, 'children/active') },
  };
  it('allows the creator while report access remains sufficient', () =>
    expect(() => assertExportAccess(original, job)).not.toThrow());
  it('rejects a creator whose branch coverage narrowed', () =>
    expect(() => assertExportAccess(context('branch', ['B']), job)).toThrow());
  it('allows broader current access', () =>
    expect(() => assertExportAccess(context('all'), job)).not.toThrow());
  it('rejects another user and legacy exports without access snapshots', () => {
    expect(() => assertExportAccess(original, { ...job, createdBy: 'other' })).toThrow();
    expect(() => assertExportAccess(original, { ...job, params: {} })).toThrow();
  });
  it('rejects narrowing from all children to one group', () => {
    const all = {
      ...job,
      params: { __access: captureReportAccess(context('all'), 'children/active') },
    };
    expect(() => assertExportAccess(context('own_group'), all)).toThrow();
  });
});

import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/session.dart';
import 'helpers.dart';

void main() {
  test('valid login works with deployed legacy API without bootstrap', () async {
    final paths = <String>[];
    final api = testApi((request) {
      paths.add(request.path);
      expect(request.uri.path.startsWith('/api/v1/'), isTrue);
      switch (request.path) {
        case '/auth/login':
          return reply(
            {'accessToken': 'valid-token'},
            headers: {
              'set-cookie': [
                'kg_refresh=session.token; Path=/api/v1/auth; HttpOnly; Secure',
              ],
            },
          );
        case '/auth/bootstrap':
          return reply({
            'error': {'code': 'NOT_FOUND'},
          }, status: 404);
        case '/auth/me':
          expect(request.headers['Authorization'], 'Bearer valid-token');
          return reply({
            'user': {'id': 'teacher', 'fullName': 'Teacher'},
            'permissions': {
              'child:read': 'own_group',
              'attendance:read': 'own_group',
            },
          });
        default:
          fail(
            'Must not request administrative lookups without permissions: ${request.path}',
          );
      }
    });
    final session = Session(api);
    await session.login('teacher', 'correct-password');
    expect(session.name, 'Teacher');
    expect(session.can('attendance:read'), isTrue);
    expect(session.can('branch:manage'), isFalse);
    expect(paths, ['/auth/login', '/auth/bootstrap', '/auth/me']);
    await session.reload();
    expect(paths.last, '/auth/me');
    expect(paths.where((p) => p == '/auth/bootstrap').length, 1);
  });
  test('legacy admin resolves only permitted lookup data', () async {
    final session = Session(
      testApi((r) {
        switch (r.path) {
          case '/auth/bootstrap':
            return reply({}, status: 404);
          case '/auth/me':
            return reply({
              'user': {'id': 'admin'},
              'permissions': {'group:read': 'branch', 'branch:manage': 'all'},
            });
          case '/branches':
            return reply([
              {'id': 'branch', 'name': 'Main'},
            ]);
          case '/groups':
            return reply([
              {'id': 'group', 'name': 'Sunflowers'},
            ]);
          default:
            fail('Unexpected endpoint');
        }
      }),
    );
    await session.reload();
    expect(session.branches.single['name'], 'Main');
    expect(session.groups.single['name'], 'Sunflowers');
  });
  test(
    'post-login failures never report invalid credentials or bypass denials',
    () async {
      for (final status in [403, 500]) {
        final paths = <String>[];
        final session = Session(
          testApi((r) {
            paths.add(r.path);
            return r.path == '/auth/login'
                ? reply({'accessToken': 'valid-token'})
                : reply({}, status: status);
          }),
        );
        await expectLater(
          session.login('user', 'correct'),
          throwsA(
            isA<ApiFailure>().having(
              (e) => e.code,
              'code',
              'PROFILE_LOAD_FAILED',
            ),
          ),
        );
        expect(paths, ['/auth/login', '/auth/bootstrap']);
        expect(session.profile, isNull);
      }
    },
  );
  test('modern bootstrap remains the preferred single request', () async {
    final session = Session(
      testApi((r) {
        expect(r.path, '/auth/bootstrap');
        return reply({
          'user': {'id': 'owner'},
          'permissions': {},
          'groups': [],
          'branches': [],
        });
      }),
    );
    await session.reload();
    expect(session.profile?['user']['id'], 'owner');
  });
}

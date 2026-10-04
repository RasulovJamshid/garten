import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'helpers.dart';

void main() {
  test(
    'concurrent 401s share refresh and send the rotated cookie only to auth',
    () async {
      var refreshes = 0;
      final secrets = MemorySecrets();
      final api = testApi((request) async {
        if (request.path == '/auth/login') {
          return reply(
            {'accessToken': 'old'},
            headers: {
              'set-cookie': [
                'kg_refresh=first; HttpOnly; Secure; Path=/api/v1/auth',
              ],
            },
          );
        }
        if (request.path == '/auth/refresh') {
          refreshes++;
          expect(request.headers['Cookie'], 'kg_refresh=first');
          await Future<void>.delayed(const Duration(milliseconds: 10));
          return reply(
            {'accessToken': 'new'},
            headers: {
              'set-cookie': ['kg_refresh=second; HttpOnly; Secure'],
            },
          );
        }
        expect(request.headers.containsKey('Cookie'), isFalse);
        return request.headers['Authorization'] == 'Bearer new'
            ? reply({'ok': true})
            : reply({
                'error': {'code': 'UNAUTHORIZED'},
              }, status: 401);
      }, secrets: secrets);
      await api.login('user', 'password');
      final results = await Future.wait([
        api.request('/children'),
        api.request('/payments'),
      ]);
      expect(results.every((r) => object(r)['ok'] == true), isTrue);
      expect(refreshes, 1);
      expect(secrets.values.values, contains('second'));
    },
  );
  test('refresh failure removes credentials and expires the session', () async {
    final secrets = MemorySecrets();
    final api = testApi(
      (r) => r.path == '/auth/login'
          ? reply(
              {'accessToken': 'old'},
              headers: {
                'set-cookie': ['kg_refresh=first'],
              },
            )
          : reply({}, status: 401),
      secrets: secrets,
    );
    var expired = false;
    api.onExpired = () => expired = true;
    await api.login('user', 'password');
    await expectLater(api.request('/children'), throwsA(isA<ApiFailure>()));
    expect(expired, isTrue);
    expect(secrets.values, isEmpty);
  });
  test(
    'GET requests and delayed refresh cannot resurrect a logged-out session',
    () async {
      final gate = Completer<void>();
      final begun = Completer<void>();
      final secrets = MemorySecrets();
      final api = testApi((r) async {
        if (r.path == '/auth/login') {
          return reply(
            {'accessToken': 'old'},
            headers: {
              'set-cookie': ['kg_refresh=first'],
            },
          );
        }
        if (r.path == '/auth/refresh') {
          begun.complete();
          await gate.future;
          return reply(
            {'accessToken': 'new'},
            headers: {
              'set-cookie': ['kg_refresh=second'],
            },
          );
        }
        return reply({}, status: 401);
      }, secrets: secrets);
      await api.login('user', 'password');
      final request = api.request('/children');
      final assertion = expectLater(request, throwsA(isA<ApiFailure>()));
      await begun.future;
      await api.clear();
      gate.complete();
      await assertion;
      expect(secrets.values, isEmpty);
    },
  );
  test(
    'API does not retry uncertain financial writes on server failures',
    () async {
      var writes = 0;
      final api = testApi((r) {
        writes++;
        expect(r.headers['Idempotency-Key'], 'stable-key');
        return reply({}, status: 503);
      });
      await expectLater(
        api.request(
          '/payments',
          method: 'POST',
          data: {'amountTiyin': '100'},
          idempotencyKey: 'stable-key',
        ),
        throwsA(isA<ApiFailure>()),
      );
      expect(writes, 1);
    },
  );
  test(
    'rejects credential-bearing redirects and insecure server URLs',
    () async {
      expect(
        () =>
            ApiClient(baseUrl: 'http://example.com', secrets: MemorySecrets()),
        throwsArgumentError,
      );
      final api = testApi((_) => reply({}));
      expect(api.dio.options.followRedirects, isFalse);
      await expectLater(
        api.request('https://other.invalid'),
        throwsArgumentError,
      );
    },
  );
}

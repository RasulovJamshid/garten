import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/core/api.dart';
import 'helpers.dart';

void main() {
  testWidgets(
    'restored payment retries the exact payload and key after a server failure',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final secrets = MemorySecrets();
      final payload = {
        'childId': 'child-1',
        'amountTiyin': '12345',
        'method': 'cash',
        'paidAt': '2026-09-17T06:00:00Z',
      };
      const storageKey = 'payment:https://test.invalid/api/v1:user-1';
      secrets.values[storageKey] = jsonEncode({
        'payload': payload,
        'key': 'original-key',
        'child': {'id': 'child-1', 'firstName': 'Ali', 'lastName': 'Karimov'},
      });
      final writes = <Json>[];
      final api = testApi((r) {
        if (r.path == '/payments') {
          expect(r.headers['Idempotency-Key'], 'original-key');
          writes.add(object(r.data));
          return writes.length == 1
              ? reply({}, status: 503)
              : reply({'id': 'payment-1'});
        }
        return reply({
          'data': [],
          'meta': {'total': 0},
        });
      }, secrets: secrets);
      final session = testSession(['child:read', 'payment:create'], api: api);
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      await tester.tap(find.text('To‘lov qabul qilish'));
      await tester.pumpAndSettle();
      expect(find.text('123.45 UZS'), findsOneWidget);
      for (var attempt = 0; attempt < 2; attempt++) {
        await tester.tap(find.text('Qayta urinish'));
        await tester.pumpAndSettle();
        await tester.tap(
          find.widgetWithText(TextButton, 'To‘lov qabul qilish'),
        );
        await tester.pumpAndSettle();
      }
      expect(writes, [payload, payload]);
      expect(secrets.values.containsKey(storageKey), isFalse);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('denied pickup never submits checkout', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final paths = <String>[];
    final session = testSession(
      ['attendance:read', 'attendance:checkout', 'pickup:read'],
      api: testApi((r) {
        paths.add(r.path);
        if (r.path == '/attendance/board') {
          return reply({
            'data': [
              {
                'child': {
                  'id': 'child-1',
                  'firstName': 'Ali',
                  'lastName': 'Karimov',
                },
                'attendance': {'checkInAt': '2026-09-17T06:00:00Z'},
              },
            ],
          });
        }
        if (r.path == '/pickup-permissions/active') {
          return reply([
            {'id': 'permission-1', 'adhocFullName': 'Aliyev Bekzod'},
          ]);
        }
        if (r.path == '/pickup/verify') return reply({'allowed': false});
        return reply({});
      }),
    );
    await tester.pumpWidget(AlishaxApp(session: session));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(NavigationDestination).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Olib ketish'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ruxsatni tekshirish'));
    await tester.pumpAndSettle();
    expect(find.text('Olib ketishga ruxsat yo‘q'), findsOneWidget);
    expect(paths, isNot(contains('/attendance/check-out')));
    expect(tester.takeException(), isNull);
  });
}

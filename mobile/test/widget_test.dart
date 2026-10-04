import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/core/session.dart';
import 'helpers.dart';

void main() {
  testWidgets(
    'iOS phone supports large Russian text without layout exceptions',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.6;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final session = testSession([
        'child:read',
        'attendance:read',
        'payment:read',
      ])..language = 'ru';
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      expect(find.text('Сегодня'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
  testWidgets(
    'login validates empty input and renders Russian on a narrow phone',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final session = Session(testApi((_) => reply({})))
        ..loading = false
        ..language = 'ru';
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Войти'));
      await tester.tap(find.text('Войти'));
      await tester.pumpAndSettle();
      expect(find.text('Заполните это поле'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'teacher sees attendance and children, never finance or staff management',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final session = testSession([
        'attendance:read',
        'attendance:checkin',
        'child:read',
      ]);
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      expect(find.byType(NavigationDestination), findsNWidgets(4));
      expect(find.text('Moliya'), findsNothing);
      expect(find.text('Xodimlar'), findsNothing);
      await tester.tap(find.text('Boshqa'));
      await tester.pumpAndSettle();
      expect(find.text('Xodimlar'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'tablet uses navigation rail and permission revocation removes finance',
    (tester) async {
      tester.view.physicalSize = const Size(1024, 768);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = testApi(
        (_) => reply({
          'user': {'fullName': 'Teacher'},
          'permissions': {},
          'groups': [],
          'branches': [],
        }),
      );
      final session = testSession(['payment:read'], api: api);
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      expect(find.byType(NavigationRail), findsOneWidget);
      await tester.tap(find.text('Moliya'));
      await tester.pumpAndSettle();
      await tester.runAsync(session.reload);
      await tester.pumpAndSettle();
      expect(find.text('Moliya'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'attendance uses server roster and distinguishes unmarked from absent',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final session = testSession(
        ['attendance:read'],
        api: testApi(
          (_) => reply({
            'date': '2026-09-17',
            'data': [
              {
                'child': {'id': '1', 'firstName': 'Ali', 'lastName': 'Karimov'},
                'attendance': null,
              },
              {
                'child': {
                  'id': '2',
                  'firstName': 'Malika',
                  'lastName': 'Usmonova',
                },
                'attendance': {'status': 'absent'},
              },
            ],
          }),
        ),
      );
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(NavigationDestination).at(1));
      await tester.pumpAndSettle();
      expect(find.text('Belgilanmagan'), findsOneWidget);
      expect(find.text('Kelmadi'), findsOneWidget);
      expect(find.text('Keldi'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/attendance.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'helpers.dart';

void main() {
  testWidgets(
    'appearance persists and changing it preserves the current route',
    (tester) async {
      final secrets = MemorySecrets();
      final session = testSession(
        [],
        api: testApi((_) => reply({}), secrets: secrets),
      );
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      final context = tester.element(find.byType(Navigator).first);
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Retained route')),
        ),
      );
      await tester.pumpAndSettle();
      await session.setThemeMode(ThemeMode.dark);
      await tester.pumpAndSettle();
      expect(find.text('Retained route'), findsOneWidget);
      expect(
        Theme.of(tester.element(find.text('Retained route'))).brightness,
        Brightness.dark,
      );
      final restored = Session(testApi((_) => reply({}), secrets: secrets));
      await restored.start();
      expect(restored.themeMode, ThemeMode.dark);
      await session.setThemeMode(ThemeMode.system);
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      await tester.pumpAndSettle();
      expect(
        Theme.of(tester.element(find.text('Retained route'))).brightness,
        Brightness.light,
      );
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpAndSettle();
      expect(
        Theme.of(tester.element(find.text('Retained route'))).brightness,
        Brightness.dark,
      );
      tester.platformDispatcher.clearPlatformBrightnessTestValue();
    },
  );

  testWidgets(
    'absence filter includes all reasons and search can be cleared in dark mode',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final session = testSession(
        ['attendance:read'],
        api: testApi(
          (_) => reply({
            'data': [
              for (final status in [
                'absent',
                'sick',
                'vacation',
                'excused',
                'pending',
              ])
                {
                  'child': {'id': status, 'firstName': status},
                  'attendance': {'status': status},
                },
            ],
          }),
        ),
      )..language = 'ru';
      await tester.pumpWidget(
        AppScope(
          session: session,
          child: MaterialApp(
            theme: mobileTheme(brightness: Brightness.dark),
            home: const Scaffold(body: AttendancePage()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final away = find.widgetWithText(
        FilterChip,
        '${translate('ru', 'absences')} · 4',
      );
      await tester.tap(away);
      await tester.pumpAndSettle();
      expect(find.text('pending'), findsNothing);
      await tester.enterText(find.byType(TextField), 'sick');
      await tester.pumpAndSettle();
      expect(find.text('absent'), findsNothing);
      expect(find.text('sick'), findsWidgets);
      await tester.tap(find.byTooltip(translate('ru', 'clearSearch')));
      await tester.pumpAndSettle();
      expect(find.text('absent'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('changing groups hides the previous roster while loading', (
    tester,
  ) async {
    final response = Completer<void>();
    final session = testSession(
      ['attendance:read', 'attendance:checkin'],
      api: testApi((request) async {
        if (request.queryParameters['groupId'] == 'g2') await response.future;
        return reply({
          'data': [
            {
              'child': {
                'id': 'c1',
                'firstName': request.queryParameters['groupId'] == 'g2'
                    ? 'New child'
                    : 'Old child',
              },
              'attendance': null,
            },
          ],
        });
      }),
    );
    session.profile!['groups'] = [
      {'id': 'g2', 'name': 'Second group'},
    ];
    await tester.pumpWidget(
      AppScope(
        session: session,
        child: MaterialApp(home: const Scaffold(body: AttendancePage())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Old child'), findsOneWidget);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Second group').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Old child'), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    response.complete();
    await tester.pumpAndSettle();
    expect(find.text('New child'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

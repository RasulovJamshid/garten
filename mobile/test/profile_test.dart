import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/profile.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'helpers.dart';

Widget profileScreen(Session session) => AppScope(
  session: session,
  child: MaterialApp(
    theme: mobileTheme(),
    home: const Scaffold(
      body: SingleChildScrollView(
        padding: EdgeInsets.all(20),
        child: CurrentProfileCard(),
      ),
    ),
  ),
);

void main() {
  test(
    'role names prefer the current language and fall back without losing custom names',
    () {
      expect(
        profileRoleName({'nameUz': 'Direktor', 'nameRu': 'Директор'}, 'ru'),
        'Директор',
      );
      expect(
        profileRoleName({'nameUz': 'Maxsus rol', 'nameRu': '  '}, 'ru'),
        'Maxsus rol',
      );
      expect(profileRoleName({'code': 'director'}, 'ru'), 'Директор');
      expect(profileRoleName({'code': 'custom_role'}, 'uz'), 'custom_role');
      expect(profileRoleName({}, 'ru'), translate('ru', 'role'));
    },
  );

  testWidgets(
    'profile shows all assigned roles, switches language and refreshes assignments',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.6;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      late Json refreshed;
      final session = testSession([
        'child:read',
      ], api: testApi((_) => reply(refreshed)));
      session.profile!['roles'] = [
        {
          'id': 'role-1',
          'code': 'director',
          'nameUz': 'Direktor',
          'nameRu': 'Директор',
        },
        {
          'id': 'role-2',
          'code': 'custom',
          'nameUz': 'Qo‘shimcha guruhlar bo‘yicha mas’ul xodim',
          'nameRu': 'Ответственный сотрудник по дополнительным группам',
        },
      ];
      refreshed = {
        ...session.profile!,
        'roles': [
          {
            'id': 'role-3',
            'code': 'teacher',
            'nameUz': 'Tarbiyachi',
            'nameRu': 'Воспитатель',
          },
        ],
      };
      await tester.pumpWidget(profileScreen(session));
      await tester.pumpAndSettle();
      expect(find.text('Direktor'), findsOneWidget);
      expect(find.byType(Chip), findsNWidgets(2));
      await session.setLanguage('ru');
      await tester.pumpAndSettle();
      expect(find.text('Директор'), findsOneWidget);
      expect(
        find.text('Ответственный сотрудник по дополнительным группам'),
        findsOneWidget,
      );
      expect(find.text('Direktor'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.runAsync(session.reload);
      await tester.pumpAndSettle();
      expect(find.text('Воспитатель'), findsOneWidget);
      expect(find.byType(Chip), findsOneWidget);
      expect(find.text('Директор'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'missing and empty roles have distinct localized states and never infer roles from access',
    (tester) async {
      final session = testSession(['role:manage', 'child:read']);
      await tester.pumpWidget(profileScreen(session));
      await tester.pumpAndSettle();
      expect(find.text(translate('uz', 'roleInfoUnavailable')), findsOneWidget);
      expect(find.byType(Chip), findsNothing);
      session.profile!['roles'] = [];
      await session.setLanguage('ru');
      await tester.pumpAndSettle();
      expect(find.text(translate('ru', 'noAssignedRoles')), findsOneWidget);
      expect(find.byType(Chip), findsNothing);
    },
  );
}

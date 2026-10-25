import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/ui/children.dart';
import 'helpers.dart';

void main() {
  testWidgets(
    'payment-only users select children under payment creation scope',
    (tester) async {
      final paths = <String>[];
      final session = testSession(
        ['payment:create'],
        api: testApi((request) {
          paths.add(request.path);
          if (request.path == '/lookups/children') {
            expect(request.queryParameters['permission'], 'payment:create');
            return reply({
              'data': [
                {
                  'id': 'child-b',
                  'firstName': 'Ali',
                  'lastName': 'Karimov',
                  'branchId': 'B',
                },
              ],
              'meta': {'total': 1},
            });
          }
          return reply({
            'data': [],
            'meta': {'total': 0},
          });
        }),
      );
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      await tester.tap(find.text('To‘lov qabul qilish'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithIcon(ListTile, Icons.child_care));
      await tester.pumpAndSettle();
      expect(find.text('Karimov Ali'), findsOneWidget);
      expect(paths, contains('/lookups/children'));
      expect(paths, isNot(contains('/children')));
      await tester.tap(find.text('Karimov Ali'));
      await tester.pumpAndSettle();
      expect(find.text('Karimov Ali'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'child readers see linked guardians and medical alerts without clinical editing',
    (tester) async {
      final paths = <String>[];
      final session = testSession(
        ['child:read', 'medical:alerts'],
        api: testApi((request) {
          paths.add(request.path);
          if (request.path.endsWith('/medical/alerts')) {
            return reply({
              'allergies': [
                {'allergen': 'Peanut', 'instruction': 'Avoid contact'},
              ],
              'emergencyInstructions': 'Call guardian immediately',
            });
          }
          return reply({
            'id': 'child-a',
            'firstName': 'Ali',
            'lastName': 'Karimov',
            'status': 'active',
          });
        }),
      );
      await tester.pumpWidget(
        AppScope(
          session: session,
          child: const MaterialApp(
            home: ChildPage(id: 'child-a', name: 'Karimov Ali'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.family_restroom), findsOneWidget);
      expect(find.byIcon(Icons.health_and_safety_outlined), findsOneWidget);
      await tester.tap(find.byIcon(Icons.health_and_safety_outlined));
      await tester.pumpAndSettle();
      expect(find.text('Peanut — Avoid contact'), findsOneWidget);
      expect(find.text('Call guardian immediately'), findsOneWidget);
      expect(find.byIcon(Icons.edit_outlined), findsNothing);
      expect(paths, contains('/children/child-a/medical/alerts'));
      expect(paths, isNot(contains('/children/child-a/medical')));
      expect(paths, contains('/children/child-a/guardians'));
      expect(tester.takeException(), isNull);
    },
  );
}

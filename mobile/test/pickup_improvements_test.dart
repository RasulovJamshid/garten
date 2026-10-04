import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/attendance.dart';
import 'package:alishax_mobile/ui/reference_picker.dart';
import 'package:alishax_mobile/ui/reference_field.dart';
import 'helpers.dart';

void main() {
  Widget host(Session session, Widget child) => AppScope(
    session: session,
    child: MaterialApp(home: Scaffold(body: child)),
  );
  testWidgets(
    'granting parent uses only child lookup and cannot fall back to cached unrelated parents',
    (tester) async {
      final paths = <String>[];
      final session = testSession(
        ['pickup:manage', 'guardian:read'],
        api: testApi((r) {
          paths.add(r.path);
          expect(r.path, '/lookups/children/child-1/pickup-guardians');
          expect(r.queryParameters['permission'], 'pickup:manage');
          return reply([
            {'id': 'parent-1', 'fullName': 'Linked parent'},
          ]);
        }),
      );
      session.rememberReference('guardianId', {
        'id': 'unrelated',
        'fullName': 'Unrelated parent',
      });
      expect(referenceSource(session, 'grantedByGuardianId'), isNull);
      await tester.pumpWidget(
        host(
          session,
          ReferenceField(
            name: 'grantedByGuardianId',
            label: 'Parent',
            value: null,
            onChanged: (_) {},
          ),
        ),
      );
      await tester.tap(find.byType(InkWell).first);
      await tester.pumpAndSettle();
      expect(paths, isEmpty);
      dynamic chosen;
      await tester.pumpWidget(
        host(
          session,
          ReferenceField(
            name: 'grantedByGuardianId',
            label: 'Parent',
            value: null,
            values: const {'childId': 'child-1'},
            onChanged: (v) => chosen = v,
          ),
        ),
      );
      await tester.tap(find.byType(InkWell).first);
      await tester.pumpAndSettle();
      expect(find.text('Linked parent'), findsOneWidget);
      expect(find.text('Unrelated parent'), findsNothing);
      await tester.tap(find.text('Linked parent'));
      await tester.pumpAndSettle();
      expect(chosen, 'parent-1');
    },
  );

  testWidgets(
    'check-in updates one child without reloading board or disabling another child',
    (tester) async {
      var boardLoads = 0;
      final save = Completer<void>();
      final session = testSession(
        ['attendance:read', 'attendance:checkin'],
        api: testApi((r) async {
          if (r.path == '/attendance/board') {
            boardLoads++;
            return reply({
              'data': [
                for (final id in ['one', 'two'])
                  {
                    'child': {'id': id, 'firstName': id},
                    'attendance': null,
                  },
              ],
            });
          }
          await save.future;
          return reply({
            'childId': 'one',
            'checkInAt': '2026-10-04T04:00:00Z',
            'status': 'present',
          });
        }),
      );
      await tester.pumpWidget(host(session, const AttendancePage()));
      await tester.pumpAndSettle();
      final first = find.descendant(
        of: find.byKey(const ValueKey('one')),
        matching: find.byType(FilledButton),
      );
      await tester.ensureVisible(first);
      await tester.tap(first);
      await tester.pump();
      final second = find.descendant(
        of: find.byKey(const ValueKey('two')),
        matching: find.byType(FilledButton),
      );
      expect(tester.widget<FilledButton>(second).onPressed, isNotNull);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      save.complete();
      await tester.pumpAndSettle();
      expect(boardLoads, 1);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('one')),
          matching: find.text(translate('uz', 'inside')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('two')),
          matching: find.text(translate('uz', 'pending')),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'parent checkout works with no additional pickup people and updates board in place',
    (tester) async {
      var boardLoads = 0;
      Json? checkedOut;
      final session = testSession(
        ['attendance:read', 'attendance:checkout', 'pickup:read'],
        api: testApi((r) {
          if (r.path == '/attendance/board') {
            boardLoads++;
            return reply({
              'data': [
                {
                  'child': {'id': 'child-1', 'firstName': 'Ali'},
                  'attendance': {'checkInAt': '2026-10-04T04:00:00Z'},
                },
              ],
            });
          }
          if (r.path.endsWith('/pickup-guardians')) {
            return reply([
              {
                'id': 'parent-1',
                'fullName': 'Ali parent',
                'relationship': 'mother',
                'phone': '123',
              },
            ]);
          }
          if (r.path == '/pickup-permissions/active') return reply([]);
          if (r.path == '/pickup/verify') {
            expect(r.queryParameters['guardianId'], 'parent-1');
            expect(r.queryParameters.containsKey('pickupPermissionId'), false);
            return reply({'allowed': true, 'pickupName': 'Ali parent'});
          }
          if (r.path == '/attendance/check-out') {
            checkedOut = object(r.data);
            return reply({
              'childId': 'child-1',
              'checkInAt': '2026-10-04T04:00:00Z',
              'checkOutAt': '2026-10-04T12:00:00Z',
            });
          }
          throw StateError(r.path);
        }),
      );
      await tester.pumpWidget(host(session, const AttendancePage()));
      await tester.pumpAndSettle();
      final checkout = find.text(translate('uz', 'checkOut'));
      await tester.ensureVisible(checkout);
      await tester.tap(checkout);
      await tester.pumpAndSettle();
      expect(find.text('Ali parent'), findsOneWidget);
      await tester.tap(find.text(translate('uz', 'verify')));
      await tester.pumpAndSettle();
      expect(checkedOut, isNull);
      await tester.tap(find.text(translate('uz', 'confirm')));
      await tester.pumpAndSettle();
      expect(checkedOut, {'childId': 'child-1', 'guardianId': 'parent-1'});
      expect(boardLoads, 1);
      expect(find.text(translate('uz', 'left')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

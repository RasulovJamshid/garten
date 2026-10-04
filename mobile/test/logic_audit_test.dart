import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/core/workflows.dart';
import 'package:alishax_mobile/ui/common.dart';
import 'package:alishax_mobile/ui/children.dart';
import 'package:alishax_mobile/ui/groups.dart';
import 'package:alishax_mobile/ui/payment.dart';
import 'package:alishax_mobile/ui/reference_field.dart';
import 'package:alishax_mobile/ui/workflows.dart';
import 'helpers.dart';

class UnreadableSecrets extends MemorySecrets {
  bool failing = true;
  @override
  Future<String?> read(String key) async {
    if (failing) throw StateError('Storage unavailable');
    return super.read(key);
  }
}

Widget screen(Session session, Widget child) => AppScope(
  session: session,
  child: MaterialApp(home: Scaffold(body: child)),
);
FeatureCatalog catalog() => FeatureCatalog(
  records(
    object(
      jsonDecode(File('assets/api-contract.json').readAsStringSync()),
    )['operations'],
  ).map(FeatureOperation.new).toList(),
);

void main() {
  testWidgets(
    'child dependent selectors never offer cached records before choosing a child',
    (tester) async {
      final session = testSession([
        'child:read',
        'payment:create',
        'pickup:read',
      ]);
      for (final name in [
        'docId',
        'consentId',
        'discountId',
        'assignmentId',
        'pickupPersonId',
        'pickupPermissionId',
        'payerGuardianId',
      ]) {
        session.rememberReference(referenceKind(name), {
          'id': 'other-child-record',
          'fullName': 'Unrelated',
        });
        await tester.pumpWidget(
          screen(
            session,
            ReferenceField(
              name: name,
              label: name,
              value: null,
              onChanged: (_) {},
            ),
          ),
        );
        expect(
          tester.widget<InkWell>(find.byType(InkWell).first).onTap,
          isNull,
          reason: name,
        );
      }
    },
  );
  test('guardian lookup results are never interpreted as children', () {
    expect(
      workflowResultKind('/lookups/children/{id}/pickup-guardians'),
      'guardianId',
    );
    expect(workflowResultKind('/lookups/children/{id}/payers'), 'guardianId');
    expect(workflowResultKind('/lookups/children'), 'childId');
  });
  testWidgets('late staff response cannot overwrite a newly selected group', (
    tester,
  ) async {
    final old = Completer<ResponseBody>();
    final session = testSession(
      ['group:read', 'group:manage', 'user:manage'],
      api: testApi((r) {
        if (r.path == '/groups/old/staff') return old.future;
        if (r.path == '/groups/new/staff') {
          return reply({
            'mainTeacher': {'id': 'new-teacher', 'fullName': 'New teacher'},
          });
        }
        return reply([
          {'id': 'new', 'name': 'New group'},
        ]);
      }),
    );
    await tester.pumpWidget(
      screen(
        session,
        const GroupStaffPage(group: {'id': 'old', 'name': 'Old group'}),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('Old group'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New group'));
    await tester.pumpAndSettle();
    expect(find.text('New teacher'), findsOneWidget);
    old.complete(
      reply({
        'mainTeacher': {'id': 'old-teacher', 'fullName': 'Old teacher'},
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('New teacher'), findsOneWidget);
    expect(find.text('Old teacher'), findsNothing);
  });
  testWidgets(
    'payment recovery read failure blocks a new payment until retry succeeds',
    (tester) async {
      final secrets = UnreadableSecrets();
      final session = testSession([
        'payment:create',
      ], api: testApi((_) => reply({}), secrets: secrets));
      await tester.pumpWidget(screen(session, const PaymentPage()));
      await tester.pumpAndSettle();
      expect(find.byType(FailureView), findsOneWidget);
      expect(find.byType(TextFormField), findsNothing);
      secrets.failing = false;
      await tester.tap(find.text(translate('uz', 'retry')));
      await tester.pumpAndSettle();
      expect(find.byType(TextFormField), findsWidgets);
    },
  );
  testWidgets(
    'rejected recovered payment retains fractional amount and note for correction',
    (tester) async {
      final secrets = MemorySecrets();
      secrets.values['payment:https://test.invalid/api/v1:user-1'] = jsonEncode(
        {
          'payload': {
            'childId': 'child-1',
            'amountTiyin': '12345',
            'method': 'cash',
            'paidAt': '2026-10-04T04:00:00Z',
            'note': 'Keep this note',
          },
          'child': {'id': 'child-1', 'firstName': 'Ali'},
          'key': 'same-request',
        },
      );
      final session = testSession([
        'payment:create',
      ], api: testApi((_) => reply({}, status: 422), secrets: secrets));
      await tester.pumpWidget(screen(session, const PaymentPage()));
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('uz', 'retry')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('uz', 'confirm')));
      await tester.pumpAndSettle();
      final texts = tester
          .widgetList<TextFormField>(find.byType(TextFormField))
          .map((f) => f.controller!.text);
      expect(texts, contains('123.45'));
      expect(texts, contains('Keep this note'));
    },
  );
  testWidgets(
    'refresh after loading another page restarts the collection at page one',
    (tester) async {
      final pages = <int>[];
      final session = testSession(
        ['payment:read'],
        api: testApi((r) {
          final page = r.queryParameters['page'] as int;
          pages.add(page);
          return reply({
            'data': [
              {'id': 'payment-$page', 'receiptNo': 'Receipt $page'},
            ],
            'meta': {'pages': 2},
          });
        }),
      );
      await tester.pumpWidget(
        screen(session, WorkflowSection(group: 'payments', catalog: catalog())),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('uz', 'loadMore')));
      await tester.pumpAndSettle();
      expect(pages, [1, 2]);
      final refresh = tester
          .widget<RefreshIndicator>(find.byType(RefreshIndicator))
          .onRefresh();
      await tester.pumpAndSettle();
      await refresh;
      expect(pages, [1, 2, 1]);
      expect(find.text('Receipt 1'), findsWidgets);
      expect(find.text('Receipt 2'), findsNothing);
    },
  );
  testWidgets(
    'child search hides old selectable results while the new query is pending',
    (tester) async {
      final pending = Completer<ResponseBody>();
      final session = testSession(
        ['payment:create'],
        api: testApi((r) {
          if (r.queryParameters['q'] == 'Malika') return pending.future;
          return reply({
            'data': [
              {'id': 'old', 'firstName': 'Ali'},
            ],
            'meta': {'total': 1},
          });
        }),
      );
      await tester.pumpWidget(
        screen(
          session,
          const ChildrenPage(select: true, lookupPermission: 'payment:create'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Ali'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Malika');
      await tester.pump();
      expect(find.text('Ali'), findsNothing);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Ali'), findsNothing);
      pending.complete(
        reply({
          'data': [
            {'id': 'new', 'firstName': 'Malika'},
          ],
          'meta': {'total': 1},
        }),
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ListTile, 'Malika'), findsOneWidget);
    },
  );
  testWidgets(
    'malformed saved payment cannot be overwritten by a fresh submission',
    (tester) async {
      final secrets = MemorySecrets();
      const storageKey = 'payment:https://test.invalid/api/v1:user-1';
      secrets.values[storageKey] = '{malformed';
      var writes = 0;
      final session = testSession(
        ['payment:create'],
        api: testApi((r) {
          writes++;
          return reply({});
        }, secrets: secrets),
      );
      await tester.pumpWidget(screen(session, const PaymentPage()));
      await tester.pumpAndSettle();
      expect(find.byType(FailureView), findsOneWidget);
      expect(find.byType(TextFormField), findsNothing);
      expect(secrets.values[storageKey], '{malformed');
      expect(writes, 0);
    },
  );
}

import 'dart:io';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:share_plus/share_plus.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/features.dart';
import 'package:alishax_mobile/ui/reference_picker.dart';
import 'package:alishax_mobile/ui/reference_field.dart';
import 'helpers.dart';

Widget screen(Session session, Widget child) => AppScope(
  session: session,
  child: MaterialApp(home: child),
);

Future<void> submit(WidgetTester tester) async {
  final button = find.byType(FilledButton);
  await tester.scrollUntilVisible(
    button,
    400,
    scrollable: find.byType(Scrollable).first,
  );
  await Scrollable.ensureVisible(tester.element(button), alignment: .5);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle(
    const Duration(milliseconds: 100),
    EnginePhase.sendSemanticsUpdate,
    const Duration(seconds: 3),
  );
  await tester.tap(find.text(translate('uz', 'confirm')));
  await tester.pumpAndSettle(
    const Duration(milliseconds: 100),
    EnginePhase.sendSemanticsUpdate,
    const Duration(seconds: 3),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'every API operation is reachable or explicitly accounted for',
    () async {
      final catalog = FeatureCatalog(
        records(
          object(
            jsonDecode(File('assets/api-contract.json').readAsStringSync()),
          )['operations'],
        ).map(FeatureOperation.new).toList(),
      );
      final document = object(
        jsonDecode(File('../openapi.json').readAsStringSync()),
      );
      final committed = object(
        jsonDecode(File('assets/api-contract.json').readAsStringSync()),
      );
      final actual = <String>{
        for (final methods in object(document['paths']).values)
          for (final op in object(methods).values)
            object(op)['operationId'] as String,
      };
      final accounted = {
        ...catalog.operations.map((o) => o.id),
        ...records(committed['excluded']).map((o) => o['id'] as String),
      };
      expect(accounted, actual);
      expect(
        catalog.operations.map((o) => o.id).toSet().length,
        catalog.operations.length,
      );
      final adjustment = catalog.operations.firstWhere(
        (o) => o.id == 'ChargesController_adjustment',
      );
      expect(adjustment.allowed(testSession(['charge:generate'])), isFalse);
      expect(
        adjustment.allowed(testSession(['charge:generate', 'charge:reverse'])),
        isTrue,
      );
      expect(
        catalog
            .available(testSession(['attendance:read']))
            .any((o) => o.id == 'PaymentsController_cancel'),
        isFalse,
      );
      final discount = catalog.operations.firstWhere(
        (o) => o.id == 'DiscountsController_revoke',
      );
      expect(
        discount.resolvePath({
          'childId': 'child-a',
          'discountId': 'discount-b',
        }),
        '/children/child-a/discounts/discount-b',
      );
      final staff = catalog.operations.firstWhere(
        (o) => o.id == 'GroupsController_setStaff',
      );
      expect(
        object(object(staff.body['properties'])['mainTeacherId'])['type'],
        'string',
      );
      expect(
        object(object(staff.body['properties'])['mainTeacherId'])['nullable'],
        isTrue,
      );
    },
  );

  test('money and numeric values remain correctly typed and precise', () {
    expect(
      parseField('amountTiyin', '90071992547409.93', {'type': 'string'}),
      '9007199254740993',
    );
    expect(parseField('minAmountTiyin', '0', {'type': 'string'}), '0');
    expect(parseField('month', '10', {'type': 'integer'}), 10);
    expect(
      () => parseField('month', '1.2', {'type': 'integer'}),
      throwsFormatException,
    );
    expect(validateField(13, {'maximum': 12}), 'invalid');
    expect(validateField('short', {'minLength': 10}), 'invalid');
    expect(
      seededValues(
        {'type': 'object', 'properties': {}, 'additionalProperties': false},
        {'childId': 'a'},
      ),
      isEmpty,
    );
    expect(
      recordContext('/payments', {
        'id': 'payment-a',
        'childId': 'child-b',
      }, {})['childId'],
      'child-b',
    );
    expect(referenceSource(testSession(['payment:create']), 'childId')!.$2, {
      'permission': 'payment:create',
    });
  });

  test('upload MIME and multipart replay survive token refresh', () async {
    final api = testApi((request) {
      if (request.path == '/auth/login') {
        return reply(
          {'accessToken': 'first'},
          headers: {
            'set-cookie': ['kg_refresh=refresh; Path=/api/v1/auth; HttpOnly'],
          },
        );
      }
      if (request.path == '/auth/refresh') {
        return reply({'accessToken': 'second'});
      }
      final data = request.data as FormData;
      expect(data.files.single.key, 'file');
      expect(data.files.single.value.contentType.toString(), 'application/pdf');
      return request.headers['Authorization'] == 'Bearer first'
          ? reply({
              'error': {'code': 'UNAUTHORIZED'},
            }, status: 401)
          : reply({'fileId': 'uploaded'});
    });
    await api.login('staff', 'password');
    final file = await multipartFile(
      XFile.fromData(
        Uint8List.fromList(utf8.encode('%PDF-1.7')),
        name: 'report.pdf',
      ),
    );
    final result = await api.request(
      '/files',
      method: 'POST',
      data: FormData.fromMap({'file': file}),
    );
    expect(object(result)['fileId'], 'uploaded');
  });

  testWidgets('every authenticated operation renders on a phone', (
    tester,
  ) async {
    final catalog = FeatureCatalog(
      records(
        object(
          jsonDecode(File('assets/api-contract.json').readAsStringSync()),
        )['operations'],
      ).map(FeatureOperation.new).toList(),
    );
    final grants = catalog.operations
        .expand((o) => (o.contract['permissions'] as List).cast<String>())
        .toSet()
        .toList();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final session = testSession(grants);
    for (final language in ['uz', 'ru']) {
      session.language = language;
      for (final operation in catalog.operations) {
        await tester.pumpWidget(
          screen(
            session,
            FeatureOperationPage(
              key: ValueKey(operation.id),
              operation: operation,
            ),
          ),
        );
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 3),
        );
        expect(tester.takeException(), isNull, reason: operation.id);
        expect(
          find.text(translate(session.language, operation.id)),
          findsOneWidget,
        );
      }
    }
  });

  testWidgets(
    'expense form sends correctly typed year, month, and exact money',
    (tester) async {
      final catalog = FeatureCatalog(
        records(
          object(
            jsonDecode(File('assets/api-contract.json').readAsStringSync()),
          )['operations'],
        ).map(FeatureOperation.new).toList(),
      );
      final op = catalog.operations.firstWhere(
        (o) => o.id == 'ExpensesController_create',
      );
      Json? payload;
      final session = testSession(
        ['expense:manage'],
        api: testApi((request) {
          payload = object(request.data);
          return reply({'id': 'expense-new'});
        }),
      );
      await tester.pumpWidget(
        screen(
          session,
          FeatureOperationPage(
            operation: op,
            contextValues: {
              'branchId': '11111111-1111-4111-8111-111111111111',
              'billingYear': 2026,
              'billingMonth': 10,
              'type': 'other',
              'description': 'Books',
              'amountTiyin': '1234567',
              'dueDate': '2026-10-04',
            },
          ),
        ),
      );
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 3),
      );
      await submit(tester);
      expect(payload?['amountTiyin'], '1234567');
      expect(payload?['billingYear'], 2026);
      expect(payload?['billingMonth'], 10);
      expect(payload!.containsKey('id'), isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('nested medical updates preserve allergy records', (
    tester,
  ) async {
    final catalog = FeatureCatalog(
      records(
        object(
          jsonDecode(File('assets/api-contract.json').readAsStringSync()),
        )['operations'],
      ).map(FeatureOperation.new).toList(),
    );
    final op = catalog.operations.firstWhere(
      (o) => o.id == 'ChildrenController_updateMedical',
    );
    Json? payload;
    final session = testSession(
      ['medical:write'],
      api: testApi((request) {
        expect(request.path, '/children/child-a/medical');
        expect(request.method, 'PUT');
        payload = object(request.data);
        return reply({'success': true});
      }),
    );
    await tester.pumpWidget(
      screen(
        session,
        FeatureOperationPage(
          operation: op,
          contextValues: {'childId': 'child-a'},
          recordGroup: 'children',
          initialRecord: {
            'allergies': [
              {
                'id': 'readonly-allergy-id',
                'childId': 'readonly-child-id',
                'allergen': 'Milk',
                'severity': 'mild',
                'instruction': 'Avoid dairy',
              },
            ],
            'note': 'Updated',
          },
        ),
      ),
    );
    await tester.pumpAndSettle(
      const Duration(milliseconds: 100),
      EnginePhase.sendSemanticsUpdate,
      const Duration(seconds: 3),
    );
    await submit(tester);
    expect(records(payload?['allergies']).single['allergen'], 'Milk');
    expect(records(payload?['allergies']).single.containsKey('id'), isFalse);
    expect(
      records(payload?['allergies']).single.containsKey('childId'),
      isFalse,
    );
    expect(payload?['note'], 'Updated');
    expect(payload!.containsKey('childId'), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'billing commit restores the original record and key after restart',
    (tester) async {
      final catalog = FeatureCatalog(
        records(
          object(
            jsonDecode(File('assets/api-contract.json').readAsStringSync()),
          )['operations'],
        ).map(FeatureOperation.new).toList(),
      );
      final op = catalog.operations.firstWhere(
        (o) => o.id == 'BillingRunsController_commit',
      );
      final secrets = MemorySecrets();
      final calls = <RequestOptions>[];
      final session = testSession(
        ['charge:generate'],
        api: testApi((request) {
          calls.add(request);
          return calls.length == 1
              ? reply({
                  'error': {'code': 'REQUEST_FAILED'},
                }, status: 503)
              : reply({'committed': true});
        }, secrets: secrets),
      );
      await tester.pumpWidget(
        screen(
          session,
          FeatureOperationPage(
            key: const ValueKey('first'),
            operation: op,
            contextValues: {'id': 'run-first'},
          ),
        ),
      );
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 3),
      );
      await submit(tester);
      expect(calls.length, 1);
      expect(
        secrets.values.keys.any((k) => k.startsWith('operation:')),
        isTrue,
      );
      await tester.pumpWidget(
        screen(
          session,
          FeatureOperationPage(
            key: const ValueKey('restarted'),
            operation: op,
            contextValues: {'id': 'run-different'},
          ),
        ),
      );
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 3),
      );
      expect(
        tester
            .widget<ReferenceField>(find.byType(ReferenceField).first)
            .enabled,
        isFalse,
      );
      await submit(tester);
      expect(calls.length, 2);
      expect(calls.last.path, '/billing-runs/run-first/commit');
      expect(
        calls.last.headers['Idempotency-Key'],
        calls.first.headers['Idempotency-Key'],
      );
      expect(calls.last.data, calls.first.data);
      expect(
        secrets.values.keys.any((k) => k.startsWith('operation:')),
        isFalse,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('nullable staff assignment can be explicitly cleared', (
    tester,
  ) async {
    final catalog = FeatureCatalog(
      records(
        object(
          jsonDecode(File('assets/api-contract.json').readAsStringSync()),
        )['operations'],
      ).map(FeatureOperation.new).toList(),
    );
    final op = catalog.operations.firstWhere(
      (o) => o.id == 'GroupsController_setStaff',
    );
    Json? payload;
    final session = testSession(
      ['group:manage'],
      api: testApi((request) {
        if (request.path == '/auth/bootstrap') {
          return reply({
            'user': {'id': 'user-1'},
            'permissions': {'group:manage': 'all'},
          });
        }
        payload = object(request.data);
        return reply({'success': true});
      }),
    );
    await tester.pumpWidget(
      screen(
        session,
        FeatureOperationPage(
          operation: op,
          contextValues: {'id': 'group-a'},
          recordGroup: 'groups',
          initialRecord: {'mainTeacherId': null},
        ),
      ),
    );
    await tester.pumpAndSettle(
      const Duration(milliseconds: 100),
      EnginePhase.sendSemanticsUpdate,
      const Duration(seconds: 3),
    );
    expect(find.text(translate('uz', 'clearValue')), findsOneWidget);
    await submit(tester);
    expect(payload!.containsKey('mainTeacherId'), isTrue);
    expect(payload!['mainTeacherId'], isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('receipts download authenticated PDF bytes', (tester) async {
    final catalog = FeatureCatalog(
      records(
        object(
          jsonDecode(File('assets/api-contract.json').readAsStringSync()),
        )['operations'],
      ).map(FeatureOperation.new).toList(),
    );
    final op = catalog.operations.firstWhere(
      (o) => o.id == 'PaymentsController_receipt',
    );
    final session = testSession(
      ['payment:read'],
      api: testApi((request) {
        expect(request.path, '/payments/payment-a/receipt');
        expect(request.queryParameters['format'], 'pdf');
        return ResponseBody.fromBytes(
          utf8.encode('%PDF-1.7'),
          200,
          headers: {
            'content-type': ['application/pdf'],
            'content-disposition': [
              'attachment; filename="receipt-payment-a.pdf"',
            ],
          },
        );
      }),
    );
    await tester.pumpWidget(
      screen(
        session,
        FeatureOperationPage(operation: op, contextValues: {'id': 'payment-a'}),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byType(FilledButton),
      400,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('receipt-payment-a.pdf'),
      400,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('receipt-payment-a.pdf'), findsOneWidget);
    expect(find.byIcon(Icons.ios_share), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'queued report exports expose the status action instead of a fake file',
    (tester) async {
      final catalog = FeatureCatalog(
        records(
          object(
            jsonDecode(File('assets/api-contract.json').readAsStringSync()),
          )['operations'],
        ).map(FeatureOperation.new).toList(),
      );
      final op = catalog.operations.firstWhere(
        (o) => o.id == 'ReportsController_attendanceDaily',
      );
      final session = testSession(
        ['report:read'],
        api: testApi((request) {
          expect(request.queryParameters['format'], 'xlsx');
          return reply({'id': 'export-a', 'status': 'pending'}, status: 202);
        }),
      );
      await tester.pumpWidget(
        screen(
          session,
          FeatureOperationPage(
            operation: op,
            contextValues: {'date': '2026-10-04', 'format': 'xlsx'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byType(FilledButton),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text(translate('uz', 'checkExport')),
        400,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text(translate('uz', 'checkExport')), findsOneWidget);
      expect(find.byIcon(Icons.ios_share), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}

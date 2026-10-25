import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/core/workflows.dart';
import 'package:alishax_mobile/ui/business_fields.dart';
import 'package:alishax_mobile/ui/payment.dart';
import 'package:alishax_mobile/ui/payment_details.dart';
import 'package:alishax_mobile/ui/reference_picker.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'package:alishax_mobile/ui/notification_preview.dart';
import 'package:alishax_mobile/ui/workflow_task.dart';
import 'package:alishax_mobile/ui/organization_details_field.dart';
import 'helpers.dart';

FeatureCatalog contract() => FeatureCatalog(
  records(
    object(
      jsonDecode(File('assets/api-contract.json').readAsStringSync()),
    )['operations'],
  ).map(FeatureOperation.new).toList(),
);
Widget screen(Session session, Widget child) => AppScope(
  session: session,
  child: MaterialApp(
    home: Scaffold(body: SingleChildScrollView(child: child)),
  ),
);

void main() {
  testWidgets('legacy directory payment retries its original payload and key', (
    tester,
  ) async {
    final secrets = MemorySecrets();
    const legacyKey =
        'operation:https://test.invalid/api/v1:user-1:PaymentsController_create';
    final payload = {
      'childId': 'child-a',
      'amountTiyin': '10000',
      'method': 'cash',
      'paidAt': '2026-10-25T06:00:00Z',
      'bankRef': 'original reference',
    };
    secrets.values[legacyKey] = jsonEncode({
      'path': '/payments',
      'data': payload,
      'pathValues': {},
      'query': {},
      'key': 'legacy-key',
    });
    final session = testSession(
      ['payment:create'],
      api: testApi((r) {
        expect(r.path, '/payments');
        expect(r.headers['Idempotency-Key'], 'legacy-key');
        expect(r.data, payload);
        return reply({}, status: 503);
      }, secrets: secrets),
    );
    await tester.pumpWidget(
      AppScope(
        session: session,
        child: const MaterialApp(home: PaymentPage()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('100 UZS'), findsOneWidget);
    await tester.tap(find.text(translate('uz', 'retry')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.widgetWithText(TextButton, translate('uz', 'recordPayment')),
    );
    await tester.pumpAndSettle();
    expect(object(jsonDecode(secrets.values[legacyKey]!))['data'], payload);
    expect(
      secrets.values.containsKey('payment:https://test.invalid/api/v1:user-1'),
      isFalse,
    );
  });
  testWidgets('typed bank details preserve custom configuration', (
    tester,
  ) async {
    Json value = {
      'bankName': 'Existing bank',
      'custom': {'code': 'keep'},
    };
    await tester.pumpWidget(
      screen(
        testSession([]),
        StatefulBuilder(
          builder: (context, update) => OrganizationDetailsField(
            name: 'bankDetails',
            value: value,
            onChanged: (v) => update(() => value = object(v)),
          ),
        ),
      ),
    );
    await tester.tap(find.text(translate('uz', 'bankDetails')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, 'Updated bank');
    expect(value['bankName'], 'Updated bank');
    expect(value['custom'], {'code': 'keep'});
  });
  test(
    'working days retain array type and integer members in generated contract',
    () {
      final schema = object(
        contract().operations
            .firstWhere((o) => o.id == 'SettingsController_update')
            .body['properties'],
      );
      expect(object(schema['workingDays'])['type'], 'array');
      expect(object(object(schema['workingDays'])['items'])['type'], 'integer');
    },
  );
  test('dedicated payment preserves every optional API field', () {
    final body = contract().operations
        .firstWhere((o) => o.id == 'PaymentsController_create')
        .body;
    final expected = {
      ...body,
      'properties': {
        for (final e in object(body['properties']).entries)
          if (!['childId', 'amountTiyin', 'method', 'note'].contains(e.key))
            e.key: e.value,
      },
      'required': ['paidAt'],
    };
    expect(paymentDetailSchema, expected);
  });
  testWidgets(
    'weekday chips submit ISO weekday numbers and preserve settings',
    (tester) async {
      Json value = {
        'workingDays': [1, 3],
        'defaultLanguage': 'ru',
      };
      final op = contract().operations.firstWhere(
        (o) => o.id == 'SettingsController_update',
      );
      final session = testSession(['settings:manage']);
      await tester.pumpWidget(
        screen(
          session,
          StatefulBuilder(
            builder: (context, update) => SchemaObjectForm(
              schema: workflowBodySchema(op, value, session),
              value: value,
              onChanged: (v) => update(() => value = v),
            ),
          ),
        ),
      );
      await tester.ensureVisible(find.text(translate('uz', 'weekday2')));
      await tester.tap(find.text(translate('uz', 'weekday2')));
      await tester.pump();
      expect(value['workingDays'], [1, 2, 3]);
      expect(value['defaultLanguage'], 'ru');
      expect(find.text('[1, 2, 3]'), findsNothing);
    },
  );
  testWidgets(
    'business timestamp displays Tashkent time and preserves UTC payload',
    (tester) async {
      var value = '2026-10-25T06:41:34.315887Z';
      await tester.pumpWidget(
        screen(
          testSession([]),
          BusinessDateField(
            label: 'Payment date',
            value: value,
            timestamp: true,
            onChanged: (v) => value = v,
          ),
        ),
      );
      final field = tester.widget<TextFormField>(find.byType(TextFormField));
      expect(field.initialValue, contains('11:41'));
      expect(field.initialValue, isNot(contains('315887')));
      expect(value, '2026-10-25T06:41:34.315887Z');
      expect(
        tester.widget<EditableText>(find.byType(EditableText)).readOnly,
        isTrue,
      );
    },
  );
  testWidgets(
    'template picker selects API templateKey and renders named variables and preview',
    (tester) async {
      final session = testSession(
        ['notification_template:manage'],
        api: testApi(
          (_) => reply([
            {
              'templateKey': 'customReminder',
              'variables': ['amount'],
              'bodyUz': 'Summa: {amount}',
              'bodyRu': 'Сумма: {amount}',
            },
          ]),
        ),
      );
      Json? selected;
      await tester.pumpWidget(
        screen(
          session,
          Builder(
            builder: (context) => TextButton(
              child: const Text('Choose'),
              onPressed: () async {
                selected = await Navigator.push<Json>(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const ReferencePicker(
                      path: '/notification-templates',
                      title: 'Template',
                      valueKey: 'key',
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tester.tap(find.text('Choose'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('customReminder'));
      await tester.pumpAndSettle();
      expect(selected?['key'], 'customReminder');
      session.rememberReference('templateKey', selected!, valueKey: 'key');
      final values = {
        'templateKey': 'customReminder',
        'data': {'amount': '120 000 UZS'},
      };
      final op = contract().operations.firstWhere(
        (o) => o.id == 'NotificationsController_send',
      );
      expect(
        object(
          object(workflowBodySchema(op, values, session)['properties'])['data'],
        )['required'],
        ['amount'],
      );
      await tester.pumpWidget(
        screen(session, NotificationPreview(values: values)),
      );
      expect(find.text('Summa: 120 000 UZS'), findsOneWidget);
      expect(find.text('Сумма: 120 000 UZS'), findsOneWidget);
    },
  );
  testWidgets(
    'directory payment opens canonical screen without submitting records',
    (tester) async {
      final requests = <String>[];
      final session = testSession(
        ['payment:create'],
        api: testApi((r) {
          requests.add(r.method);
          return reply({});
        }),
      );
      final catalog = contract();
      await tester.pumpWidget(
        screen(
          session,
          Builder(
            builder: (context) => TextButton(
              child: const Text('Payment'),
              onPressed: () => openWorkflowTask(
                context,
                catalog,
                catalog.operations.firstWhere(
                  (o) => o.id == 'PaymentsController_create',
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Payment'));
      await tester.pumpAndSettle();
      expect(find.byType(PaymentPage), findsOneWidget);
      expect(requests, isEmpty);
    },
  );
  testWidgets('same-name child records retain branch and stable identity', (
    tester,
  ) async {
    final session = testSession(['payment:create']);
    session.profile!['branches'] = [
      {'id': 'b', 'name': 'Central'},
    ];
    late String result;
    await tester.pumpWidget(
      screen(
        session,
        Builder(
          builder: (context) {
            result = referenceSubtitle(context, {
              'id': 'child-a',
              'firstName': 'Ali',
              'lastName': 'Karimov',
              'branchId': 'b',
            });
            return Text(result);
          },
        ),
      ),
    );
    expect(result, contains('Central'));
    expect(result, contains('child-a'));
  });
}

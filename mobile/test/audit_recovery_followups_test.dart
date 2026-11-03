import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/form_feedback.dart';
import 'package:alishax_mobile/ui/payment.dart';
import 'package:alishax_mobile/ui/payment_child_field.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'helpers.dart';

Widget app(Session session, Widget home) => AppScope(
  session: session,
  child: MaterialApp(home: home),
);

void main() {
  testWidgets(
    'choosing a child clears the prior required error without another submit',
    (tester) async {
      final form = GlobalKey<FormState>();
      Json? selected;
      final session = testSession(
        ['payment:create'],
        api: testApi(
          (_) => reply({
            'data': [
              {
                'id': 'fixture-child',
                'firstName': 'Fixture',
                'lastName': 'Child',
              },
            ],
            'meta': {'total': 1},
          }),
        ),
      );
      await tester.pumpWidget(
        app(
          session,
          Scaffold(
            body: StatefulBuilder(
              builder: (context, update) => Form(
                key: form,
                child: PaymentChildField(
                  child: selected,
                  enabled: true,
                  onChanged: (value) => update(() => selected = value),
                ),
              ),
            ),
          ),
        ),
      );
      expect(form.currentState!.validate(), isFalse);
      await tester.pump();
      expect(
        tester
            .widget<InputDecorator>(find.byType(InputDecorator))
            .decoration
            .errorText,
        isNotNull,
      );
      await tester.tap(find.byType(ListTile));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Child Fixture'));
      await tester.pumpAndSettle();
      expect(selected?['id'], 'fixture-child');
      expect(
        tester
            .widget<InputDecorator>(find.byType(InputDecorator))
            .decoration
            .errorText,
        isNull,
      );
    },
  );

  testWidgets('required upload receives focus after failed validation', (
    tester,
  ) async {
    final form = GlobalKey<FormState>();
    await tester.pumpWidget(
      app(
        testSession([]),
        Scaffold(
          body: Form(
            key: form,
            child: SchemaValueForm(
              name: 'file',
              schema: const {'type': 'string', 'format': 'binary'},
              value: null,
              required: true,
              onChanged: (_) {},
            ),
          ),
          floatingActionButton: FloatingActionButton(
            onPressed: () => validateAndReveal(form),
            child: const Icon(Icons.check),
          ),
        ),
      ),
    );
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<OutlinedButton>(find.byType(OutlinedButton))
          .focusNode!
          .hasFocus,
      isTrue,
    );
    expect(find.text(translate('uz', 'required')), findsOneWidget);
  });

  for (final status in [400, 422]) {
    testWidgets(
      'uncertain restored payment retains original key after later $status',
      (tester) async {
        final secrets = MemorySecrets();
        const key = 'payment:https://test.invalid/api/v1:user-1';
        final payload = {
          'childId': 'child-1',
          'amountTiyin': '12345',
          'method': 'cash',
          'paidAt': '2026-11-03T06:00:00Z',
        };
        secrets.values[key] = jsonEncode({
          'payload': payload,
          'key': 'original-key',
          'child': {
            'id': 'child-1',
            'firstName': 'Fixture',
            'lastName': 'Child',
          },
        });
        var calls = 0;
        final session = testSession(
          ['payment:create'],
          api: testApi((request) {
            expect(request.path, '/payments');
            expect(request.data, payload);
            expect(request.headers['Idempotency-Key'], 'original-key');
            calls++;
            return reply({
              'error': {'code': 'VALIDATION_FAILED'},
            }, status: status);
          }, secrets: secrets),
        );
        await tester.pumpWidget(app(session, const PaymentPage()));
        await tester.pumpAndSettle();
        await tester.tap(
          find.widgetWithText(FilledButton, translate('uz', 'retry')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.widgetWithText(TextButton, translate('uz', 'recordPayment')),
        );
        await tester.pumpAndSettle();
        expect(calls, 1);
        final saved = object(jsonDecode(secrets.values[key]!));
        expect(saved['payload'], payload);
        expect(saved['key'], 'original-key');
        expect(
          find.widgetWithText(FilledButton, translate('uz', 'retry')),
          findsOneWidget,
        );
        expect(find.byType(TextFormField), findsNothing);
      },
    );
  }

  testWidgets('confirmed first validation rejection permits correction', (
    tester,
  ) async {
    final secrets = MemorySecrets();
    var calls = 0;
    final session = testSession(
      ['payment:create'],
      api: testApi((request) {
        if (request.method == 'POST') {
          calls++;
          return reply({
            'error': {'code': 'VALIDATION_FAILED'},
          }, status: 422);
        }
        return reply([]);
      }, secrets: secrets),
    );
    await tester.pumpWidget(
      app(
        session,
        const PaymentPage(
          initialChild: {
            'id': 'child-1',
            'firstName': 'Fixture',
            'lastName': 'Child',
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    final amount = find.byType(TextFormField).first;
    await tester.enterText(amount, '100');
    final next = find.widgetWithText(FilledButton, translate('uz', 'next'));
    await tester.ensureVisible(next);
    await tester.tap(next);
    await tester.pumpAndSettle();
    await tester.tap(
      find.widgetWithText(TextButton, translate('uz', 'recordPayment')),
    );
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(secrets.values, isEmpty);
    expect(amount, findsOneWidget);
    expect(tester.widget<TextFormField>(amount).controller!.text, '100');
  });
}

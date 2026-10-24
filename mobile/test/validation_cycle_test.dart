import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'helpers.dart';

void main() {
  test('calendar dates cannot silently roll over to another month', () {
    for (final value in [
      '2026-02-31',
      '2025-02-29',
      '2026-13-01',
      '20261024',
    ]) {
      expect(
        validateField(value, {'type': 'string', 'format': 'date'}),
        'invalid',
        reason: value,
      );
    }
    expect(
      validateField('2024-02-29', {'type': 'string', 'format': 'date'}),
      isNull,
    );
    expect(
      validateField('2026-10-24', {'type': 'string', 'format': 'date-time'}),
      'invalid',
    );
    expect(
      validateField('2026-10-24T09:30:00+05:00', {
        'type': 'string',
        'format': 'date-time',
      }),
      isNull,
    );
  });
  test('email and required text reject invalid or whitespace-only input', () {
    expect(
      validateField('not-an-email', {'type': 'string', 'format': 'email'}),
      'invalid',
    );
    expect(
      validateField('   ', {'type': 'string'}, required: true),
      'required',
    );
    expect(
      validateField('parent@example.test', {
        'type': 'string',
        'format': 'email',
      }),
      isNull,
    );
  });
  testWidgets('out-of-range typed date does not crash the calendar picker', (
    tester,
  ) async {
    final session = testSession([]);
    await tester.pumpWidget(
      AppScope(
        session: session,
        child: MaterialApp(
          home: Scaffold(
            body: SchemaValueForm(
              name: 'birthDate',
              schema: const {'type': 'string', 'format': 'date'},
              value: '9999-12-31',
              onChanged: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byIcon(Icons.calendar_today));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(DatePickerDialog), findsOneWidget);
  });
}

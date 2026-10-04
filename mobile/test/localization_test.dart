import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/features.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'helpers.dart';
import 'package:alishax_mobile/main.dart';

FeatureCatalog contract() => FeatureCatalog(
  records(
    object(
      jsonDecode(File('assets/api-contract.json').readAsStringSync()),
    )['operations'],
  ).map(FeatureOperation.new).toList(),
);
Widget localizedScreen(Session session, Widget child) => AppScope(
  session: session,
  child: MaterialApp(
    theme: mobileTheme(),
    home: Scaffold(body: child),
  ),
);

void main() {
  test(
    'both languages cover every operation, group, request field and enum',
    () {
      final keys = <String>{};
      void visit(Json schema) {
        for (final entry in object(schema['properties']).entries) {
          keys.add(entry.key);
          visit(object(entry.value));
        }
        if (object(schema['items']).isNotEmpty) visit(object(schema['items']));
        for (final value in schema['enum'] as List? ?? []) {
          if (value is String) keys.add(value);
        }
      }

      for (final op in contract().operations) {
        keys.addAll([op.id, op.group]);
        visit(op.body);
        for (final parameter in op.parameters) {
          keys.add(parameter['name'] as String);
          visit(object(parameter['schema']));
        }
        expect(translate('ru', op.id), isNot(op.title), reason: op.id);
      }
      for (final key in keys) {
        expect(labels.containsKey(key), isTrue, reason: 'Missing $key');
        expect(labels[key], hasLength(2), reason: key);
        for (final language in ['uz', 'ru']) {
          expect(
            translate(language, key).trim(),
            isNotEmpty,
            reason: '$language: $key',
          );
        }
      }
    },
  );

  testWidgets(
    'categorical values localize while authored content is preserved',
    (tester) async {
      final session = testSession([])..language = 'ru';
      await tester.pumpWidget(
        localizedScreen(
          session,
          Builder(
            builder: (context) {
              expect(
                displayValue(context, 'status', 'processing'),
                'Выполняется',
              );
              expect(displayValue(context, 'active', true), 'Да');
              expect(
                displayValue(context, 'createdAt', '2026-10-04T02:30:00Z'),
                '04.10.2026 · 07:30',
              );
              expect(countText(context, 'action', 1), '1 действие');
              expect(countText(context, 'action', 3), '3 действия');
              expect(countText(context, 'action', 11), '11 действий');
              expect(countText(context, 'action', 21), '21 действие');
              expect(displayValue(context, 'active', false), 'Нет');
              expect(displayValue(context, 'note', 'active'), 'active');
              expect(displayValue(context, 'firstName', 'Ali'), 'Ali');
              expect(formLabel(context, 'allergies 2'), 'Аллергии 2');
              expect(
                formLabel(context, 'unknownFutureField'),
                'Дополнительные сведения',
              );
              return const SizedBox();
            },
          ),
        ),
      );
    },
  );

  testWidgets(
    'optional fields remain omitted until selected and can be removed',
    (tester) async {
      final session = testSession([]);
      Json value = {'firstName': 'Ali'};
      await tester.pumpWidget(
        localizedScreen(
          session,
          StatefulBuilder(
            builder: (context, update) => Form(
              child: SingleChildScrollView(
                child: SchemaObjectForm(
                  schema: {
                    'type': 'object',
                    'required': ['firstName'],
                    'properties': {
                      'firstName': {'type': 'string'},
                      'phone': {'type': 'string'},
                    },
                  },
                  value: value,
                  onChanged: (next) => update(() => value = next),
                ),
              ),
            ),
          ),
        ),
      );
      expect(value.containsKey('phone'), isFalse);
      expect(find.text(translate('uz', 'phone')), findsNothing);
      await tester.tap(find.text(translate('uz', 'additionalFields')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('uz', 'phone')));
      await tester.pumpAndSettle();
      expect(value.containsKey('phone'), isTrue);
      await tester.tap(find.byTooltip(translate('uz', 'removeField')));
      await tester.pumpAndSettle();
      expect(value.containsKey('phone'), isFalse);
      expect(value['firstName'], 'Ali');
    },
  );

  testWidgets('Russian feature browser fits a narrow phone with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
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
    await tester.pumpWidget(
      localizedScreen(session, FeatureWorkspace(catalog: contract())),
    );
    await tester.pumpAndSettle();
    expect(find.text(translate('ru', 'featureHint')), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'посещаемость');
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text(translate('ru', 'AttendanceController_today')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text(translate('ru', 'AttendanceController_today')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('reports render localized rows without English column metadata', (
    tester,
  ) async {
    final session = testSession(['report:read'])..language = 'ru';
    final operation = contract().operations.firstWhere(
      (op) => op.id == 'ReportsController_attendanceDaily',
    );
    await tester.pumpWidget(
      localizedScreen(
        session,
        FeatureResult(
          operation: operation,
          contextValues: const {},
          value: const {
            'columns': [
              {'key': 'child', 'header': 'Child'},
              {'key': 'status', 'header': 'Status'},
            ],
            'rows': [
              {'child': 'Ali', 'status': 'present'},
            ],
          },
        ),
      ),
    );
    expect(find.text('Child'), findsNothing);
    expect(find.text('Status'), findsNothing);
    expect(find.text(translate('ru', 'child')), findsOneWidget);
    expect(find.text(translate('ru', 'present')), findsOneWidget);
    expect(find.text('Ali'), findsOneWidget);
  });

  testWidgets(
    'language selection updates the account and home screens immediately',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final session = testSession(['child:read']);
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(NavigationDestination).last);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Русский'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Русский'));
      await tester.pumpAndSettle();
      expect(session.language, 'ru');
      expect(find.text(translate('ru', 'allFeatures')), findsOneWidget);
      expect(find.text(translate('ru', 'language')), findsOneWidget);
      await tester.tap(find.byType(NavigationDestination).first);
      await tester.pumpAndSettle();
      expect(find.text(translate('ru', 'workspaceSubtitle')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/common.dart';
import 'package:alishax_mobile/ui/editors.dart';
import 'package:alishax_mobile/ui/login.dart';
import 'package:alishax_mobile/ui/payment.dart';
import 'package:alishax_mobile/ui/payment_child_field.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'helpers.dart';

Widget app(
  Session session,
  Widget home, {
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => AppScope(
  session: session,
  child: MaterialApp(
    theme: mobileTheme(brightness: brightness),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: home,
  ),
);

double contrast(Color foreground, Color background) {
  final a = foreground.computeLuminance(), b = background.computeLuminance();
  return a > b ? (a + .05) / (b + .05) : (b + .05) / (a + .05);
}

void main() {
  for (final language in ['uz', 'ru']) {
    testWidgets('UX004 $language removal names identify array and item', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      final session = testSession([])..language = language;
      var values = <dynamic>['first', 'second'];
      await tester.pumpWidget(
        app(
          session,
          Scaffold(
            body: StatefulBuilder(
              builder: (context, update) => SchemaValueForm(
                name: 'phones',
                schema: const {
                  'type': 'array',
                  'items': {'type': 'string'},
                },
                value: values,
                onChanged: (next) =>
                    update(() => values = List<dynamic>.from(next)),
              ),
            ),
          ),
        ),
      );
      final remove = translate(language, 'removeItem');
      final buttons = tester
          .widgetList<Tooltip>(find.byType(Tooltip))
          .where((button) => button.message?.startsWith(remove) ?? false)
          .toList();
      expect(buttons, hasLength(2));
      expect(buttons[0].message, endsWith(' 1'));
      expect(buttons[1].message, endsWith(' 2'));
      expect(find.bySemanticsLabel(buttons[0].message!), findsOneWidget);
      await tester.tap(find.byTooltip(buttons[0].message!));
      await tester.pump();
      expect(values, ['second']);
      expect(find.byTooltip(buttons[0].message!), findsOneWidget);
      expect(find.byTooltip(buttons[1].message!), findsNothing);
      semantics.dispose();
    });
  }

  for (final brightness in Brightness.values) {
    testWidgets(
      'UX010 $brightness status and upload errors meet 4.5 contrast',
      (tester) async {
        const statuses = [
          'active',
          'inside',
          'present',
          'paid',
          'sent',
          'failed',
          'pending',
        ];
        final form = GlobalKey<FormState>();
        final session = testSession([]);
        await tester.pumpWidget(
          app(
            session,
            Scaffold(
              body: SingleChildScrollView(
                child: Form(
                  key: form,
                  child: Column(
                    children: [
                      for (final status in statuses) StatusPill(status),
                      SchemaValueForm(
                        name: 'file',
                        schema: const {'type': 'string', 'format': 'binary'},
                        value: null,
                        required: true,
                        onChanged: (_) {},
                      ),
                    ],
                  ),
                ),
              ),
            ),
            brightness: brightness,
          ),
        );
        for (final status in statuses) {
          final pill = find.byWidgetPredicate(
            (widget) => widget is StatusPill && widget.status == status,
          );
          final label = tester.widget<Text>(
            find.descendant(of: pill, matching: find.byType(Text)),
          );
          final box = tester.widget<Container>(
            find.descendant(of: pill, matching: find.byType(Container)),
          );
          final background = (box.decoration! as BoxDecoration).color!;
          expect(
            contrast(label.style!.color!, background),
            greaterThanOrEqualTo(4.5),
            reason: status,
          );
        }
        expect(form.currentState!.validate(), isFalse);
        await tester.pump();
        final error = tester.widget<Text>(
          find.text(translate('uz', 'required')),
        );
        final theme = mobileTheme(brightness: brightness);
        expect(
          contrast(error.style!.color!, theme.colorScheme.surface),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          contrast(error.style!.color!, theme.scaffoldBackgroundColor),
          greaterThanOrEqualTo(4.5),
        );
      },
    );
  }

  testWidgets(
    'UX007 UX011 recovery identifies errors and accepts backend minimum',
    (tester) async {
      final requests = <String>[];
      final session = testSession(
        [],
        api: testApi((request) {
          requests.add(request.path);
          if (request.path.endsWith('/reset-password')) {
            expect(request.data, {
              'token': 'fixture-code',
              'newPassword': '1234567890',
            });
          }
          return reply({});
        }),
      );
      await tester.pumpWidget(app(session, const LoginPage()));
      await tester.ensureVisible(find.text(translate('uz', 'forgot')));
      await tester.tap(find.text(translate('uz', 'forgot')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'next')),
      );
      await tester.pumpAndSettle();
      expect(requests, isEmpty);
      expect(
        find.text(translate('uz', 'recoveryLoginRequired')),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const ValueKey('recovery-login')),
        'fixture-user',
      );
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'next')),
      );
      await tester.pumpAndSettle();
      expect(requests, ['/auth/forgot-password']);
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'save')),
      );
      await tester.pumpAndSettle();
      expect(requests, hasLength(1));
      expect(
        find.text(translate('uz', 'recoveryCodeRequired')),
        findsOneWidget,
      );
      final fields = tester
          .widgetList<TextFormField>(find.byType(TextFormField))
          .toList();
      expect(
        fields.last.validator!('123456789'),
        translate('uz', 'passwordRecoveryLength'),
      );
      expect(fields.last.validator!('1234567890'), isNull);
      await tester.enterText(
        find.byKey(const ValueKey('recovery-code')),
        'fixture-code',
      );
      await tester.enterText(
        find.byKey(const ValueKey('recovery-password')),
        '1234567890',
      );
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'save')),
      );
      await tester.pumpAndSettle();
      expect(requests, ['/auth/forgot-password', '/auth/reset-password']);
    },
  );

  testWidgets(
    'UX011 payment exposes missing child from form bottom at large text',
    (tester) async {
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var mutations = 0;
      final session = testSession(
        ['payment:create'],
        api: testApi((request) {
          if (request.method != 'GET') mutations++;
          return reply([]);
        }),
      );
      await tester.pumpWidget(app(session, const PaymentPage(), textScale: 2));
      await tester.pumpAndSettle();
      final next = find.widgetWithText(FilledButton, translate('uz', 'next'));
      await tester.ensureVisible(next);
      await tester.tap(next);
      await tester.pumpAndSettle();
      expect(mutations, 0);
      final field = find.byType(PaymentChildField);
      expect(tester.getRect(field).top, greaterThanOrEqualTo(0));
      expect(tester.getRect(field).top, lessThan(500));
      final input = tester.widget<InputDecorator>(
        find.descendant(of: field, matching: find.byType(InputDecorator)),
      );
      expect(
        input.decoration.errorText,
        translate('uz', 'selectChildRequired'),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'UX011 record editor reveals earlier invalid field and retains later draft',
    (tester) async {
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var mutations = 0;
      final session = testSession(
        [],
        api: testApi((request) {
          mutations++;
          return reply({});
        }),
      );
      await tester.pumpWidget(
        app(
          session,
          const RecordEditor(
            title: 'edit',
            path: '/fixture',
            fields: [
              'firstName',
              'note',
              'emergencyInstructions',
              'chronicConditions',
            ],
            requiredFields: {'firstName'},
            initial: {'note': 'Preserve this draft'},
          ),
          textScale: 2,
        ),
      );
      final save = find.widgetWithText(FilledButton, translate('uz', 'save'));
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(mutations, 0);
      final first = find.byType(TextFormField).first;
      expect(tester.getRect(first).top, lessThan(500));
      expect(
        tester
            .widget<EditableText>(find.byType(EditableText).first)
            .focusNode
            .hasFocus,
        isTrue,
      );
      expect(find.text('Preserve this draft'), findsOneWidget);
    },
  );
}

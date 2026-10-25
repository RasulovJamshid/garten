import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/ui/adaptive_navigation.dart';
import 'package:alishax_mobile/ui/attendance.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'package:alishax_mobile/ui/child_contacts.dart';
import 'package:alishax_mobile/ui/features.dart';
import 'package:alishax_mobile/ui/form_feedback.dart';
import 'package:alishax_mobile/ui/publish_review.dart';
import 'package:alishax_mobile/ui/workflow_task.dart';
import 'package:alishax_mobile/ui/workflows.dart';
import 'helpers.dart';

final catalog = FeatureCatalog(
  records(
    object(
      jsonDecode(File('assets/api-contract.json').readAsStringSync()),
    )['operations'],
  ).map(FeatureOperation.new).toList(),
);
FeatureOperation operation(String id) =>
    catalog.operations.firstWhere((o) => o.id == id);
Widget app(Session session, Widget page) => AppScope(
  session: session,
  child: MaterialApp(home: page),
);

void main() {
  testWidgets('large-text navigation reveals an initially selected later tab', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = testSession([])..language = 'ru';
    await tester.pumpWidget(
      app(
        session,
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            bottomNavigationBar: LargeTextNavigation(
              tabs: const [
                ('today', Icons.today),
                ('attendance', Icons.check),
                ('children', Icons.child_care),
                ('finance', Icons.money),
                ('more', Icons.more_horiz),
              ],
              selected: 'finance',
              onSelected: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(translate('ru', 'finance')).hitTestable(), findsOneWidget);
  });

  testWidgets('empty report arrays use scoped feedback without raw JSON', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(
        testSession(['report:read']),
        Scaffold(
          body: WorkflowOutput(
            value: const [],
            operation: operation('ReportsController_attendanceDaily'),
            contextValues: const {},
          ),
        ),
      ),
    );
    expect(find.text('[]'), findsNothing);
    expect(find.text(translate('uz', 'reportNoRows')), findsOneWidget);
  });

  testWidgets(
    'publication review does not fetch a draft without management permission',
    (tester) async {
      var calls = 0;
      final session = testSession(
        ['landing:publish'],
        api: testApi((r) {
          calls++;
          return reply({});
        }),
      );
      await tester.pumpWidget(
        app(
          session,
          PublishReviewPage(operation: operation('LandingController_publish')),
        ),
      );
      await tester.pumpAndSettle();
      expect(calls, 0);
      expect(
        find.text(translate('uz', 'publicationReadRequired')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'calendar dates omit timezone clock while event timestamps retain it',
    (tester) async {
      final session = testSession([])..language = 'ru';
      await tester.pumpWidget(
        app(
          session,
          Builder(
            builder: (context) => Column(
              children: [
                Text(
                  displayValue(
                    context,
                    'birthDate',
                    '2024-08-28T00:00:00.000Z',
                  ),
                ),
                Text(displayValue(context, 'paidAt', '2026-10-25T06:00:00Z')),
              ],
            ),
          ),
        ),
      );
      expect(find.text('28.08.2024'), findsOneWidget);
      expect(find.text('25.10.2026 · 11:00'), findsOneWidget);
    },
  );

  testWidgets(
    'empty scoped roster never reports that all arrivals are complete',
    (tester) async {
      await tester.pumpWidget(
        app(
          testSession(['attendance:read']),
          const Scaffold(body: AttendancePage()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('${translate('uz', 'arrivalQueue')} · 0'));
      await tester.pumpAndSettle();
      expect(
        find.text(translate('uz', 'attendanceNoScopedChildren')),
        findsOneWidget,
      );
      expect(find.text(translate('uz', 'arrivalsComplete')), findsNothing);
    },
  );

  testWidgets(
    'linked contacts appear directly and never fetch without child scope',
    (tester) async {
      final requests = <String>[];
      final api = testApi((r) {
        requests.add(r.path);
        expect(r.method, 'GET');
        return reply([
          {
            'guardian': {
              'id': 'g1',
              'fullName': 'Parent One',
              'phone': '+998901234567',
            },
            'relationship': 'mother',
          },
        ]);
      });
      await tester.pumpWidget(
        app(
          testSession(['child:read'], api: api),
          const Scaffold(body: ChildContacts(childId: 'child-a')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Parent One'), findsOneWidget);
      expect(find.text('+998901234567'), findsOneWidget);
      expect(find.text(translate('uz', 'mother')), findsOneWidget);
      expect(requests, ['/children/child-a/guardians']);
      await tester.pumpWidget(const SizedBox());
      requests.clear();
      await tester.pumpWidget(
        app(
          testSession([], api: api),
          const Scaffold(body: ChildContacts(childId: 'child-b')),
        ),
      );
      await tester.pumpAndSettle();
      expect(requests, isEmpty);
    },
  );

  testWidgets('200 percent Russian navigation retains every label and action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = testSession([])..language = 'ru';
    var selected = 'today';
    await tester.pumpWidget(
      app(
        session,
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            bottomNavigationBar: LargeTextNavigation(
              tabs: const [
                ('today', Icons.today),
                ('attendance', Icons.check),
                ('children', Icons.child_care),
                ('finance', Icons.money),
                ('more', Icons.more_horiz),
              ],
              selected: selected,
              onSelected: (value) => selected = value,
            ),
          ),
        ),
      ),
    );
    for (final key in [
      'today',
      'attendanceNav',
      'children',
      'finance',
      'more',
    ]) {
      expect(find.text(translate('ru', key)), findsOneWidget);
      await tester.ensureVisible(find.text(translate('ru', key)));
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('ru', key)));
    }
    expect(
      tester.getSize(find.byType(LargeTextNavigation)).height,
      lessThan(160),
    );
    expect(selected, 'more');
    expect(tester.takeException(), isNull);
  });

  testWidgets('validation reveals and focuses an offscreen first error', (
    tester,
  ) async {
    final form = GlobalKey<FormState>();
    final focus = FocusNode();
    addTearDown(focus.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Form(
            key: form,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  const SizedBox(height: 850),
                  TextFormField(focusNode: focus, validator: (_) => 'Required'),
                  const SizedBox(height: 400),
                ],
              ),
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
    expect(focus.hasFocus, isTrue);
    expect(find.text('Required').hitTestable(), findsOneWidget);
  });

  testWidgets('reports default to on-screen data and expose separate exports', (
    tester,
  ) async {
    final formats = <dynamic>[];
    final session = testSession(
      ['report:read'],
      api: testApi((r) {
        formats.add(r.queryParameters['format']);
        return reply({'rows': [], 'columns': []});
      }),
    );
    final op = operation('ReportsController_childrenActive');
    // Use the exact generated permission rather than assuming a role.
    session.profile!['permissions'] = {
      for (final p in (op.contract['permissions'] as List).cast<String>())
        p: 'all',
    };
    await tester.pumpWidget(
      app(session, FeatureOperationPage(operation: op, guided: true)),
    );
    await tester.pumpAndSettle();
    expect(formats, ['json']);
    expect(find.text('JSON'), findsNothing);
    expect(find.text(translate('uz', 'reportOnScreenHelp')), findsOneWidget);
    expect(find.text('${translate('uz', 'exportReport')} PDF'), findsOneWidget);
  });

  testWidgets('publishing reviews current draft without sending a write', (
    tester,
  ) async {
    final requests = <String>[];
    final session = testSession(
      [
        ...(operation('LandingController_get').contract['permissions'] as List)
            .cast<String>(),
        ...(operation('LandingController_publish').contract['permissions']
                as List)
            .cast<String>(),
      ],
      api: testApi((r) {
        requests.add('${r.method} ${r.path}');
        return reply({
          'version': 4,
          'hasUnpublishedChanges': false,
          'blocks': [],
        });
      }),
    );
    await tester.pumpWidget(
      app(
        session,
        PublishReviewPage(operation: operation('LandingController_publish')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(translate('uz', 'noDraftChanges')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(requests, ['GET /landing']);
  });

  testWidgets(
    'imports open in order and commit is not a context-free shortcut',
    (tester) async {
      final session = testSession([
        'import:read',
        'import:create',
        'import:commit',
        'import:validate',
      ]);
      session.profile!['permissions'] = {
        for (final op in catalog.operations.where((o) => o.group == 'imports'))
          for (final p in (op.contract['permissions'] as List).cast<String>())
            p: 'all',
      };
      await tester.pumpWidget(
        app(
          session,
          Scaffold(
            body: SingleChildScrollView(
              child: WorkflowSteps(
                group: 'imports',
                catalog: catalog,
                onChanged: () {},
              ),
            ),
          ),
        ),
      );
      expect(
        find.text('1. ${translate('uz', 'importTemplateStep')}'),
        findsOneWidget,
      );
      expect(
        find.text('2. ${translate('uz', 'importValidateStep')}'),
        findsOneWidget,
      );
      expect(
        find.text(translate('uz', 'ImportsController_commit')),
        findsNothing,
      );
    },
  );

  testWidgets('completed import cannot be committed from a stale selection', (
    tester,
  ) async {
    final requests = <String>[];
    final op = operation('ImportsController_commit');
    final session = testSession(
      (op.contract['permissions'] as List).cast<String>(),
      api: testApi((r) {
        requests.add('${r.method} ${r.path}');
        return reply({'id': 'job-a', 'status': 'completed'});
      }),
    );
    await tester.pumpWidget(
      app(
        session,
        WorkflowTaskPage(
          operation: op,
          catalog: catalog,
          contextValues: const {'importJobId': 'job-a'},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(translate('uz', 'importNotValidated')), findsOneWidget);
    expect(requests, ['GET /imports/job-a']);
    expect(find.byType(FeatureOperationPage), findsNothing);
  });
}

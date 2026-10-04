import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/core/workflows.dart';
import 'package:alishax_mobile/core/workflow_metadata.dart';
import 'package:alishax_mobile/ui/features.dart';
import 'package:alishax_mobile/ui/workflows.dart';
import 'package:alishax_mobile/ui/workflow_task.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'package:alishax_mobile/ui/permission_selection.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'package:alishax_mobile/ui/reference_field.dart';
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
  child: MaterialApp(theme: mobileTheme(), home: child),
);

void main() {
  test(
    'every section has a workflow, translated guidance, and a valid primary collection',
    () {
      final data = contract();
      expect(
        data.operations.map((o) => o.group).toSet(),
        workflowSpecs.keys.toSet(),
      );
      for (final spec in workflowSpecs.entries) {
        expect(
          labels.containsKey('workflowHint_${spec.key}'),
          isTrue,
          reason: spec.key,
        );
        if (spec.value.listing != null) {
          expect(
            data.operations.any((o) => o.id == spec.value.listing),
            isTrue,
            reason: spec.key,
          );
        }
      }
    },
  );
  test(
    'nested records preserve parent context and only offer relevant actions',
    () {
      final data = contract();
      final session = testSession([
        'child:read',
        'child:update',
        'guardian:manage',
        'guardian:read',
        'payment:read',
      ]);
      final values = workflowContext(
        'docId',
        {'id': 'document-a'},
        inherited: {'childId': 'child-a'},
      );
      final update = data.operations.firstWhere(
        (o) => o.id == 'ChildrenController_updateDocument',
      );
      final bound = bindWorkflowOperation(update, values);
      expect(
        update.resolvePath(bound),
        '/children/child-a/documents/document-a',
      );
      expect(
        workflowRecordActions(
          data,
          session,
          'children',
          'docId',
        ).map((o) => o.id),
        contains('ChildrenController_updateDocument'),
      );
      expect(
        workflowRecordActions(
          data,
          session,
          'children',
          'docId',
        ).any((o) => o.id == 'ChildrenController_remove'),
        isFalse,
      );
      expect(
        workflowRecordActions(
          data,
          session,
          'guardians',
          'guardianId',
          context: {'childId': 'child-a'},
        ).any((o) => o.id == 'ChildGuardianLinksController_unlink'),
        isTrue,
      );
      final payment = data.operations.firstWhere(
        (o) => o.id == 'PaymentsController_get',
      );
      expect(bindWorkflowOperation(payment, values)['id'], '');
    },
  );
  testWidgets('every section renders at phone size in both languages', (
    tester,
  ) async {
    final data = contract();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = testSession(
      data.operations
          .expand((o) => (o.contract['permissions'] as List).cast<String>())
          .toSet()
          .toList(),
      api: testApi(
        (_) => reply({
          'data': [],
          'meta': {'total': 0},
        }),
      ),
    );
    for (final language in ['uz', 'ru']) {
      session.language = language;
      for (final group in workflowSpecs.keys) {
        await tester.pumpWidget(
          screen(
            session,
            WorkflowSection(
              key: ValueKey('$language:$group'),
              group: group,
              catalog: data,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$language:$group');
        expect(find.text('workflowHint_$group'), findsNothing);
      }
    }
  });
  testWidgets(
    'staff sections load records and editing fetches current values',
    (tester) async {
      final paths = <String>[];
      final session = testSession(
        ['user:manage'],
        api: testApi((r) {
          paths.add(r.path);
          return reply(
            r.path == '/users'
                ? [
                    {'id': 'user-a', 'fullName': 'Old list name'},
                  ]
                : {
                    'id': 'user-a',
                    'fullName': 'Current server name',
                    'phone': '+998900000000',
                    'status': 'active',
                  },
          );
        }),
      );
      final data = contract();
      await tester.pumpWidget(
        screen(session, WorkflowSection(group: 'users', catalog: data)),
      );
      await tester.pumpAndSettle();
      expect(paths, ['/users']);
      await tester.tap(
        find.widgetWithText(WorkflowRecordCard, 'Old list name'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Current server name'), findsWidgets);
      await tester.tap(
        find.widgetWithText(
          FilledButton,
          translate('uz', 'UsersController_update'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FeatureOperationPage), findsOneWidget);
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).first)
            .controller!
            .text,
        'Current server name',
      );
      expect(paths.where((p) => p == '/users/user-a').length, 2);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'a selected payment opens its receipt without asking for IDs or another load',
    (tester) async {
      String? requested;
      final session = testSession(
        ['payment:read'],
        api: testApi((r) {
          requested = r.path;
          return reply({'id': 'p', 'receiptNo': 'RC-001'});
        }),
      );
      final data = contract();
      await tester.pumpWidget(
        screen(
          session,
          WorkflowTaskPage(
            operation: data.operations.firstWhere(
              (o) => o.id == 'PaymentsController_get',
            ),
            catalog: data,
            contextValues: {'paymentId': 'payment-a'},
            record: {'id': 'payment-a', 'receiptNo': 'RC-001'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(requested, '/payments/payment-a');
      expect(find.byType(TextFormField), findsNothing);
      expect(find.text('payment-a'), findsNothing);
    },
  );
  testWidgets(
    'website content and permission sets use structured readable controls',
    (tester) async {
      final data = contract();
      final session = testSession(['landing:manage', 'role:manage']);
      final create = data.operations.firstWhere(
        (o) => o.id == 'LandingController_createBlock',
      );
      final schema = workflowBodySchema(create, {'type': 'hero'}, session);
      expect(
        object(object(schema['properties'])['content'])['additionalProperties'],
        false,
      );
      await tester.pumpWidget(
        screen(
          session,
          Scaffold(
            body: SingleChildScrollView(
              child: SchemaObjectForm(
                schema: schema,
                value: {'type': 'hero', 'content': {}},
                onChanged: (_) {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(translate('uz', 'addField')), findsNothing);
      expect(find.text('title'), findsNothing);
      expect(object(workflowMetadata['permissions']).length, greaterThan(50));
      await tester.pumpWidget(
        screen(
          session,
          Scaffold(
            body: SchemaValueForm(
              name: 'permissions',
              schema: {
                'type': 'array',
                'items': {'type': 'object'},
              },
              value: [],
              onChanged: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PermissionSelection), findsOneWidget);
      await tester.tap(find.text(translate('uz', 'choosePermissions')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        translate('uz', 'child:read'),
      );
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(CheckboxListTile, translate('uz', 'child:read')),
        findsOneWidget,
      );
    },
  );
  testWidgets('read-only permission sets never reveal write controls', (
    tester,
  ) async {
    final data = contract();
    final session = testSession([
      'payment:read',
    ], api: testApi((_) => reply({'id': 'p', 'receiptNo': 'RC-001'})));
    await tester.pumpWidget(
      screen(
        session,
        WorkflowRecordPage(
          group: 'payments',
          kind: 'paymentId',
          record: {'id': 'p', 'receiptNo': 'RC-001'},
          catalog: data,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text(translate('uz', 'PaymentsController_cancel')),
      findsNothing,
    );
    expect(
      find.text(translate('uz', 'PaymentsController_create')),
      findsNothing,
    );
    expect(find.byType(FilledButton), findsNothing);
  });

  test('every website content field has a human label', () {
    void walk(Json schema) {
      for (final entry in object(schema['properties']).entries) {
        expect(labels.containsKey(entry.key), isTrue, reason: entry.key);
        walk(object(entry.value));
      }
      if (schema['items'] is Map) walk(object(schema['items']));
    }

    for (final block in object(workflowMetadata['blocks']).values) {
      walk(object(block));
    }
  });
  testWidgets('all guided tasks render on a phone without triggering writes', (
    tester,
  ) async {
    final data = contract();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var writes = 0;
    final session = testSession(
      data.operations
          .expand((o) => (o.contract['permissions'] as List).cast<String>())
          .toSet()
          .toList(),
      api: testApi((r) {
        if (r.method != 'GET') writes++;
        return reply({
          'data': [],
          'meta': {'total': 0},
          'rules': {},
        });
      }),
    )..language = 'ru';
    for (final op in data.operations) {
      await tester.pumpWidget(
        screen(
          session,
          WorkflowTaskPage(key: ValueKey(op.id), operation: op, catalog: data),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: op.id);
    }
    expect(writes, 0);
  });
  testWidgets(
    'replacing user roles starts with existing role and branch assignments',
    (tester) async {
      final data = contract();
      final session = testSession(
        ['user:manage'],
        api: testApi(
          (r) => reply([
            {
              'roleId': 'role-a',
              'branchId': 'branch-a',
              'role': {'id': 'role-a', 'nameUz': 'Tarbiyachi'},
            },
          ]),
        ),
      );
      await tester.pumpWidget(
        screen(
          session,
          WorkflowTaskPage(
            operation: data.operations.firstWhere(
              (o) => o.id == 'UsersController_replaceRoles',
            ),
            catalog: data,
            contextValues: {'userId': 'user-a'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final form = tester.widget<SchemaObjectForm>(
        find.byKey(const ValueKey('body')),
      );
      expect(form.value['roles'], [
        {'roleId': 'role-a', 'branchId': 'branch-a'},
      ]);
    },
  );

  testWidgets(
    'notification recipients choose either a parent or a staff member by name',
    (tester) async {
      dynamic selected = [<String, dynamic>{}];
      final session = testSession(
        ['guardian:read', 'user:manage'],
        api: testApi(
          (r) => reply(
            r.path == '/guardians'
                ? {
                    'data': [
                      {'id': 'guardian-a', 'fullName': 'Parent Aliyeva'},
                    ],
                    'meta': {'total': 1},
                  }
                : [
                    {'id': 'user-a', 'fullName': 'Teacher Karimova'},
                  ],
          ),
        ),
      );
      final op = contract().operations.firstWhere(
        (o) => o.id == 'NotificationsController_send',
      );
      await tester.pumpWidget(
        screen(
          session,
          StatefulBuilder(
            builder: (context, update) => Scaffold(
              body: SingleChildScrollView(
                child: SchemaValueForm(
                  name: 'recipients',
                  schema: object(object(op.body['properties'])['recipients']),
                  value: selected,
                  onChanged: (v) => update(() => selected = v),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(ReferenceField));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Parent Aliyeva'));
      await tester.pumpAndSettle();
      expect(selected, [
        {'guardianId': 'guardian-a'},
      ]);
      await tester.tap(find.text(translate('uz', 'staff')));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(ReferenceField));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Teacher Karimova'));
      await tester.pumpAndSettle();
      expect(selected, [
        {'userId': 'user-a'},
      ]);
    },
  );

  testWidgets(
    'website ordering loads every block and keeps IDs paired with their new positions',
    (tester) async {
      final data = contract();
      final session = testSession(
        ['landing:manage'],
        api: testApi(
          (r) => reply({
            'blocks': [
              {'id': 'a', 'type': 'hero', 'position': 0},
              {'id': 'b', 'type': 'contacts', 'position': 1},
            ],
          }),
        ),
      );
      await tester.pumpWidget(
        screen(
          session,
          WorkflowTaskPage(
            operation: data.operations.firstWhere(
              (o) => o.id == 'LandingController_reorder',
            ),
            catalog: data,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(translate('uz', 'hero')), findsOneWidget);
      await tester.tap(find.byTooltip(translate('uz', 'moveDown')).first);
      await tester.pumpAndSettle();
      final form = tester.widget<SchemaObjectForm>(
        find.byKey(const ValueKey('body')),
      );
      expect(form.value['blocks'], [
        {'id': 'b', 'position': 0},
        {'id': 'a', 'position': 1},
      ]);
    },
  );
  testWidgets(
    'changing a selected child clears a document from the previous child',
    (tester) async {
      final data = contract();
      final session = testSession(
        ['child:read', 'child:update'],
        api: testApi(
          (r) => reply(
            r.path == '/lookups/children'
                ? {
                    'data': [
                      {
                        'id': 'child-b',
                        'firstName': 'Malika',
                        'lastName': 'Usmonova',
                      },
                    ],
                    'meta': {'total': 1},
                  }
                : [
                    {'id': 'doc-a', 'type': 'birth_certificate'},
                  ],
          ),
        ),
      );
      await tester.pumpWidget(
        screen(
          session,
          WorkflowTaskPage(
            operation: data.operations.firstWhere(
              (o) => o.id == 'ChildrenController_updateDocument',
            ),
            catalog: data,
            contextValues: {'childId': 'child-a'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(ReferenceField).last);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(ListTile).first);
      await tester.pumpAndSettle();
      expect(
        tester.widget<ReferenceField>(find.byType(ReferenceField).last).value,
        'doc-a',
      );
      await tester.tap(find.byType(ReferenceField).first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Usmonova Malika'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<ReferenceField>(find.byType(ReferenceField).last).value,
        isNull,
      );
    },
  );
}

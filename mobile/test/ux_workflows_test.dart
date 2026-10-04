import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/strings.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/ui/features.dart';
import 'package:alishax_mobile/ui/groups.dart';
import 'package:alishax_mobile/ui/workflows.dart';
import 'package:alishax_mobile/ui/schema_form.dart';
import 'package:alishax_mobile/ui/reference_field.dart';
import 'package:alishax_mobile/ui/reference_picker.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'helpers.dart';

FeatureCatalog catalog() => FeatureCatalog(
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
const group = {
  'id': 'group-a',
  'name': 'Sunshine',
  'capacity': 20,
  'currentCount': 5,
};

void main() {
  testWidgets(
    'Back follows action, module, feature directory, then home and preserves search',
    (tester) async {
      final session = testSession(
        ['child:read'],
        api: testApi(
          (r) => reply(
            r.path == '/children'
                ? {
                    'data': [
                      {
                        'id': 'child-a',
                        'firstName': 'Ali',
                        'lastName': 'Karimov',
                      },
                    ],
                    'meta': {'total': 1},
                  }
                : {'id': 'child-a', 'firstName': 'Ali', 'lastName': 'Karimov'},
          ),
        ),
      );
      final data = catalog();
      await tester.pumpWidget(
        screen(
          session,
          Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => FeatureWorkspace(catalog: data),
                  ),
                ),
                child: const Text('Main screen'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Main screen'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('uz', 'children')));
      await tester.pumpAndSettle();
      const title = 'Ali';
      await tester.enterText(find.byType(TextField), title);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(WorkflowRecordCard, 'Karimov Ali'));
      await tester.pumpAndSettle();
      expect(find.byType(WorkflowRecordPage), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(WorkflowRecordPage), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller?.text ??
            tester
                .widget<EditableText>(find.byType(EditableText))
                .controller
                .text,
        title,
      );
      expect(find.text('Main screen'), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text(translate('uz', 'allFeatures')), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Main screen'), findsOneWidget);
    },
  );

  testWidgets(
    'equivalent profile refresh keeps navigation but revoked access closes private routes',
    (tester) async {
      late Json response;
      final session = testSession([
        'child:read',
        'group:read',
      ], api: testApi((_) => reply(response)));
      session.profile!['branchIds'] = ['b', 'a'];
      session.profile!['ownGroupIds'] = ['g2', 'g1'];
      response = {
        ...session.profile!,
        'permissionsVersion': 99,
        'permissions': {'group:read': 'all', 'child:read': 'all'},
        'branchIds': ['a', 'b'],
        'ownGroupIds': ['g1', 'g2'],
      };
      await tester.pumpWidget(AlishaxApp(session: session));
      await tester.pumpAndSettle();
      tester
          .state<NavigatorState>(find.byType(Navigator))
          .push(
            MaterialPageRoute(
              builder: (_) => const Scaffold(body: Text('Private detail')),
            ),
          );
      await tester.pumpAndSettle();
      await tester.runAsync(session.reload);
      await tester.pumpAndSettle();
      expect(find.text('Private detail'), findsOneWidget);
      response = {
        ...response,
        'permissions': {'group:read': 'all'},
      };
      await tester.runAsync(session.reload);
      await tester.pumpAndSettle();
      expect(find.text('Private detail'), findsNothing);
    },
  );

  testWidgets(
    'record actions select a child by name and submit the hidden identifier',
    (tester) async {
      const childId = '11111111-1111-4111-8111-111111111111';
      String? requested;
      String? query;
      final session = testSession(
        ['child:read'],
        api: testApi((r) {
          if (r.path == '/lookups/children') {
            query = r.queryParameters['q'] as String?;
            return reply({
              'data': [
                {'id': childId, 'firstName': 'Ali', 'lastName': 'Karimov'},
              ],
              'meta': {'total': 1},
            });
          }
          requested = r.path;
          return reply({
            'id': childId,
            'firstName': 'Ali',
            'lastName': 'Karimov',
          });
        }),
      );
      await tester.pumpWidget(
        screen(
          session,
          FeatureOperationPage(
            operation: catalog().operations.firstWhere(
              (o) => o.id == 'ChildrenController_get',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(TextFormField), findsNothing);
      await tester.tap(find.byType(ReferenceField));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Ali');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(query, 'Ali');
      await tester.tap(find.text('Karimov Ali'));
      await tester.pumpAndSettle();
      expect(find.text('Karimov Ali'), findsOneWidget);
      expect(find.text(childId), findsNothing);
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'load')),
      );
      await tester.pumpAndSettle();
      expect(requested, '/children/$childId');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'staff name search covers the complete list without unsupported API filters',
    (tester) async {
      var calls = 0;
      final session = testSession(
        ['user:manage'],
        api: testApi((r) {
          calls++;
          return reply([
            for (var i = 0; i < 80; i++)
              {'id': 'user-$i', 'fullName': 'Staff $i'},
          ]);
        }),
      );
      await tester.pumpWidget(
        screen(session, const ReferencePicker(path: '/users')),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Staff 79');
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ListTile, 'Staff 79'), findsOneWidget);
      expect(find.text('Staff 0'), findsNothing);
      expect(calls, 1);
      expect(find.text(translate('uz', 'loadMore')), findsNothing);
    },
  );

  testWidgets(
    'group staff loads existing names and saves only the changed position',
    (tester) async {
      Json staff = {
        'mainTeacher': {'id': 'old-user', 'fullName': 'Old Teacher'},
        'assistant': {'id': 'assistant-user', 'fullName': 'Existing Assistant'},
        'nurse': null,
      };
      Json? sent;
      final session = testSession(
        ['group:read', 'group:manage', 'user:manage'],
        api: testApi((r) {
          if (r.path == '/users') {
            return reply([
              {'id': 'new-user', 'fullName': 'New Teacher'},
            ]);
          }
          if (r.method == 'PUT') {
            sent = object(r.data);
            staff = {
              ...staff,
              'mainTeacher': {'id': 'new-user', 'fullName': 'New Teacher'},
            };
          }
          return reply(staff);
        }),
      );
      await tester.pumpWidget(
        screen(session, const GroupStaffPage(group: group)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Old Teacher'), findsOneWidget);
      expect(find.text('Existing Assistant'), findsOneWidget);
      await tester.tap(find.byType(ReferenceField).first);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'New Teacher');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'New Teacher'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'saveGroupStaff')),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Sunshine'), findsWidgets);
      await tester.tap(find.text(translate('uz', 'confirm')));
      await tester.pumpAndSettle();
      expect(sent, {'mainTeacherId': 'new-user'});
      expect(find.text('Existing Assistant'), findsOneWidget);
      expect(find.text('New Teacher'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('late lookup responses cannot replace newer search results', (
    tester,
  ) async {
    final first = Completer<dynamic>(), second = Completer<dynamic>();
    final session = testSession(
      ['child:read'],
      api: testApi((r) async {
        if (r.queryParameters['q'] == 'Ali') return await first.future;
        if (r.queryParameters['q'] == 'Malika') return await second.future;
        return reply({
          'data': [],
          'meta': {'total': 0},
        });
      }),
    );
    await tester.pumpWidget(
      screen(
        session,
        const ReferencePicker(
          path: '/lookups/children',
          query: {'permission': 'child:read'},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Ali');
    await tester.pump(const Duration(milliseconds: 350));
    await tester.enterText(find.byType(TextField), 'Malika');
    await tester.pump(const Duration(milliseconds: 350));
    second.complete(
      reply({
        'data': [
          {'id': 'm', 'firstName': 'Malika', 'lastName': 'Usmonova'},
        ],
        'meta': {'total': 1},
      }),
    );
    await tester.pumpAndSettle();
    first.complete(
      reply({
        'data': [
          {'id': 'a', 'firstName': 'Ali', 'lastName': 'Karimov'},
        ],
        'meta': {'total': 1},
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('Usmonova Malika'), findsOneWidget);
    expect(find.text('Karimov Ali'), findsNothing);
  });

  testWidgets(
    'child assignment reviews readable names and sends the selected date',
    (tester) async {
      Json? sent;
      final session = testSession(
        ['group:read', 'group:manage', 'child:read'],
        api: testApi((r) {
          if (r.path == '/lookups/children') {
            return reply({
              'data': [
                {'id': 'child-a', 'firstName': 'Ali', 'lastName': 'Karimov'},
              ],
              'meta': {'total': 1},
            });
          }
          if (r.method == 'POST') sent = object(r.data);
          return reply(
            sent == null
                ? []
                : [
                    {
                      'id': 'child-a',
                      'firstName': 'Ali',
                      'lastName': 'Karimov',
                    },
                  ],
          );
        }),
      );
      await tester.pumpWidget(
        screen(session, const GroupChildrenPage(group: group)),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'assignToGroup')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Karimov Ali'));
      await tester.pumpAndSettle();
      expect(find.byType(DatePickerDialog), findsOneWidget);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Karimov Ali → Sunshine'), findsOneWidget);
      expect(sent, isNull);
      await tester.tap(find.text(translate('uz', 'confirm')));
      await tester.pumpAndSettle();
      expect(sent, {'childId': 'child-a', 'effectiveDate': today()});
      expect(find.text('Karimov Ali'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'removing staff sends explicit null and preserves other assignments',
    (tester) async {
      Json? sent;
      final session = testSession(
        ['group:read', 'group:manage'],
        api: testApi((r) {
          if (r.method == 'PUT') sent = object(r.data);
          return reply({
            'mainTeacher': sent == null
                ? {'id': 'teacher-a', 'fullName': 'Current Teacher'}
                : null,
            'assistant': {'id': 'assistant-a', 'fullName': 'Current Assistant'},
            'nurse': null,
          });
        }),
      );
      await tester.pumpWidget(
        screen(session, const GroupStaffPage(group: group)),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byTooltip(translate('uz', 'removeAssignment')).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'saveGroupStaff')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text(translate('uz', 'confirm')));
      await tester.pumpAndSettle();
      expect(sent, {'mainTeacherId': null});
      expect(find.text('Current Assistant'), findsOneWidget);
      expect(find.text('Current Teacher'), findsNothing);
    },
  );

  testWidgets('branch array entries use names instead of identifier input', (
    tester,
  ) async {
    dynamic selected = [''];
    final session = testSession([]);
    session.profile!['branches'] = [
      {'id': 'branch-a', 'name': 'Central branch'},
    ];
    await tester.pumpWidget(
      screen(
        session,
        StatefulBuilder(
          builder: (context, update) => Scaffold(
            body: SchemaValueForm(
              name: 'branchIds',
              schema: {
                'type': 'array',
                'items': {'type': 'string', 'format': 'uuid'},
              },
              value: selected,
              onChanged: (v) => update(() => selected = v),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    await tester.tap(find.byType(ReferenceField));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Central branch'));
    await tester.pumpAndSettle();
    expect(selected, ['branch-a']);
    expect(find.text('Central branch'), findsOneWidget);
  });

  test(
    'group roster records never populate group selection with child IDs',
    () {
      final session = testSession(['group:read']);
      final op = catalog().operations.firstWhere(
        (o) => o.path == '/groups/{id}/children' && o.method == 'GET',
      );
      rememberResults(session, op, [
        {'id': 'child-a', 'firstName': 'Ali'},
      ]);
      expect(session.references['childId']?['child-a']?['firstName'], 'Ali');
      expect(session.references['groupId'], isNull);
    },
  );

  testWidgets(
    'attachment chooser uploads multipart bytes and retains the readable filename',
    (tester) async {
      final fixture = File('build${Platform.pathSeparator}ux-upload.pdf')
        ..writeAsBytesSync([37, 80, 68, 70]);
      const channel = MethodChannel('plugins.flutter.io/file_selector');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (call) async => [fixture.absolute.path],
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      FormData? body;
      dynamic selected;
      final session = testSession(
        ['file:manage'],
        api: testApi((r) {
          expect(r.path, '/files');
          expect(r.method, 'POST');
          body = r.data as FormData;
          return reply({
            'fileId': 'file-a',
            'mime': 'application/pdf',
            'size': 4,
          });
        }),
      );
      await tester.pumpWidget(
        screen(
          session,
          StatefulBuilder(
            builder: (context, update) => Scaffold(
              body: ReferenceField(
                name: 'attachmentFileId',
                label: 'Attachment',
                value: selected,
                onChanged: (v) => update(() => selected = v),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byType(ReferenceField));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(FilledButton, translate('uz', 'chooseFile')),
      );
      for (var i = 0; i < 20 && selected == null; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 100));
      }
      await tester.pumpAndSettle();
      expect(body!.files.single.key, 'file');
      expect(body!.files.single.value.filename, 'ux-upload.pdf');
      expect(body!.files.single.value.length, 4);
      expect(selected, 'file-a');
      expect(find.text('ux-upload.pdf'), findsOneWidget);
      expect(find.text('file-a'), findsNothing);
    },
  );

  testWidgets('group screens fit narrow phones with larger Russian text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.4;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final session = testSession(
      ['group:read', 'group:manage', 'user:manage'],
      api: testApi(
        (r) => reply(
          r.path == '/groups'
              ? [group]
              : {
                  'mainTeacher': {'id': 't', 'fullName': 'Current Teacher'},
                  'assistant': null,
                  'nurse': null,
                },
        ),
      ),
    )..language = 'ru';
    await tester.pumpWidget(screen(session, const GroupsPage()));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(
      screen(session, const GroupStaffPage(group: group)),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}

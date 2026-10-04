// Optional visual QA: flutter test tool/preview_test.dart
// --dart-define=PREVIEW_FONT=/path/to/a/local/font.ttf
import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/core/session.dart';
import '../test/helpers.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/features.dart';
import 'package:alishax_mobile/ui/features.dart';
import 'package:alishax_mobile/ui/workflows.dart';
import 'package:alishax_mobile/ui/workflow_task.dart';
import 'package:alishax_mobile/ui/groups.dart';
import 'package:alishax_mobile/ui/reference_picker.dart';
import 'package:alishax_mobile/ui/theme.dart';
import 'package:alishax_mobile/ui/attendance.dart';

void main() {
  testWidgets('capture mobile screens using synthetic fixtures', (
    tester,
  ) async {
    const font = String.fromEnvironment('PREVIEW_FONT');
    await tester.runAsync(() async {
      final icons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await icons.load();
    });
    if (font.isNotEmpty) {
      await tester.runAsync(() async {
        final loader = FontLoader('Roboto')
          ..addFont(
            File(
              font,
            ).readAsBytes().then((bytes) => ByteData.sublistView(bytes)),
          );
        await loader.load();
      });
    }
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final boundary = GlobalKey();
    Future<void> capture(String name) async {
      await tester.runAsync(() async {
        final render =
            boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        final image = await render.toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('build/previews/$name.png');
        await file.parent.create(recursive: true);
        await file.writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }

    final login = Session(testApi((_) => reply({})))..loading = false;
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: AlishaxApp(session: login),
      ),
    );
    await tester.pumpAndSettle();
    await tester.runAsync(
      () => precacheImage(
        const AssetImage('assets/logo-mark.png'),
        boundary.currentContext!,
      ),
    );
    await tester.pumpAndSettle();
    await capture('login');
    final session = testSession(
      [
        'attendance:read',
        'attendance:checkin',
        'attendance:checkout',
        'pickup:read',
        'child:read',
        'payment:create',
        'payment:read',
      ],
      api: testApi(
        (_) => reply({
          'data': [
            {
              'child': {'id': '1', 'firstName': 'Ali', 'lastName': 'Karimov'},
              'attendance': null,
            },
            {
              'child': {
                'id': '2',
                'firstName': 'Malika',
                'lastName': 'Usmonova',
              },
              'attendance': {'checkInAt': '2026-09-17T06:00:00Z'},
            },
            {
              'child': {'id': '3', 'firstName': 'Diyor', 'lastName': 'Azimov'},
              'attendance': {'status': 'sick'},
            },
          ],
        }),
      ),
    );
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: AlishaxApp(session: session),
      ),
    );
    await tester.pumpAndSettle();
    await capture('today');
    await tester.tap(find.byType(NavigationDestination).at(1));
    await tester.pumpAndSettle();
    await capture('attendance');
    await session.setThemeMode(ThemeMode.dark);
    await tester.pumpAndSettle();
    await capture('attendance-dark');
    await session.setLanguage('ru');
    await tester.pumpAndSettle();
    await capture('attendance-dark-ru');
    await session.setThemeMode(ThemeMode.light);
    await tester.pumpAndSettle();
    final catalog = FeatureCatalog(
      records(
        object(
          jsonDecode(File('assets/api-contract.json').readAsStringSync()),
        )['operations'],
      ).map(FeatureOperation.new).toList(),
    );
    final all = testSession(
      catalog.operations
          .expand((o) => (o.contract['permissions'] as List).cast<String>())
          .toSet()
          .toList(),
    );
    all.profile!['roles'] = [
      {
        'id': 'role-director',
        'code': 'director',
        'nameUz': 'Direktor',
        'nameRu': 'Директор',
      },
      {
        'id': 'role-accountant',
        'code': 'accountant',
        'nameUz': 'Buxgalter',
        'nameRu': 'Бухгалтер',
      },
    ];
    for (final language in ['uz', 'ru']) {
      all.language = language;
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: AlishaxApp(session: all),
        ),
      );
      await tester.pumpAndSettle();
      await capture('today-$language');
      await tester.tap(find.byType(NavigationDestination).last);
      await tester.pumpAndSettle();
      await capture('more-$language');
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: AppScope(
            session: all,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: mobileTheme(),
              home: FeatureWorkspace(catalog: catalog),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await capture('features-$language');
      final op = catalog.operations.firstWhere(
        (o) => o.id == 'ExpensesController_create',
      );
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: AppScope(
            session: all,
            child: MaterialApp(
              theme: mobileTheme(),
              home: FeatureOperationPage(operation: op),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await capture('form-$language');
    }

    const previewGroup = {
      'id': 'group-a',
      'name': 'Quyosh guruhi',
      'capacity': 20,
      'currentCount': 12,
    };
    final staff = testSession(
      [
        'group:read',
        'group:manage',
        'user:manage',
        'child:read',
        'payment:read',
        'payment:create',
        'landing:manage',
      ],
      api: testApi((r) {
        if (r.path == '/payments') {
          return reply({
            'data': [
              {
                'id': 'payment-a',
                'child': {'firstName': 'Ali', 'lastName': 'Karimov'},
                'receiptNo': 'RC-001',
                'amountTiyin': '150000000',
                'paidAt': '2026-10-04T09:00:00Z',
                'method': 'cash',
              },
              {
                'id': 'payment-b',
                'child': {'firstName': 'Malika', 'lastName': 'Usmonova'},
                'receiptNo': 'RC-002',
                'amountTiyin': '120000000',
                'paidAt': '2026-10-04T10:00:00Z',
                'method': 'card',
              },
            ],
            'meta': {'total': 2},
          });
        }
        if (r.path == '/users/user-a') {
          return reply({
            'id': 'user-a',
            'fullName': 'Dilnoza Karimova',
            'phone': '+998 90 000 00 00',
            'status': 'active',
          });
        }
        if (r.path == '/groups') {
          return reply([
            previewGroup,
            {
              'id': 'group-b',
              'name': 'Yulduz guruhi',
              'capacity': 18,
              'currentCount': 9,
            },
          ]);
        }
        if (r.path.endsWith('/staff')) {
          return reply({
            'mainTeacher': {'id': 'user-a', 'fullName': 'Dilnoza Karimova'},
            'assistant': {'id': 'user-b', 'fullName': 'Nargiza Usmonova'},
            'nurse': null,
          });
        }
        return reply([
          {
            'id': 'user-a',
            'fullName': 'Dilnoza Karimova',
            'phone': '+998 90 000 00 00',
          },
          {
            'id': 'user-b',
            'fullName': 'Nargiza Usmonova',
            'phone': '+998 91 000 00 00',
          },
        ]);
      }),
    );
    for (final language in ['uz', 'ru']) {
      staff.language = language;
      for (final page in <String, Widget>{
        'staff-section': WorkflowSection(group: 'users', catalog: catalog),
        'payments-section': WorkflowSection(
          group: 'payments',
          catalog: catalog,
        ),
        'staff-detail': WorkflowRecordPage(
          group: 'users',
          kind: 'userId',
          record: {'id': 'user-a', 'fullName': 'Dilnoza Karimova'},
          catalog: catalog,
        ),
        'staff-edit': WorkflowTaskPage(
          operation: catalog.operations.firstWhere(
            (o) => o.id == 'UsersController_update',
          ),
          catalog: catalog,
          contextValues: {'userId': 'user-a'},
        ),
        'website-editor': WorkflowTaskPage(
          operation: catalog.operations.firstWhere(
            (o) => o.id == 'LandingController_createBlock',
          ),
          catalog: catalog,
          contextValues: {
            'type': 'hero',
            'content': {
              'title': {'uz': 'Alishax Kids', 'ru': 'Алишах Кидс'},
            },
          },
        ),
        'groups': const GroupsPage(),
        'group-staff': const GroupStaffPage(group: previewGroup),
        'people-picker': const ReferencePicker(path: '/users'),
      }.entries) {
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundary,
            child: AppScope(
              session: staff,
              child: MaterialApp(
                key: ValueKey('$language:${page.key}'),
                debugShowCheckedModeBanner: false,
                theme: mobileTheme(),
                home: page.value,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await capture('${page.key}-$language');
      }
    }
    final pickupSession = testSession(
      ['pickup:read', 'attendance:checkout'],
      api: testApi(
        (r) => reply(
          r.path.endsWith('/pickup-guardians')
              ? [
                  {
                    'id': 'parent-1',
                    'fullName': 'Dilnoza Karimova',
                    'phone': '+998 90 123 45 67',
                    'relationship': 'mother',
                  },
                  {
                    'id': 'parent-2',
                    'fullName': 'Akmal Karimov',
                    'phone': '+998 91 123 45 67',
                    'relationship': 'father',
                  },
                ]
              : [],
        ),
      ),
    );
    for (final language in ['uz', 'ru']) {
      pickupSession.language = language;
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: AppScope(
            session: pickupSession,
            child: MaterialApp(
              key: ValueKey('pickup-$language'),
              debugShowCheckedModeBanner: false,
              theme: mobileTheme(
                brightness: language == 'ru'
                    ? Brightness.dark
                    : Brightness.light,
              ),
              home: const PickupPage(
                child: {
                  'id': 'child-1',
                  'firstName': 'Ali',
                  'lastName': 'Karimov',
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await capture('pickup-parents-$language');
    }

    expect(tester.takeException(), isNull);
  });
}

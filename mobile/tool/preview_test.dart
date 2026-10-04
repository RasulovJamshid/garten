// Optional visual QA: flutter test tool/preview_test.dart
// --dart-define=PREVIEW_FONT=/path/to/a/local/font.ttf
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/main.dart';
import 'package:alishax_mobile/core/session.dart';
import '../test/helpers.dart';

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
    expect(tester.takeException(), isNull);
  });
}

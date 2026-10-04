import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/api.dart';
import 'core/session.dart';
import 'ui/common.dart';
import 'ui/login.dart';
import 'ui/shell.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.alishaxkids.uz/api/v1',
  );
  final session = Session(
    ApiClient(baseUrl: baseUrl, secrets: DeviceSecrets()),
  );
  runApp(AlishaxApp(session: session));
  session.start();
}

class AlishaxApp extends StatelessWidget {
  const AlishaxApp({super.key, required this.session});
  final Session session;
  @override
  Widget build(BuildContext context) => AppScope(
    session: session,
    child: ListenableBuilder(
      listenable: session,
      builder: (context, _) => MaterialApp(
        title: 'Alishax Kids',
        debugShowCheckedModeBanner: false,
        locale: Locale(session.language),
        supportedLocales: const [Locale('uz'), Locale('ru')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        theme: mobileTheme(),
        darkTheme: mobileTheme(brightness: Brightness.dark),
        themeMode: session.themeMode,
        home: session.loading
            ? const Scaffold(
                body: Center(child: CircularProgressIndicator.adaptive()),
              )
            : session.startupError != null
            ? Scaffold(body: FailureView(session.startupError!, session.start))
            : session.profile == null
            ? const LoginPage()
            : const AppShell(),
        // Replacing the Navigator removes private routes on logout/session expiry.
        key: ValueKey(session.accessKey),
      ),
    ),
  );
}

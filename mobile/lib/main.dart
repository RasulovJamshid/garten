import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/api.dart';
import 'core/session.dart';
import 'ui/common.dart';
import 'ui/login.dart';
import 'ui/shell.dart';

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
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: navy,
            primary: navy,
            secondary: amber,
            surface: Colors.white,
          ),
          scaffoldBackgroundColor: const Color(0xFFF7F7FB),
          appBarTheme: const AppBarTheme(
            backgroundColor: Color(0xFFF7F7FB),
            foregroundColor: navy,
            centerTitle: false,
            elevation: 0,
          ),
          cardTheme: CardThemeData(
            elevation: 0,
            margin: const EdgeInsets.only(bottom: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
          ),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFFE1E0EA)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFFE1E0EA)),
            ),
          ),
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
              minimumSize: const Size(48, 52),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          outlinedButtonTheme: OutlinedButtonThemeData(
            style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
          ),
          navigationBarTheme: const NavigationBarThemeData(
            backgroundColor: Colors.white,
            indicatorColor: Color(0xFFFFE8A3),
          ),
        ),
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

import 'dart:convert';
import 'package:flutter/material.dart';
import 'api.dart';

class Session extends ChangeNotifier {
  Session(this.api) {
    api.onExpired = () {
      profile = null;
      references.clear();
      PaintingBinding.instance.imageCache.clear();
      PaintingBinding.instance.imageCache.clearLiveImages();
      notifyListeners();
    };
  }
  final ApiClient api;
  Json? profile;
  String language = 'uz';
  ThemeMode themeMode = ThemeMode.system;
  bool loading = true;
  Object? startupError;
  bool _legacyProfile = false;
  final references = <String, Map<String, Json>>{};
  void rememberReference(String kind, Json row, {String valueKey = 'id'}) {
    final id = row[valueKey]?.toString();
    if (id != null && id.isNotEmpty) (references[kind] ??= {})[id] = row;
  }

  String get accessKey => profile == null
      ? 'signed-out'
      : jsonEncode([
          object(profile!['user'])['id'],
          object(profile!['organization'])['id'],
          {
            for (final key in (object(
              profile!['permissions'],
            ).keys.toList()..sort()))
              key: object(profile!['permissions'])[key],
          },
          ((profile!['branchIds'] as List?)
                    ?.map((v) => v.toString())
                    .toList() ??
                [])
            ..sort(),
          ((profile!['ownGroupIds'] as List?)
                    ?.map((v) => v.toString())
                    .toList() ??
                [])
            ..sort(),
        ]);
  bool can(String permission) =>
      object(profile?['permissions'])[permission] != null;
  String get name =>
      object(profile?['user'])['fullName']?.toString() ?? 'Alishax Kids';
  List<Json> get roles => records(profile?['roles']);
  List<Json> get groups => records(profile?['groups']);
  List<Json> get branches => records(profile?['branches']);

  Future<void> start() async {
    loading = true;
    startupError = null;
    notifyListeners();
    try {
      language = await api.secrets.read('language') ?? 'uz';
      final appearance = await api.secrets.read('themeMode');
      themeMode =
          ThemeMode.values
              .where((mode) => mode.name == appearance)
              .firstOrNull ??
          ThemeMode.system;
      if (await api.restore()) await reload();
    } catch (e) {
      startupError = e;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> login(String login, String password) async {
    await api.login(login, password);
    try {
      await reload();
    } catch (e) {
      // Authentication has already succeeded: do not blame the password for
      // an unavailable profile endpoint or a post-login server failure.
      throw ApiFailure(
        'PROFILE_LOAD_FAILED',
        e is ApiFailure ? e.status : null,
      );
    }
  }

  Future<void> reload() async {
    Json data;
    try {
      data = object(
        await api.request(_legacyProfile ? '/auth/me' : '/auth/bootstrap'),
      );
    } on ApiFailure catch (e) {
      // Only a missing route permits compatibility fallback. Never bypass a
      // denial, a network failure, or a server error using another endpoint.
      if (_legacyProfile || e.status != 404) rethrow;
      data = object(await api.request('/auth/me'));
      _legacyProfile = true;
    }
    if (data['user'] is! Map || data['permissions'] is! Map) {
      throw const ApiFailure('INVALID_AUTH_RESPONSE');
    }
    if (_legacyProfile) {
      final permissions = object(data['permissions']);
      Future<List<Json>> lookup(String path, String permission) async {
        if (permissions[permission] == null) return [];
        try {
          return records(await api.request(path));
        } on ApiFailure catch (e) {
          if (e.status == 401) rethrow;
          return [];
        }
      }

      final results = await Future.wait([
        lookup('/branches', 'branch:manage'),
        lookup('/groups', 'group:read'),
      ]);
      data = {
        ...data,
        'branches': results[0],
        'groups': results[1],
        'timezone': 'Asia/Tashkent',
        'currency': 'UZS',
        'moneyUnit': 'tiyin',
      };
    }
    final previousAccess = accessKey;
    profile = data;
    if (accessKey != previousAccess) references.clear();
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode value) async {
    await api.secrets.write('themeMode', value.name);
    themeMode = value;
    notifyListeners();
  }

  Future<void> setLanguage(String value) async {
    await api.secrets.write('language', value);
    language = value;
    notifyListeners();
  }
}

class AppScope extends InheritedNotifier<Session> {
  const AppScope({super.key, required Session session, required super.child})
    : super(notifier: session);
  static Session of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

String childName(Json child) =>
    [child['lastName'], child['firstName']].whereType<String>().join(' ');
String today([DateTime? now]) => (now ?? DateTime.now())
    .toUtc()
    .add(const Duration(hours: 5))
    .toIso8601String()
    .substring(0, 10);
String dateText(dynamic value) {
  final text = value?.toString() ?? '';
  if (text.length < 10) return '—';
  return '${text.substring(8, 10)}.${text.substring(5, 7)}.${text.substring(0, 4)}';
}

String money(dynamic value) {
  final amount = BigInt.tryParse(value?.toString() ?? '') ?? BigInt.zero;
  final digits = (amount.abs() ~/ BigInt.from(100)).toString();
  final grouped = digits.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ' ',
  );
  final cents = (amount.abs() % BigInt.from(100)).toString().padLeft(2, '0');
  return '${amount.isNegative ? '−' : ''}$grouped${cents == '00' ? '' : '.$cents'} UZS';
}

String toTiyin(String value) {
  final normalized = value.trim().replaceAll(' ', '').replaceAll(',', '.');
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(normalized)) {
    throw const FormatException('amount');
  }
  final parts = normalized.split('.');
  final amount =
      BigInt.parse(parts[0]) * BigInt.from(100) +
      BigInt.parse(parts.length == 2 ? parts[1].padRight(2, '0') : '0');
  if (amount <= BigInt.zero) throw const FormatException('amount');
  return amount.toString();
}

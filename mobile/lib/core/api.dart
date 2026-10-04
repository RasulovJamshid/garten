import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

typedef Json = Map<String, dynamic>;
Json object(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : {};
List<Json> records(dynamic value) {
  final data = value is Map ? value['data'] : value;
  return data is List ? data.map(object).toList() : [];
}

abstract interface class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class DeviceSecrets implements SecretStore {
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  @override
  Future<String?> read(String key) => storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => storage.delete(key: key);
}

class ApiFailure implements Exception {
  final String code;
  final int? status;
  const ApiFailure(this.code, [this.status]);
}

class ApiClient {
  ApiClient({required String baseUrl, required this.secrets, Dio? transport})
    : dio = transport ?? Dio() {
    final uri = Uri.parse(baseUrl);
    if (uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw ArgumentError('API_BASE_URL must be an HTTPS API origin and path.');
    }
    dio.options = BaseOptions(
      baseUrl: baseUrl.replaceFirst(RegExp(r'/+$'), ''),
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 25),
      sendTimeout: const Duration(seconds: 25),
      followRedirects: false,
      headers: {'Accept': 'application/json'},
    );
    _cookieKey = 'refresh:${uri.origin}${uri.path}';
  }
  final Dio dio;
  final SecretStore secrets;
  late final String _cookieKey;
  String? _access;
  Future<void>? _refreshing;
  Future<void> _storageTail = Future.value();
  int _generation = 0;
  void Function()? onExpired;

  Future<void> _store(Future<void> Function() operation) {
    final result = _storageTail.then((_) => operation());
    _storageTail = result.catchError((Object _) {});
    return result;
  }

  Future<void> _saveCookie(Response<dynamic> response, int generation) =>
      _store(() async {
        if (generation != _generation) {
          throw const ApiFailure('UNAUTHORIZED', 401);
        }
        for (final header in response.headers['set-cookie'] ?? <String>[]) {
          final cookie = Cookie.fromSetCookieValue(header);
          if (cookie.name == 'kg_refresh') {
            if (cookie.value.isEmpty || cookie.maxAge == 0) {
              await secrets.delete(_cookieKey);
            } else {
              await secrets.write(_cookieKey, cookie.value);
            }
          }
        }
      });

  Future<void> login(String login, String password) async {
    final generation = ++_generation;
    try {
      final response = await dio.post(
        '/auth/login',
        data: {'login': login, 'password': password},
      );
      await _saveCookie(response, generation);
      if (generation != _generation) {
        throw const ApiFailure('UNAUTHORIZED', 401);
      }
      _access = object(response.data)['accessToken'] as String?;
      if (_access == null || _access!.isEmpty) {
        throw const ApiFailure('INVALID_AUTH_RESPONSE');
      }
    } on DioException catch (e) {
      final error = failure(e);
      if (error.status == 401 &&
          !['ACCOUNT_LOCKED', 'ACCOUNT_INACTIVE'].contains(error.code)) {
        throw const ApiFailure('INVALID_CREDENTIALS', 401);
      }
      throw error;
    }
  }

  Future<bool> restore() async {
    if (await secrets.read(_cookieKey) == null) return false;
    try {
      await refresh();
      return true;
    } on ApiFailure catch (e) {
      if (e.status == 401) return false;
      rethrow;
    }
  }

  Future<void> refresh() =>
      _refreshing ??= _rotate().whenComplete(() => _refreshing = null);

  Future<void> _rotate() async {
    final generation = _generation;
    final cookie = await secrets.read(_cookieKey);
    if (cookie == null) {
      await clear();
      throw const ApiFailure('UNAUTHORIZED', 401);
    }
    try {
      final response = await dio.post(
        '/auth/refresh',
        options: Options(headers: {'Cookie': 'kg_refresh=$cookie'}),
      );
      await _saveCookie(response, generation);
      if (generation != _generation) {
        throw const ApiFailure('UNAUTHORIZED', 401);
      }
      _access = object(response.data)['accessToken'] as String?;
      if (_access == null) throw const ApiFailure('UNAUTHORIZED', 401);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401 && generation == _generation) {
        await clear();
      }
      throw failure(e);
    }
  }

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Json? query,
    Object? data,
    String? idempotencyKey,
    ResponseType? responseType,
    bool returnResponse = false,
  }) async {
    // Only relative resource paths: bearer tokens must never follow arbitrary URLs.
    if (!path.startsWith('/') ||
        path.startsWith('//') ||
        path.contains('://')) {
      throw ArgumentError('Relative API path required');
    }
    final generation = _generation;
    final token = _access;
    Future<Response<dynamic>> send() => dio.request(
      path,
      queryParameters: query,
      data: data is FormData ? data.clone() : data,
      options: Options(
        method: method,
        responseType: responseType,
        headers: {
          if (_access != null) 'Authorization': 'Bearer $_access',
          'Idempotency-Key': ?idempotencyKey,
        },
      ),
    );
    try {
      final response = await send();
      if (generation != _generation) {
        throw const ApiFailure('UNAUTHORIZED', 401);
      }
      return returnResponse ? response : response.data;
    } on DioException catch (e) {
      if (e.response?.statusCode != 401 || generation != _generation) {
        throw failure(e);
      }
      if (_access == token) await refresh();
      if (generation != _generation) {
        throw const ApiFailure('UNAUTHORIZED', 401);
      }
      try {
        final response = await send();
        if (generation != _generation) {
          throw const ApiFailure('UNAUTHORIZED', 401);
        }
        return returnResponse ? response : response.data;
      } on DioException catch (retry) {
        if (retry.response?.statusCode == 401 && generation == _generation) {
          await clear();
        }
        throw failure(retry);
      }
    }
  }

  Future<void> logout() async {
    final cookie = await secrets.read(_cookieKey);
    try {
      if (cookie != null) {
        await dio.post(
          '/auth/logout',
          options: Options(headers: {'Cookie': 'kg_refresh=$cookie'}),
        );
      }
    } on DioException catch (e) {
      throw failure(e);
    } finally {
      await clear();
    }
  }

  Future<void> clear() async {
    _generation++;
    _access = null;
    await _store(() => secrets.delete(_cookieKey));
    onExpired?.call();
  }

  static ApiFailure failure(DioException e) => ApiFailure(
    object(object(e.response?.data)['error'])['code']?.toString() ??
        (e.response == null ? 'NETWORK' : 'REQUEST_FAILED'),
    e.response?.statusCode,
  );
}

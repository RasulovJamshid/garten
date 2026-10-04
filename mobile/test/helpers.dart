import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/core/session.dart';

class MemorySecrets implements SecretStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handle);
  final FutureOr<ResponseBody> Function(RequestOptions) handle;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => handle(options);
  @override
  void close({bool force = false}) {}
}

ResponseBody reply(
  dynamic body, {
  int status = 200,
  Map<String, List<String>>? headers,
}) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: {
    'content-type': ['application/json'],
    ...?headers,
  },
);
ApiClient testApi(
  FutureOr<ResponseBody> Function(RequestOptions) handle, {
  MemorySecrets? secrets,
}) {
  final dio = Dio()..httpClientAdapter = FakeAdapter(handle);
  return ApiClient(
    baseUrl: 'https://test.invalid/api/v1',
    secrets: secrets ?? MemorySecrets(),
    transport: dio,
  );
}

Session testSession(List<String> permissions, {ApiClient? api}) =>
    Session(
        api ??
            testApi(
              (_) => reply({
                'data': [],
                'meta': {'total': 0},
              }),
            ),
      )
      ..loading = false
      ..profile = {
        'user': {'id': 'user-1', 'fullName': 'Dilnoza Karimova'},
        'organization': {'name': 'Alishax Kids'},
        'permissions': {for (final p in permissions) p: 'all'},
        'branches': [],
        'groups': [],
      };

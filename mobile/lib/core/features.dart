import 'dart:convert';
import 'package:flutter/services.dart';
import 'api.dart';
import 'session.dart';

class FeatureOperation {
  FeatureOperation(this.contract);
  final Json contract;
  String get id => contract['id'] as String;
  String get title => contract['title'] as String;
  String get group => contract['group'] as String;
  String get path => contract['path'] as String;
  String get method => contract['method'] as String;
  List<Json> get parameters => records(contract['parameters']);
  Json get body => object(contract['body']);
  bool get multipart => contract['multipart'] == true;
  bool get idempotent => contract['idempotent'] == true;
  bool get download => contract['download'] == true;
  bool get writes => method != 'GET';
  bool allowed(Session session) =>
      session.profile != null &&
      (contract['permissions'] as List).every((p) => session.can(p as String));
  String resolvePath(Json values) =>
      path.replaceAllMapped(RegExp(r'\{([^}]+)\}'), (match) {
        final value = values[match[1]]?.toString();
        if (value == null || value.isEmpty) {
          throw const FormatException('Missing record');
        }
        return Uri.encodeComponent(value);
      });
  Json parameterSchema(String location) {
    final fields = parameters.where((p) => p['in'] == location).toList();
    return {
      'type': 'object',
      'additionalProperties': false,
      'properties': {
        for (final p in fields)
          p['name'] as String: {
            ...object(p['schema']),
            if (location == 'path')
              'x-referenceName': referenceName(p['name'] as String, path),
          },
      },
      'required': [
        for (final p in fields)
          if (p['required'] == true) p['name'],
      ],
    };
  }
}

class FeatureCatalog {
  FeatureCatalog(this.operations);
  final List<FeatureOperation> operations;
  static Future<FeatureCatalog>? _loading;
  static Future<FeatureCatalog> load() => _loading ??= _load();
  static Future<FeatureCatalog> _load() async {
    try {
      final data = object(
        jsonDecode(await rootBundle.loadString('assets/api-contract.json')),
      );
      return FeatureCatalog(
        records(data['operations']).map(FeatureOperation.new).toList(),
      );
    } catch (_) {
      _loading = null;
      rethrow;
    }
  }

  List<FeatureOperation> available(Session session) =>
      operations.where((o) => o.allowed(session)).toList();
}

/// Values for contextual actions only come from the record the user selected.
/// An "id" is never assumed to be a child ID across unrelated resources.
Json recordContext(String path, Json row, Json inherited) {
  final context = <String, dynamic>{...inherited};
  for (final entry in row.entries) {
    if (entry.key.endsWith('Id') && entry.value is String) {
      context[entry.key] = entry.value;
    }
  }
  final resource = path.split('/').where((s) => s.isNotEmpty).lastOrNull;
  final entity = {
    'children': 'childId',
    'guardians': 'guardianId',
    'groups': 'groupId',
    'roles': 'roleId',
    'users': 'userId',
    'tariffs': 'tariffId',
    'periods': 'periodId',
    'files': 'fileId',
    'documents': 'docId',
    'discounts': 'discountId',
    'pickup-persons': 'pickupPersonId',
    'billing-runs': 'billingRunId',
    'imports': 'importJobId',
  }[resource];
  if (path == '/imports/validate' && row['id'] != null) {
    context['importJobId'] = row['id'];
  }
  if (row['id'] != null) {
    context['id'] = row['id'];
    if (entity != null) context[entity] = row['id'];
  }
  if (row['key'] != null) context['key'] = row['key'];
  if (row['version'] != null) context['version'] = row['version'];
  return context;
}

String fieldLabel(String name) => name
    .replaceAll(RegExp(r'Tiyin$'), '')
    .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
    .replaceAll('-', ' ')
    .replaceFirstMapped(RegExp(r'^.'), (m) => m[0]!.toUpperCase());

String decimalMoney(dynamic value) {
  final n = BigInt.tryParse(value?.toString() ?? '');
  if (n == null) return '';
  return '${n.isNegative ? '-' : ''}${n.abs() ~/ BigInt.from(100)}.${(n.abs() % BigInt.from(100)).toString().padLeft(2, '0')}';
}

dynamic parseField(String name, String text, Json schema) {
  if (name.endsWith('Tiyin')) {
    final value = text.trim().replaceAll(' ', '').replaceAll(',', '.');
    if (!RegExp(r'^-?\d+(\.\d{1,2})?$').hasMatch(value)) {
      throw const FormatException('amount');
    }
    final negative = value.startsWith('-');
    final parts = value.replaceFirst('-', '').split('.');
    final amount =
        BigInt.parse(parts[0]) * BigInt.from(100) +
        BigInt.parse(parts.length == 2 ? parts[1].padRight(2, '0') : '0');
    return (negative ? -amount : amount).toString();
  }
  switch (schema['type']) {
    case 'integer':
      return int.parse(text.trim());
    case 'number':
      final n = num.parse(text.trim());
      if (!n.isFinite) throw const FormatException('number');
      return n;
    default:
      return text;
  }
}

bool validCalendarDate(String value) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return false;
  final date = DateTime.tryParse(value);
  return date != null && date.toIso8601String().substring(0, 10) == value;
}

String? validateField(dynamic value, Json schema, {bool required = false}) {
  if (value == null || (value is String && value.trim().isEmpty)) {
    return required ? 'required' : null;
  }
  if (schema['enum'] is List && !(schema['enum'] as List).contains(value)) {
    return 'invalid';
  }
  if (value is num) {
    if (schema['type'] == 'integer' && value != value.roundToDouble()) {
      return 'invalid';
    }
    if (schema['minimum'] is num && value < schema['minimum']) return 'invalid';
    if (schema['maximum'] is num && value > schema['maximum']) return 'invalid';
  }
  if (value is String) {
    if (schema['minLength'] is num && value.length < schema['minLength']) {
      return 'invalid';
    }
    if (schema['maxLength'] is num && value.length > schema['maxLength']) {
      return 'invalid';
    }
    if (schema['pattern'] is String &&
        !RegExp(schema['pattern']).hasMatch(value)) {
      return 'invalid';
    }
    if (schema['format'] == 'uuid' &&
        !RegExp(
          r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
        ).hasMatch(value)) {
      return 'invalid';
    }
    if (schema['format'] == 'email' &&
        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value)) {
      return 'invalid';
    }
    if (schema['format'] == 'date' && !validCalendarDate(value)) {
      return 'invalid';
    }
    if (schema['format'] == 'date-time' &&
        (!RegExp(
              r'^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$',
            ).hasMatch(value) ||
            !validCalendarDate(value.substring(0, 10)) ||
            DateTime.tryParse(value) == null)) {
      return 'invalid';
    }
  }
  return null;
}

/// Persist before sending an idempotent mutation. Never generate a new key for
/// an uncertain request, even after closing the app or selecting another record.
class PendingFeature {
  PendingFeature(this.api, this.storageKey);
  final ApiClient api;
  final String storageKey;
  Json? submission;
  Future<void> restore() async {
    final saved = await api.secrets.read(storageKey);
    if (saved != null) submission = object(jsonDecode(saved));
  }

  Future<void> prepare(Json request) async {
    if (submission != null) return;
    await api.secrets.write(storageKey, jsonEncode(request));
    submission = request;
  }

  Future<void> complete() async {
    await api.secrets.delete(storageKey);
    submission = null;
  }
}

Json childContext(String path) {
  final match = RegExp(r'^/children/([^/]+)').firstMatch(path);
  return match == null ? {} : {'childId': match[1]};
}

Json seededValues(Json schema, Json source) {
  final properties = object(schema['properties']);
  if (properties.isEmpty) {
    return schema['additionalProperties'] == false ? {} : {...source};
  }
  final required = schema['required'] as List? ?? [];
  return {
    for (final entry in properties.entries)
      if (source.containsKey(entry.key) || required.contains(entry.key))
        entry.key: source.containsKey(entry.key)
            ? editableValue(object(entry.value), source[entry.key])
            : object(entry.value)['default'] ??
                  switch (object(entry.value)['type']) {
                    'object' => seededValues(object(entry.value), {}),
                    'array' => <dynamic>[],
                    'boolean' => false,
                    _ => '',
                  },
  };
}

dynamic editableValue(Json schema, dynamic value) {
  if (value == null) return null;
  if (schema['type'] == 'object' && value is Map) {
    return seededValues(schema, object(value));
  }
  if (schema['type'] == 'array' && value is List) {
    return value
        .map((item) => editableValue(object(schema['items']), item))
        .toList();
  }
  return value;
}

String referenceName(String name, String path) {
  if (name != 'id') return name;
  if (path.startsWith('/lookups/children/')) return 'childId';
  if (path.startsWith('/landing/blocks/')) return 'blockId';
  return {
        'children': 'childId',
        'groups': 'groupId',
        'guardians': 'guardianId',
        'users': 'userId',
        'roles': 'roleId',
        'payments': 'paymentId',
        'charges': 'chargeId',
        'expenses': 'expenseId',
        'tariffs': 'tariffId',
        'periods': 'periodId',
        'branches': 'branchId',
        'holidays': 'holidayId',
        'announcements': 'announcementId',
        'notifications': 'notificationId',
        'billing-runs': 'billingRunId',
        'billing-rules': 'billingRulesId',
        'pickup-persons': 'pickupPersonId',
        'files': 'fileId',
        'exports': 'exportJobId',
        'imports': 'importJobId',
        'audit': 'auditId',
        'attendance': 'attendanceDayId',
      }[path.split('/').where((v) => v.isNotEmpty).firstOrNull] ??
      name;
}

void rememberResults(
  Session session,
  FeatureOperation operation,
  dynamic value,
) {
  final parts = operation.path.split('/').where((v) => v.isNotEmpty).toList();
  final nested = parts.length > 2 ? parts[2] : '';
  final kind = parts.first == 'children' && nested.isNotEmpty
      ? {
          'documents': 'docId',
          'consents': 'consentId',
          'discounts': 'discountId',
          'tariffs': 'assignmentId',
          'guardians': 'guardianId',
          'charges': 'chargeId',
          'pickup-persons': 'pickupPersonId',
        }[nested]
      : parts.first == 'groups' && ['children', 'transfer'].contains(nested)
      ? 'childId'
      : parts.first == 'groups' && ['history', 'staff'].contains(nested)
      ? null
      : parts.first == 'users' && nested == 'roles'
      ? 'roleId'
      : parts.first == 'roles' && nested == 'users'
      ? 'userId'
      : operation.path.endsWith('/payers')
      ? 'guardianId'
      : referenceName('id', operation.path);
  final rows = value is List
      ? records(value)
      : object(value)['data'] is List
      ? records(value)
      : <Json>[object(value)];
  for (final row in rows) {
    if (kind != null) session.rememberReference(kind, row);
    if (operation.group == 'reports' && row['id'] != null) {
      session.rememberReference('exportJobId', row);
    }
    for (final entry in row.entries) {
      if (entry.value is Map) {
        final nestedKind = {
          'child': 'childId',
          'guardian': 'guardianId',
          'group': 'groupId',
          'tariff': 'tariffId',
          'appUser': 'userId',
          'role': 'roleId',
          'mainTeacher': 'userId',
          'assistant': 'userId',
          'nurse': 'userId',
        }[entry.key];
        if (nestedKind != null) {
          session.rememberReference(nestedKind, object(entry.value));
        }
      }
    }
  }
}

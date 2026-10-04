import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:mime/mime.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uuid/uuid.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'schema_form.dart';
import 'reference_picker.dart';
import 'reference_field.dart';
import 'workflows.dart';
import '../core/workflows.dart';

class FeatureWorkspace extends StatelessWidget {
  const FeatureWorkspace({
    super.key,
    this.contextValues = const {},
    this.initialRecord = const {},
    this.group,
    this.recordGroup,
    this.catalog,
  });
  final Json contextValues, initialRecord;
  final FeatureCatalog? catalog;
  final String? group, recordGroup;
  @override
  Widget build(BuildContext context) {
    final section = group ?? recordGroup;
    if (section != null &&
        initialRecord.isNotEmpty &&
        (contextValues['id'] != null || contextValues['childId'] != null)) {
      return WorkflowRecordPage(
        group: section,
        kind: workflowSpecs[section]?.kind ?? 'id',
        record: initialRecord,
        contextValues: contextValues,
        catalog: catalog,
      );
    }
    if (section != null) {
      return WorkflowSection(
        group: section,
        catalog: catalog,
        contextValues: contextValues,
      );
    }
    return WorkflowDirectory(catalog: catalog);
  }
}

IconData featureIcon(String group) => switch (group) {
  'children' || 'guardians' || 'pickup' => Icons.family_restroom_rounded,
  'attendance' || 'holidays' => Icons.event_available_rounded,
  'payments' ||
  'charges' ||
  'debts' ||
  'expenses' ||
  'tariffs' ||
  'discounts' => Icons.account_balance_wallet_outlined,
  'billing-rules' || 'billing-runs' || 'periods' => Icons.calculate_outlined,
  'groups' || 'branches' => Icons.groups_outlined,
  'roles' || 'permissions' || 'auth' || 'audit' => Icons.shield_outlined,
  'notifications' ||
  'notification-templates' ||
  'announcements' ||
  'telegram' => Icons.forum_outlined,
  'reports' || 'dashboard' => Icons.insights_rounded,
  'files' || 'imports' || 'exports' => Icons.folder_outlined,
  'landing' => Icons.web_rounded,
  'users' => Icons.badge_outlined,
  _ => Icons.tune_rounded,
};

class FeatureOperationPage extends StatefulWidget {
  const FeatureOperationPage({
    super.key,
    required this.operation,
    this.contextValues = const {},
    this.initialRecord = const {},
    this.recordGroup,
    this.guided = false,
  });
  final bool guided;
  final String? recordGroup;
  final FeatureOperation operation;
  final Json contextValues, initialRecord;
  @override
  State<FeatureOperationPage> createState() => _FeatureOperationPageState();
}

class _FeatureOperationPageState extends State<FeatureOperationPage> {
  final form = GlobalKey<FormState>();
  Json pathValues = {}, queryValues = {}, bodyValues = {};
  PendingFeature? pending;
  bool initialized = false, restoring = true, busy = false, dirty = false;
  bool recoveryFailed = false, completed = false;
  Object? error;
  dynamic result;
  Uint8List? download;
  String filename = 'download', mime = 'application/octet-stream';
  FeatureOperation get op => widget.operation;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!initialized) {
      initialized = true;
      initialize();
    }
  }

  Future<void> initialize() async {
    recoveryFailed = false;
    error = null;
    final kind = referenceName('id', op.path);
    if (widget.initialRecord['id'] != null &&
        widget.initialRecord['id'] == widget.contextValues['id']) {
      AppScope.of(context).rememberReference(kind, widget.initialRecord);
    }
    pathValues = seededValues(op.parameterSchema('path'), {
      ...widget.contextValues,
      if (widget.recordGroup != null && widget.recordGroup != op.group)
        'id': '',
      if (op.path.startsWith('/children/{id}') &&
          widget.contextValues['childId'] != null)
        'id': widget.contextValues['childId'],
    });
    queryValues = seededValues(op.parameterSchema('query'), {
      for (final p in op.parameters.where((p) => p['in'] == 'query'))
        if (widget.contextValues.containsKey(p['name']))
          p['name'] as String: widget.contextValues[p['name']]
        else if (object(p['schema'])['default'] != null)
          p['name'] as String: object(p['schema'])['default'],
    });
    if (op.id == 'LookupsController_children' &&
        !AppScope.of(context).can(queryValues['permission'].toString())) {
      final options =
          object(
                op.parameters.firstWhere(
                  (p) => p['name'] == 'permission',
                )['schema'],
              )['enum']
              as List;
      queryValues['permission'] = options
          .where((v) => AppScope.of(context).can(v.toString()))
          .firstOrNull;
    }
    bodyValues = seededValues(op.body, {
      ...widget.contextValues,
      if (['PUT', 'PATCH'].contains(op.method) &&
          widget.recordGroup == op.group)
        ...widget.initialRecord,
    });
    if (op.body.isEmpty) bodyValues = {};
    if ([
          'GroupsController_assignChild',
          'GroupsController_transfer',
        ].contains(op.id) &&
        (bodyValues['effectiveDate'] == null ||
            bodyValues['effectiveDate'] == '')) {
      bodyValues['effectiveDate'] = today();
    }
    if (op.idempotent) {
      final session = AppScope.of(context);
      pending = PendingFeature(
        session.api,
        'operation:${session.api.dio.options.baseUrl}:${object(session.profile?['user'])['id']}:${op.id}',
      );
      try {
        await pending!.restore();
        final saved = pending!.submission;
        if (saved != null) {
          pathValues = object(saved['pathValues']);
          queryValues = object(saved['query']);
          bodyValues = object(saved['data']);
        }
      } catch (e) {
        error = e;
        recoveryFailed = true;
      }
    }
    if (mounted) {
      setState(() => restoring = false);
      if (widget.guided && !op.writes && !recoveryFailed) {
        final requiredQueries =
            (op.parameterSchema('query')['required'] as List? ?? []);
        if (requiredQueries.every(
          (k) =>
              validateField(
                queryValues[k],
                object(object(op.parameterSchema('query')['properties'])[k]),
                required: true,
              ) ==
              null,
        )) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) run();
          });
        }
      }
    }
  }

  Json get referenceValues => {
    ...widget.contextValues,
    ...pathValues,
    ...queryValues,
    ...bodyValues,
    if (op.path.startsWith('/children/{id}') && pathValues['id'] != null)
      'childId': pathValues['id'],
  };

  bool get frozen => pending?.submission != null;
  bool get enabled => !busy && !frozen && !recoveryFailed && !completed;

  Future<void> run() async {
    if (busy ||
        restoring ||
        recoveryFailed ||
        completed ||
        !form.currentState!.validate()) {
      return;
    }
    final session = AppScope.of(context);
    if (!op.allowed(session)) {
      setState(() => error = const ApiFailure('FORBIDDEN', 403));
      return;
    }
    if (op.writes &&
        !await confirm(
          context,
          tr(context, op.id),
          frozen
              ? tr(context, 'retrySameOperation')
              : operationReview(context, pathValues, bodyValues, operation: op),
        )) {
      return;
    }
    if (!mounted) return;
    setState(() {
      busy = true;
      error = null;
      result = null;
      download = null;
    });
    try {
      final path = op.resolvePath(pathValues);
      if (pending != null) {
        await pending!.prepare({
          'path': path,
          'pathValues': pathValues,
          'query': queryValues,
          'data': bodyValues,
          'key': const Uuid().v4(),
        });
      }
      final saved = pending?.submission;
      Object? data = saved?['data'] ?? (op.body.isEmpty ? null : bodyValues);
      if (op.multipart) {
        final fields = <String, dynamic>{};
        for (final entry in bodyValues.entries) {
          final file = entry.value;
          fields[entry.key] = file is XFile ? await multipartFile(file) : file;
        }
        data = FormData.fromMap(fields);
      }
      final byteResponse =
          op.download ||
          op.group == 'reports' &&
              ['pdf', 'xlsx', 'csv'].contains(queryValues['format']);
      final response = await session.api.request(
        saved?['path'] as String? ?? path,
        method: op.method,
        query: object(saved?['query'] ?? queryValues),
        data: data,
        idempotencyKey: saved?['key'] as String?,
        responseType: byteResponse ? ResponseType.bytes : null,
        returnResponse: byteResponse,
      );
      if (pending != null) await pending!.complete();
      dynamic value = response;
      if (byteResponse) {
        final raw = response as Response<dynamic>;
        final bytes = Uint8List.fromList(raw.data as List<int>);
        mime =
            raw.headers.value('content-type')?.split(';').first ??
            'application/octet-stream';
        if (mime.contains('json')) {
          value = jsonDecode(utf8.decode(bytes));
        } else {
          download = bytes;
          final disposition = raw.headers.value('content-disposition') ?? '';
          final match = RegExp(r'filename="?([^";]+)').firstMatch(disposition);
          filename = match == null
              ? 'download.${mime.contains('pdf')
                    ? 'pdf'
                    : mime.contains('html')
                    ? 'html'
                    : 'xlsx'}'
              : Uri.decodeComponent(match[1]!);
          filename = filename.replaceAll(RegExp(r'[/\\\x00-\x1f]'), '_');
          value = null;
        }
      }
      if (mounted) {
        setState(() {
          rememberResults(AppScope.of(context), op, value);
          if (op.id == 'FilesController_upload' &&
              object(value)['fileId'] != null) {
            session.rememberReference('fileId', {
              ...object(value),
              'id': object(value)['fileId'],
              if (bodyValues['file'] is XFile)
                'originalName': (bodyValues['file'] as XFile).name,
            });
          }
          result = value;
          dirty = false;
          completed = op.writes;
        });
        if (op.writes) toast(context, tr(context, 'saved'));
        if (op.id == 'AuthController_changePassword') {
          await session.api.clear();
        } else if ([
              'roles',
              'users',
              'groups',
              'branches',
            ].contains(op.group) &&
            op.writes) {
          await session.reload();
        }
      }
    } catch (e) {
      if (e is ApiFailure && [400, 422].contains(e.status) && pending != null) {
        try {
          await pending!.complete();
        } catch (_) {
          /* Keep the stored request if storage failed. */
        }
      }
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> share(BuildContext origin) async {
    if (download == null) return;
    try {
      final box = origin.findRenderObject() as RenderBox?;
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(download!, mimeType: mime)],
          fileNameOverrides: [filename],
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!op.allowed(AppScope.of(context))) {
      return Scaffold(
        appBar: AppBar(
          toolbarHeight: MediaQuery.textScalerOf(
            context,
          ).scale(64).clamp(64, 104),
          title: Text(
            tr(context, op.id),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        body: Center(child: Text(tr(context, 'FORBIDDEN'))),
      );
    }
    return PopScope(
      canPop: !busy && !dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || busy) return;
        if (await confirm(
              context,
              tr(context, 'cancel'),
              tr(context, frozen ? 'retrySameOperation' : 'discard'),
            ) &&
            mounted) {
          setState(() => dirty = false);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) Navigator.pop(context);
          });
        }
      },
      child: Scaffold(
        appBar: AppBar(
          toolbarHeight: MediaQuery.textScalerOf(
            context,
          ).scale(64).clamp(64, 104),
          title: Text(
            tr(context, op.id),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        bottomNavigationBar: !widget.guided || restoring
            ? null
            : SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton.icon(
                    onPressed: busy
                        ? null
                        : completed
                        ? () => Navigator.pop(context, true)
                        : recoveryFailed
                        ? initialize
                        : run,
                    icon: busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            completed
                                ? Icons.check_circle_outline
                                : op.writes
                                ? Icons.check
                                : Icons.refresh,
                          ),
                    label: Text(
                      tr(
                        context,
                        completed
                            ? 'doneTask'
                            : frozen
                            ? 'retry'
                            : op.writes
                            ? op.id
                            : result != null
                            ? 'refreshData'
                            : 'showResults',
                      ),
                    ),
                  ),
                ),
              ),
        body: restoring
            ? const Center(child: CircularProgressIndicator.adaptive())
            : Form(
                key: form,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (frozen)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 20),
                        child: Text(tr(context, 'retrySameOperation')),
                      ),
                    if (widget.guided && widget.initialRecord.isNotEmpty)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.check_circle_outline),
                          title: Text(
                            referenceTitle(context, widget.initialRecord),
                          ),
                          subtitle: Text(tr(context, 'selectedTaskRecord')),
                        ),
                      ),
                    if (completed && widget.guided)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 20),
                        child: Text(
                          tr(context, 'saved'),
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                      ),
                    if (!widget.guided)
                      SchemaObjectForm(
                        key: const ValueKey('path'),
                        referenceValues: referenceValues,
                        schema: op.parameterSchema('path'),
                        value: pathValues,
                        enabled: enabled,
                        onChanged: (v) => setState(() {
                          final childChanged =
                              (op.path.startsWith('/children/{id}') &&
                                  v['id'] != pathValues['id']) ||
                              v['childId'] != pathValues['childId'];
                          pathValues = v;
                          if (childChanged) {
                            for (final key in [
                              'docId',
                              'consentId',
                              'discountId',
                              'assignmentId',
                              'pickupPersonId',
                            ]) {
                              if (pathValues.containsKey(key)) {
                                pathValues[key] = '';
                              }
                            }
                            bodyValues.remove('payerGuardianId');
                            bodyValues.remove('grantedByGuardianId');
                            bodyValues.remove('pickupPermissionId');
                          }
                          dirty = op.writes;
                        }),
                      ),
                    if (op.parameters.any((p) => p['in'] == 'query'))
                      ExpansionTile(
                        initiallyExpanded: true,
                        title: Text(tr(context, 'filters')),
                        children: [
                          SchemaObjectForm(
                            key: const ValueKey('query'),
                            referenceValues: referenceValues,
                            schema: op.parameterSchema('query'),
                            suggestedFields: widget.guided
                                ? suggestedWorkflowFields
                                : const {},
                            value: queryValues,
                            enabled: enabled,
                            onChanged: (v) => setState(() {
                              queryValues = v;
                              dirty = op.writes;
                            }),
                          ),
                        ],
                      ),
                    if (op.body.isNotEmpty)
                      SchemaObjectForm(
                        key: const ValueKey('body'),
                        referenceValues: referenceValues,
                        schema: widget.guided
                            ? workflowBodySchema(
                                op,
                                referenceValues,
                                AppScope.of(context),
                              )
                            : op.body,
                        suggestedFields: widget.guided
                            ? suggestedWorkflowFields
                            : const {},
                        value: bodyValues,
                        enabled: enabled,
                        onChanged: (v) => setState(() {
                          if (v['childId'] != bodyValues['childId']) {
                            v.remove('payerGuardianId');
                            v.remove('grantedByGuardianId');
                            v.remove('pickupPermissionId');
                            v.remove('pickupPersonId');
                          }
                          if (widget.guided &&
                              v['type'] != bodyValues['type'] &&
                              op.group == 'landing') {
                            v['content'] = <String, dynamic>{};
                          }
                          if (widget.guided &&
                              v['templateKey'] != bodyValues['templateKey']) {
                            v['data'] = <String, dynamic>{};
                          }
                          if (v['audienceType'] != bodyValues['audienceType']) {
                            v.remove('audienceIds');
                          }
                          bodyValues = v;
                          dirty = true;
                        }),
                      ),
                    if (error != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          errorText(context, error!),
                          style: const TextStyle(color: Colors.red),
                        ),
                      ),
                    if (!widget.guided)
                      FilledButton.icon(
                        onPressed: busy || completed
                            ? null
                            : recoveryFailed
                            ? initialize
                            : run,
                        icon: busy
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Icon(op.writes ? Icons.check : Icons.search),
                        label: Text(
                          tr(
                            context,
                            frozen
                                ? 'retry'
                                : op.writes
                                ? 'save'
                                : 'load',
                          ),
                        ),
                      ),
                    if (download != null)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.insert_drive_file),
                          title: Text(filename),
                          subtitle: Text(
                            '${download!.length} ${tr(context, 'bytes')}',
                          ),
                          trailing: Builder(
                            builder: (origin) => IconButton(
                              tooltip: tr(context, 'share'),
                              onPressed: () => share(origin),
                              icon: const Icon(Icons.ios_share),
                            ),
                          ),
                        ),
                      ),
                    if (result != null) ...[
                      SectionTitle(tr(context, 'result')),
                      if (widget.guided)
                        WorkflowOutput(
                          value: result,
                          operation: op,
                          contextValues: {
                            ...widget.contextValues,
                            ...pathValues,
                            ...childContext(op.resolvePath(pathValues)),
                          },
                        )
                      else
                        FeatureResult(
                          value: result,
                          operation: op,
                          contextValues: {
                            ...widget.contextValues,
                            ...pathValues,
                            ...childContext(op.resolvePath(pathValues)),
                          },
                        ),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}

class FeatureResult extends StatelessWidget {
  const FeatureResult({
    super.key,
    required this.value,
    required this.operation,
    required this.contextValues,
  });
  final dynamic value;
  final FeatureOperation operation;
  final Json contextValues;
  @override
  Widget build(BuildContext context) {
    if (value is List) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if ((value as List).isEmpty) const EmptyView(),
          for (final row in value as List)
            FeatureResult(
              value: row,
              operation: operation,
              contextValues: contextValues,
            ),
        ],
      );
    }
    if (value is Map) {
      final row = object(value);
      if (row['columns'] is List && row['rows'] is List) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              countText(context, 'record', (row['rows'] as List).length),
              style: Theme.of(context).textTheme.labelSmall,
            ),
            const SizedBox(height: 12),
            FeatureResult(
              value: row['rows'],
              operation: operation,
              contextValues: contextValues,
            ),
          ],
        );
      }
      const metadata = {
        'id',
        'tenantId',
        'createdAt',
        'updatedAt',
        'ipAddress',
        'userAgent',
        'objectKey',
        'checksum',
      };
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final entry in row.entries)
                if (!metadata.contains(entry.key) &&
                    !entry.key.endsWith('Hash') &&
                    entry.key != 'refreshToken')
                  _resultField(context, entry, operation, contextValues),
              if (row.keys.any(metadata.contains))
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(
                    tr(context, 'recordDetails'),
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  children: [
                    for (final entry in row.entries.where(
                      (e) => metadata.contains(e.key),
                    ))
                      _resultField(context, entry, operation, contextValues),
                  ],
                ),
              if (row['id'] != null ||
                  row['version'] != null ||
                  row['key'] != null)
                TextButton.icon(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => FeatureWorkspace(
                        group: operation.group,
                        contextValues: recordContext(
                          operation.path,
                          row,
                          contextValues,
                        ),
                        initialRecord: row,
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.more_horiz),
                  label: Text(tr(context, 'recordActions')),
                ),
              if (operation.group == 'reports' &&
                  row['id'] is String &&
                  AppScope.of(context).can('report:read'))
                TextButton.icon(
                  onPressed: () async {
                    final catalog = await FeatureCatalog.load();
                    if (context.mounted) {
                      final op = catalog.operations.firstWhere(
                        (o) => o.id == 'ExportsController_get',
                      );
                      Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => FeatureOperationPage(
                            operation: op,
                            contextValues: {'id': row['id']},
                          ),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.refresh),
                  label: Text(tr(context, 'checkExport')),
                ),
              if (row['fileId'] is String &&
                  AppScope.of(context).can('file:read'))
                TextButton.icon(
                  onPressed: () async {
                    final catalog = await FeatureCatalog.load();
                    if (context.mounted) {
                      final op = catalog.operations.firstWhere(
                        (o) => o.id == 'FilesController_download',
                      );
                      Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => FeatureOperationPage(
                            operation: op,
                            contextValues: {'id': row['fileId']},
                          ),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.download),
                  label: Text(tr(context, 'download')),
                ),
            ],
          ),
        ),
      );
    }
    return SelectableText(displayValue(context, '', value));
  }
}

Widget _resultField(
  BuildContext context,
  MapEntry<String, dynamic> entry,
  FeatureOperation operation,
  Json contextValues,
) {
  if (entry.value is Map || entry.value is List) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text(
        formLabel(context, entry.key),
        style: Theme.of(context).textTheme.titleMedium,
      ),
      children: [
        FeatureResult(
          value: entry.value,
          operation: operation,
          contextValues: contextValues,
        ),
      ],
    );
  }
  final financial = entry.key.endsWith('Tiyin');
  final pending =
      entry.key == 'status' &&
      entry.value == 'pending' &&
      operation.group != 'attendance';
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          formLabel(context, entry.key),
          style: Theme.of(context).textTheme.labelSmall,
        ),
        const SizedBox(height: 3),
        SelectableText(
          financial
              ? money(entry.value)
              : pending
              ? tr(context, 'awaiting')
              : displayValue(context, entry.key, entry.value),
          style: financial
              ? Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                )
              : Theme.of(context).textTheme.bodyLarge,
        ),
      ],
    ),
  );
}

Future<MultipartFile> multipartFile(XFile file) async {
  final bytes = await file.readAsBytes();
  final mime =
      lookupMimeType(file.name, headerBytes: bytes) ??
      file.mimeType ??
      'application/octet-stream';
  return MultipartFile.fromBytes(
    bytes,
    filename: file.name,
    contentType: DioMediaType.parse(mime),
  );
}

String operationReview(
  BuildContext context,
  Json path,
  Json body, {
  FeatureOperation? operation,
}) {
  final lines = <String>[tr(context, 'confirmChanges')];
  for (final entry in {...path, ...body}.entries) {
    final v = entry.value;
    final kind = referenceKind(referenceName(entry.key, operation?.path ?? ''));
    final record = AppScope.of(context).references[kind]?[v?.toString()];
    final display = entry.key.toLowerCase().contains('password')
        ? '********'
        : entry.key.endsWith('Tiyin')
        ? money(v)
        : v is XFile
        ? v.name
        : v is List
        ? '${v.length} ${tr(context, 'items')}'
        : v is Map
        ? '${v.length} ${tr(context, 'fields')}'
        : record != null
        ? referenceTitle(context, record)
        : (entry.key == 'id' || entry.key.endsWith('Id'))
        ? tr(context, 'selectedRecord')
        : displayValue(context, entry.key, v);
    lines.add('${formLabel(context, entry.key)}: $display');
  }
  return lines.join('\n');
}

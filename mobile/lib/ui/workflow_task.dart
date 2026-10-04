import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/workflows.dart';
import 'common.dart';
import 'features.dart';
import 'groups.dart';
import 'schema_form.dart';

Future<void> openWorkflowTask(
  BuildContext context,
  FeatureCatalog catalog,
  FeatureOperation op, {
  Json contextValues = const {},
  Json record = const {},
}) async {
  await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) =>
          op.id == 'GroupsController_setStaff' &&
              AppScope.of(context).can('group:read')
          ? GroupStaffPage(
              group:
                  contextValues['groupId'] != null &&
                      record['id'] == contextValues['groupId']
                  ? record
                  : null,
            )
          : WorkflowTaskPage(
              operation: op,
              catalog: catalog,
              contextValues: contextValues,
              record: record,
            ),
    ),
  );
}

class WorkflowTaskPage extends StatefulWidget {
  const WorkflowTaskPage({
    super.key,
    required this.operation,
    required this.catalog,
    this.contextValues = const {},
    this.record = const {},
  });
  final FeatureOperation operation;
  final FeatureCatalog catalog;
  final Json contextValues, record;
  @override
  State<WorkflowTaskPage> createState() => _WorkflowTaskPageState();
}

class _WorkflowTaskPageState extends State<WorkflowTaskPage> {
  final form = GlobalKey<FormState>();
  late Json values = workflowDefaults(
    widget.operation,
    bindWorkflowOperation(widget.operation, widget.contextValues),
  );
  late Json record = widget.record;
  bool started = false, ready = false, loading = false;
  Object? error;
  FeatureOperation get op => widget.operation;
  Json get selectionSchema {
    final fields = object(op.parameterSchema('path')['properties']);
    final required = (op.parameterSchema('path')['required'] as List? ?? []);
    for (final p in op.parameters.where(
      (p) =>
          p['in'] == 'query' &&
          p['required'] == true &&
          (p['name'].toString().endsWith('Id') || p['name'] == 'against'),
    )) {
      fields[p['name']] = {
        ...object(p['schema']),
        'x-referenceName': workflowReference(p['name'], op.path),
      };
      required.add(p['name']);
    }
    return {
      'type': 'object',
      'properties': {
        for (final entry in fields.entries)
          entry.key: {
            ...object(entry.value),
            'x-referenceName':
                op.id == 'NotificationTemplatesController_upsert' &&
                    widget.contextValues['templateKey'] == null &&
                    entry.key == 'key'
                ? 'name'
                : workflowReference(entry.key, op.path),
          },
      },
      'required': required,
      'additionalProperties': false,
    };
  }

  bool get hasSelection => object(
    selectionSchema['properties'],
  ).keys.any((k) => values[k] == null || values[k] == '');
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      if (!hasSelection) prepare();
    }
  }

  Future<void> prepare() async {
    if (loading ||
        (form.currentState != null && !form.currentState!.validate())) {
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final session = AppScope.of(context);
      final target = op.parameters.where((p) => p['in'] == 'path').lastOrNull;
      final kind = target == null
          ? ''
          : workflowReference(target['name'], op.path);
      if (target != null) {
        record =
            session.references[kind]?[values[target['name']]?.toString()] ??
            record;
      }
      if (op.id == 'LandingController_reorder') {
        final draft = object(await session.api.request('/landing'));
        final blocks = records(draft['blocks']);
        for (final block in blocks) {
          session.rememberReference('blockId', block);
        }
        values['blocks'] = [
          for (var i = 0; i < blocks.length; i++)
            {'id': blocks[i]['id'], 'position': i},
        ];
      }
      if (op.id == 'BillingRulesController_create') {
        final active = widget.catalog
            .available(session)
            .where((o) => o.id == 'BillingRulesController_active')
            .firstOrNull;
        if (active != null) {
          final current = object(await session.api.request(active.path));
          values['rules'] = current['rules'];
        }
      }
      if (op.group == 'landing' && record['type'] != null) {
        values['blockType'] = record['type'];
      }
      if (['PUT', 'PATCH'].contains(op.method)) {
        final read = widget.catalog
            .available(session)
            .where(
              (o) =>
                  o.method == 'GET' &&
                  o.path == op.path &&
                  !o.parameters.any(
                    (p) => p['in'] == 'query' && p['required'] == true,
                  ),
            )
            .firstOrNull;
        if (read != null) {
          final raw = await session.api.request(read.resolvePath(values));
          final response =
              raw is List && op.id == 'UsersController_replaceRoles'
              ? <String, dynamic>{
                  'roles': [
                    for (final grant in records(raw))
                      {
                        'roleId':
                            grant['roleId'] ??
                            object(grant['role'])['id'] ??
                            grant['id'],
                        if (grant['branchId'] != null)
                          'branchId': grant['branchId'],
                      },
                  ],
                }
              : object(raw);
          record = op.path.endsWith('/medical')
              ? {
                  ...object(response['record']),
                  'allergies': response['allergies'] ?? [],
                  'medications': response['medications'] ?? [],
                }
              : response;
        }
      }
      if (!mounted) return;
      setState(() {
        ready = true;
        loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e;
          loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (ready) {
      return FeatureOperationPage(
        operation: op,
        contextValues: values,
        initialRecord: record,
        recordGroup: op.group,
        guided: true,
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(tr(context, op.id))),
      body: Form(
        key: form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              tr(context, 'chooseTaskContext'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            Text(tr(context, 'chooseTaskContextHint')),
            const SizedBox(height: 24),
            SchemaObjectForm(
              schema: selectionSchema,
              value: values,
              referenceValues: {
                ...widget.contextValues,
                ...values,
                if (op.path.startsWith('/children/{id}'))
                  'childId': values['id'],
              },
              enabled: !loading,
              onChanged: (v) => setState(() {
                final childChanged =
                    (op.path.startsWith('/children/{id}') &&
                        v['id'] != values['id']) ||
                    v['childId'] != values['childId'];
                values = {...values, ...v};
                if (childChanged) {
                  for (final key in [
                    'docId',
                    'consentId',
                    'discountId',
                    'assignmentId',
                    'pickupPersonId',
                    'payerGuardianId',
                    'grantedByGuardianId',
                    'pickupPermissionId',
                  ]) {
                    values.remove(key);
                  }
                }
              }),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text(errorText(context, error!)),
              ),
            FilledButton.icon(
              onPressed: loading ? null : prepare,
              icon: loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_forward),
              label: Text(tr(context, 'continueTask')),
            ),
          ],
        ),
      ),
    );
  }
}

import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/workflows.dart';
import 'common.dart';
import 'attendance.dart';
import 'features.dart';
import 'groups.dart';
import 'reference_field.dart';
import 'reference_picker.dart';
import 'schema_form.dart';
import 'workflow_task.dart';

class WorkflowDirectory extends StatefulWidget {
  const WorkflowDirectory({super.key, this.catalog});
  final FeatureCatalog? catalog;
  @override
  State<WorkflowDirectory> createState() => _WorkflowDirectoryState();
}

class _WorkflowDirectoryState extends State<WorkflowDirectory> {
  late final catalog = widget.catalog == null
      ? FeatureCatalog.load()
      : Future.value(widget.catalog!);
  String search = '';
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr(context, 'allFeatures'))),
    body: FutureBuilder<FeatureCatalog>(
      future: catalog,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return FailureView(snapshot.error!, () => setState(() {}));
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator.adaptive());
        }
        final data = snapshot.data!;
        final ops = data.available(AppScope.of(context));
        final groups = ops.map((o) => o.group).toSet();
        final matches = search.trim().toLowerCase();
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              tr(context, 'featureHint'),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(tr(context, 'workflowDirectoryHint')),
            const SizedBox(height: 20),
            TextField(
              onChanged: (v) => setState(() => search = v),
              decoration: InputDecoration(
                hintText: tr(context, 'findTask'),
                prefixIcon: const Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 16),
            if (matches.isEmpty) ...[
              for (final category in workflowCategories)
                if (groups.any(
                  (g) => workflowSpecs[g]?.category == category,
                )) ...[
                  SectionTitle(tr(context, category)),
                  for (final group in groups.where(
                    (g) => workflowSpecs[g]?.category == category,
                  ))
                    Card(
                      child: ListTile(
                        leading: Icon(featureIcon(group)),
                        title: Text(formLabel(context, group)),
                        subtitle: Text(tr(context, 'workflowHint_$group')),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                group == 'groups' &&
                                    AppScope.of(context).can('group:read')
                                ? GroupsPage(catalog: data)
                                : group == 'attendance' &&
                                      AppScope.of(
                                        context,
                                      ).can('attendance:read')
                                ? Scaffold(
                                    appBar: AppBar(
                                      title: Text(tr(context, 'attendance')),
                                      actions: [
                                        IconButton(
                                          tooltip: tr(
                                            context,
                                            'attendanceHistory',
                                          ),
                                          icon: const Icon(Icons.history),
                                          onPressed: () => Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => WorkflowSection(
                                                group: group,
                                                catalog: data,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    body: const AttendancePage(),
                                  )
                                : WorkflowSection(group: group, catalog: data),
                          ),
                        ),
                      ),
                    ),
                ],
            ] else ...[
              for (final op in ops.where(
                (o) => '${tr(context, o.id)} ${formLabel(context, o.group)}'
                    .toLowerCase()
                    .contains(matches),
              ))
                WorkflowTaskTile(operation: op, catalog: data),
              if (!ops.any(
                (o) => '${tr(context, o.id)} ${formLabel(context, o.group)}'
                    .toLowerCase()
                    .contains(matches),
              ))
                const EmptyView(),
            ],
          ],
        );
      },
    ),
  );
}

class WorkflowTaskTile extends StatelessWidget {
  const WorkflowTaskTile({
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
  Widget build(BuildContext context) => Card(
    child: ListTile(
      leading: Icon(
        workflowDestructive(operation)
            ? Icons.warning_amber_outlined
            : operation.writes
            ? Icons.edit_outlined
            : operation.download
            ? Icons.download_outlined
            : Icons.chevron_right_rounded,
        color: workflowDestructive(operation)
            ? Theme.of(context).colorScheme.error
            : null,
      ),
      title: Text(tr(context, operation.id)),
      onTap: () => openWorkflowTask(
        context,
        catalog,
        operation,
        contextValues: contextValues,
        record: record,
      ),
    ),
  );
}

class WorkflowSection extends StatefulWidget {
  const WorkflowSection({
    super.key,
    required this.group,
    this.catalog,
    this.collectionPath,
    this.title,
    this.contextValues = const {},
  });
  final String group;
  final String? collectionPath, title;
  final FeatureCatalog? catalog;
  final Json contextValues;
  @override
  State<WorkflowSection> createState() => _WorkflowSectionState();
}

class _WorkflowSectionState extends State<WorkflowSection> {
  FeatureCatalog? catalog;
  FeatureOperation? listing;
  List<Json>? rows;
  dynamic summary;
  Object? error;
  Json filters = {}, contextValues = {};
  int page = 1, generation = 0;
  bool started = false, loading = false, more = false;
  String search = '';
  Timer? debounce;
  WorkflowSpec get spec => workflowSpecs[widget.group]!;
  String get kind => widget.collectionPath == null
      ? spec.kind
      : workflowResultKind(widget.collectionPath!);
  List<FeatureOperation> get tasks => catalog == null
      ? []
      : widget.collectionPath == null
      ? workflowSectionTasks(catalog!, AppScope.of(context), widget.group)
      : catalog!
            .available(AppScope.of(context))
            .where((o) => o.writes && o.path == listing?.path)
            .toList();
  List<Json> get missing =>
      listing?.parameters
          .where(
            (p) =>
                p['required'] == true &&
                contextValues[workflowReference(p['name'], listing!.path)] ==
                    null &&
                filters[p['name']] == null,
          )
          .toList() ??
      [];
  bool get remoteSearch =>
      listing?.parameters.any((p) => p['name'] == 'q') == true;
  bool get canSearch =>
      remoteSearch ||
      [
        'users',
        'groups',
        'branches',
        'roles',
        'tariffs',
        'periods',
        'holidays',
        'notification-templates',
        'permissions',
        'files',
        'imports',
        'exports',
        'landing',
        'telegram',
      ].contains(widget.group);
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      initialize();
    }
  }

  @override
  void dispose() {
    debounce?.cancel();
    super.dispose();
  }

  Future<void> initialize() async {
    try {
      final data = widget.catalog ?? await FeatureCatalog.load();
      if (!mounted) return;
      contextValues = {
        ...widget.contextValues,
        ...?(widget.collectionPath == null
            ? null
            : childContext(widget.collectionPath!)),
      };
      final allowed = data.available(AppScope.of(context));
      final op = widget.collectionPath == null
          ? allowed.where((o) => o.id == spec.listing).firstOrNull
          : allowed
                .where(
                  (o) =>
                      o.method == 'GET' &&
                      RegExp(
                        '^${o.path.replaceAllMapped(RegExp(r'\{[^}]+\}'), (_) => '[^/]+')}\$',
                      ).hasMatch(widget.collectionPath!),
                )
                .firstOrNull;
      setState(() {
        catalog = data;
        listing = op;
        error = null;
      });
      await load();
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  Future<void> load({bool append = false}) async {
    if (!append) page = 1;
    final ticket = ++generation;
    if (catalog == null) return;
    final session = AppScope.of(context);
    if (listing == null) {
      setState(() => rows = session.references[kind]?.values.toList() ?? []);
      return;
    }
    if (missing.isNotEmpty) {
      setState(() => rows = []);
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final op = listing!;
      final bound = bindWorkflowOperation(op, contextValues);
      final query = {
        for (final p in op.parameters.where((p) => p['in'] == 'query'))
          if (filters.containsKey(p['name']))
            p['name'] as String: filters[p['name']]
          else if (bound[p['name']] != null && bound[p['name']] != '')
            p['name'] as String: bound[p['name']],
        if (op.parameters.any((p) => p['name'] == 'page')) 'page': page,
        if (op.parameters.any((p) => p['name'] == 'limit')) 'limit': 30,
        if (remoteSearch && search.isNotEmpty) 'q': search,
      };
      if (op.id == 'LookupsController_children') {
        query['permission'] = 'child:read';
      }
      final value = await session.api.request(
        widget.collectionPath ?? op.resolvePath(bound),
        query: query,
      );
      if (!mounted || ticket != generation) return;
      final list = widget.group == 'landing'
          ? records(object(value)['blocks'])
          : records(value);
      final meta = object(object(value)['meta']);
      for (final raw in list) {
        final row = workflowRow(kind, raw);
        session.rememberReference(kind, row, valueKey: workflowRecordKey(kind));
      }
      setState(() {
        rows = append ? [...?rows, ...list] : list;
        summary =
            spec.singleton ||
                value is Map && value['data'] is! List && list.isEmpty
            ? value
            : null;
        more = meta['pages'] is num
            ? page < meta['pages']
            : meta['total'] is num
            ? page * 30 < meta['total']
            : false;
        loading = false;
      });
    } catch (e) {
      if (mounted && ticket == generation) {
        setState(() {
          error = e;
          loading = false;
        });
      }
    }
  }

  void searchChanged(String value) {
    debounce?.cancel();
    search = value.trim();
    if (remoteSearch) {
      generation++;
      setState(() {
        rows = null;
        loading = true;
      });
      debounce = Timer(const Duration(milliseconds: 300), () {
        page = 1;
        load();
      });
    } else {
      setState(() {});
    }
  }

  Future<void> filter() async {
    final properties = object(listing?.parameterSchema('query')['properties'])
      ..removeWhere(
        (k, _) => ['q', 'page', 'limit', 'sort', 'permission'].contains(k),
      );
    if (properties.isEmpty) return;
    for (final name in [
      'status',
      'kind',
      'type',
      'method',
      'channel',
      'entity',
      'action',
    ]) {
      if (!properties.containsKey(name)) continue;
      final choices = <dynamic>{
        for (final op in catalog!.operations.where(
          (o) => o.group == widget.group,
        ))
          ...?(object(object(op.body['properties'])[name])['enum'] as List?),
        for (final row in rows ?? <Json>[])
          if (row[name] is String) row[name],
        if (name == 'status')
          ...?({
            'expenses': ['unpaid', 'paid', 'cancelled'],
            'billing-runs': ['preview', 'committed', 'discarded'],
            'notifications': ['queued', 'sent', 'failed'],
          }[widget.group]),
      };
      if (choices.isNotEmpty) {
        properties[name] = {'type': 'string', 'enum': choices.toList()};
      }
    }
    for (final name in [
      'unpaidOnly',
      'overdueOnly',
      'includeDeprecated',
      'includeSystem',
      'active',
    ]) {
      if (properties.containsKey(name)) properties[name] = {'type': 'boolean'};
    }
    if (properties.containsKey('recordedBy')) {
      properties['recordedBy'] = {
        'type': 'string',
        'x-referenceName': 'userId',
      };
    }
    var next = {...filters};
    final applied = await showModalBottomSheet<Json>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.viewInsetsOf(context).bottom + 20,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  tr(context, 'filters'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 20),
                SchemaObjectForm(
                  schema: {
                    'type': 'object',
                    'properties': properties,
                    'additionalProperties': false,
                  },
                  value: next,
                  suggestedFields: properties.keys.toSet(),
                  onChanged: (v) => update(() => next = v),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, next),
                  child: Text(tr(context, 'applyFilters')),
                ),
                TextButton(
                  onPressed: () => Navigator.pop(context, <String, dynamic>{}),
                  child: Text(tr(context, 'resetFilters')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (applied != null && mounted) {
      setState(() {
        filters = applied..removeWhere((_, v) => v == null || v == '');
        page = 1;
      });
      await load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final taskList = tasks;
    final create = taskList
        .where((o) => o.writes && !workflowDestructive(o))
        .firstOrNull;
    final visible = (rows ?? [])
        .map((r) => workflowRow(kind, r))
        .where(
          (r) =>
              !canSearch ||
              remoteSearch ||
              '${referenceTitle(context, r)} ${referenceSubtitle(context, r)}'
                  .toLowerCase()
                  .contains(search.toLowerCase()),
        )
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(formLabel(context, widget.title ?? widget.group)),
      ),
      body: catalog == null
          ? error != null
                ? FailureView(error!, initialize)
                : const Center(child: CircularProgressIndicator.adaptive())
          : RefreshIndicator(
              onRefresh: () => load(),
              child: ListView(
                padding: const EdgeInsets.all(20),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  Text(
                    tr(context, 'workflowHint_${widget.group}'),
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 16),
                  if (create != null) ...[
                    FilledButton.icon(
                      onPressed: () async {
                        await openWorkflowTask(
                          context,
                          catalog!,
                          create,
                          contextValues: contextValues,
                        );
                        if (mounted) load();
                      },
                      icon: const Icon(Icons.add),
                      label: Text(tr(context, create.id)),
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (taskList.where((o) => o != create).isNotEmpty)
                    ExpansionTile(
                      initiallyExpanded: listing == null,
                      tilePadding: EdgeInsets.zero,
                      title: Text(tr(context, 'sectionTasks')),
                      children: [
                        for (final op in taskList.where((o) => o != create))
                          WorkflowTaskTile(
                            operation: op,
                            catalog: catalog!,
                            contextValues: contextValues,
                          ),
                      ],
                    ),
                  for (final p in missing)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: ReferenceField(
                        name: workflowReference(p['name'], listing!.path),
                        label: formLabel(
                          context,
                          workflowReference(p['name'], listing!.path),
                        ),
                        value: null,
                        onChanged: (v) {
                          setState(
                            () =>
                                contextValues[workflowReference(
                                      p['name'],
                                      listing!.path,
                                    )] =
                                    v,
                          );
                          load();
                        },
                      ),
                    ),
                  if (missing.isEmpty) ...[
                    if (contextValues['childId'] != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: ReferenceField(
                          name: 'childId',
                          label: tr(context, 'childId'),
                          value: contextValues['childId'],
                          onChanged: widget.collectionPath != null
                              ? (_) {}
                              : (v) {
                                  setState(() => contextValues['childId'] = v);
                                  load();
                                },
                          enabled: widget.collectionPath == null,
                        ),
                      ),
                    if (canSearch)
                      TextField(
                        onChanged: searchChanged,
                        decoration: InputDecoration(
                          hintText: tr(context, 'searchByName'),
                          prefixIcon: const Icon(Icons.search),
                        ),
                      ),
                    if (listing?.parameters.any(
                          (p) =>
                              p['in'] == 'query' &&
                              ![
                                'q',
                                'page',
                                'limit',
                                'sort',
                                'permission',
                              ].contains(p['name']),
                        ) ==
                        true)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton.icon(
                          onPressed: filter,
                          icon: const Icon(Icons.tune),
                          label: Text(
                            '${tr(context, 'filters')}${filters.isEmpty ? '' : ' (${filters.length})'}',
                          ),
                        ),
                      ),
                    if (loading) const LinearProgressIndicator(),
                    if (error != null)
                      FailureView(error!, () => load(append: page > 1)),
                    if (summary != null && listing != null)
                      WorkflowRecordSummary(record: object(summary)),
                    if (!loading &&
                        error == null &&
                        visible.isEmpty &&
                        summary == null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 24),
                        child: Text(
                          tr(
                            context,
                            listing == null
                                ? 'recentRecordsHint'
                                : 'emptyWorkflowHint',
                          ),
                        ),
                      ),
                    for (final row in visible)
                      WorkflowRecordCard(
                        row: row,
                        onTap: () async {
                          await Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => WorkflowRecordPage(
                                group: widget.group,
                                kind: kind,
                                record: row,
                                contextValues: contextValues,
                                catalog: catalog,
                              ),
                            ),
                          );
                          if (mounted) load();
                        },
                      ),
                    if (more)
                      OutlinedButton(
                        onPressed: loading || error != null
                            ? null
                            : () {
                                page++;
                                load(append: true);
                              },
                        child: Text(tr(context, 'loadMore')),
                      ),
                  ],
                ],
              ),
            ),
    );
  }
}

class WorkflowRecordCard extends StatelessWidget {
  const WorkflowRecordCard({super.key, required this.row, required this.onTap});
  final Json row;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      leading: PersonAvatar(referenceTitle(context, row)),
      title: Text(referenceTitle(context, row)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (referenceSubtitle(context, row).isNotEmpty)
            Text(referenceSubtitle(context, row)),
          for (final key in ['debtTiyin', 'outstandingTiyin', 'totalTiyin'])
            if (row[key] != null)
              Text(
                '${formLabel(context, key)}: ${money(row[key])}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
        ],
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    ),
  );
}

class WorkflowRecordSummary extends StatelessWidget {
  const WorkflowRecordSummary({
    super.key,
    required this.record,
    this.depth = 0,
  });
  final Json record;
  final int depth;
  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    final entries = record.entries.where(
      (e) =>
          e.value != null &&
          e.value != '' &&
          ![
            'id',
            'tenantId',
            'objectKey',
            'checksum',
            'refreshToken',
            'accessToken',
            'password',
            'permissionsVersion',
            'ipAddress',
            'userAgent',
          ].contains(e.key) &&
          !e.key.endsWith('Hash'),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final entry in entries)
              if (entry.key.endsWith('Id')) ...[
                if (session.references[referenceKind(entry.key)]?[entry.value
                        .toString()]
                    case final Json related)
                  _line(
                    context,
                    formLabel(context, entry.key),
                    referenceTitle(context, related),
                  ),
              ] else if (entry.value is Map && depth < 2)
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(formLabel(context, entry.key)),
                  children: [
                    WorkflowRecordSummary(
                      record: object(entry.value),
                      depth: depth + 1,
                    ),
                  ],
                )
              else if (entry.value is List &&
                  (entry.value as List).isNotEmpty &&
                  depth < 2)
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(
                    '${formLabel(context, entry.key)} (${(entry.value as List).length})',
                  ),
                  children: [
                    for (final item in entry.value as List)
                      if (item is Map)
                        WorkflowRecordSummary(
                          record: object(item),
                          depth: depth + 1,
                        )
                      else if (!entry.key.endsWith('Ids'))
                        Padding(
                          padding: const EdgeInsets.all(8),
                          child: Text(displayValue(context, entry.key, item)),
                        ),
                  ],
                )
              else if (entry.value is! Map && entry.value is! List)
                _line(
                  context,
                  formLabel(context, entry.key),
                  entry.key.endsWith('Tiyin')
                      ? money(entry.value)
                      : displayValue(context, entry.key, entry.value),
                ),
          ],
        ),
      ),
    );
  }

  Widget _line(BuildContext context, String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        const SizedBox(height: 3),
        SelectableText(value),
      ],
    ),
  );
}

String workflowArea(FeatureOperation op) {
  final parts = op.path.split('/').where((p) => p.isNotEmpty).toList();
  if (parts.firstOrNull == 'children' && parts.length > 2) {
    return {
          'charge-ledger': 'charges',
          'recalculate-billing': 'charges',
          'pickup-history': 'pickup',
          'pickup-persons': 'pickup',
        }[parts[2]] ??
        parts[2];
  }
  if (parts.firstOrNull == 'users' && parts.length > 2) {
    return [
          'roles',
          'effective-permissions',
          'permission-overrides',
        ].contains(parts[2])
        ? 'roles'
        : 'users';
  }
  return op.group;
}

class WorkflowRecordPage extends StatefulWidget {
  const WorkflowRecordPage({
    super.key,
    required this.group,
    required this.kind,
    required this.record,
    this.contextValues = const {},
    this.catalog,
  });
  final String group, kind;
  final Json record, contextValues;
  final FeatureCatalog? catalog;
  @override
  State<WorkflowRecordPage> createState() => _WorkflowRecordPageState();
}

class _WorkflowRecordPageState extends State<WorkflowRecordPage> {
  late Json record = widget.record;
  FeatureCatalog? catalog;
  Object? error;
  bool started = false, loading = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      load();
    }
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = widget.catalog ?? await FeatureCatalog.load();
      if (!mounted) return;
      final session = AppScope.of(context);
      final values = workflowContext(
        widget.kind,
        record,
        inherited: widget.contextValues,
      );
      final read = data
          .available(session)
          .where(
            (o) =>
                o.group == widget.group &&
                o.id.endsWith('_get') &&
                o.method == 'GET' &&
                workflowTargets(o, widget.kind) &&
                o.parameters.where((p) => p['required'] == true).length == 1,
          )
          .firstOrNull;
      if (read != null) {
        record = {
          ...record,
          ...object(
            await session.api.request(
              read.resolvePath(bindWorkflowOperation(read, values)),
            ),
          ),
        };
      }
      if (!mounted) return;
      session.rememberReference(
        widget.kind,
        record,
        valueKey: workflowRecordKey(widget.kind),
      );
      setState(() {
        catalog = data;
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
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        referenceTitle(context, record),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (loading) const LinearProgressIndicator(),
        if (error != null) FailureView(error!, load),
        if (catalog != null) ...[
          Text(
            referenceTitle(context, record),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          WorkflowRecordActions(
            group: widget.group,
            kind: widget.kind,
            record: record,
            contextValues: widget.contextValues,
            catalog: catalog!,
            onChanged: load,
          ),
          SectionTitle(tr(context, 'recordOverview')),
          WorkflowRecordSummary(record: record),
        ],
      ],
    ),
  );
}

class WorkflowRecordActions extends StatelessWidget {
  const WorkflowRecordActions({
    super.key,
    required this.group,
    required this.kind,
    required this.record,
    required this.catalog,
    this.contextValues = const {},
    this.onChanged,
  });
  final String group, kind;
  final Json record, contextValues;
  final FeatureCatalog catalog;
  final VoidCallback? onChanged;
  @override
  Widget build(BuildContext context) {
    final values = workflowContext(kind, record, inherited: contextValues);
    final ops = workflowRecordActions(
      catalog,
      AppScope.of(context),
      group,
      kind,
      context: values,
    );
    final edit = ops
        .where(
          (o) =>
              o.id.endsWith('_update') &&
              o.parameters.where((p) => p['in'] == 'path').length == 1,
        )
        .firstOrNull;
    final areas = ops
        .where((o) => o != edit && !workflowDestructive(o))
        .map(workflowArea)
        .toSet();
    Future<void> run(FeatureOperation op) async {
      await openWorkflowTask(
        context,
        catalog,
        op,
        contextValues: values,
        record: record,
      );
      if (context.mounted) onChanged?.call();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (record['fileId'] != null && AppScope.of(context).can('file:read'))
          OutlinedButton.icon(
            onPressed: () => openWorkflowTask(
              context,
              catalog,
              catalog.operations.firstWhere(
                (o) => o.id == 'FilesController_download',
              ),
              contextValues: {'fileId': record['fileId']},
            ),
            icon: const Icon(Icons.download),
            label: Text(tr(context, 'download')),
          ),
        if (edit != null)
          FilledButton.icon(
            onPressed: () => run(edit),
            icon: const Icon(Icons.edit_outlined),
            label: Text(tr(context, edit.id)),
          ),
        const SizedBox(height: 12),
        for (final area in areas)
          Card(
            child: ExpansionTile(
              title: Text(formLabel(context, area)),
              leading: Icon(featureIcon(area)),
              children: [
                for (final op in ops.where(
                  (o) =>
                      o != edit &&
                      !workflowDestructive(o) &&
                      workflowArea(o) == area,
                ))
                  ListTile(
                    title: Text(tr(context, op.id)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => run(op),
                  ),
              ],
            ),
          ),
        if (ops.any(workflowDestructive))
          ExpansionTile(
            title: Text(tr(context, 'sensitiveActions')),
            leading: const Icon(Icons.warning_amber_outlined),
            children: [
              for (final op in ops.where(workflowDestructive))
                ListTile(title: Text(tr(context, op.id)), onTap: () => run(op)),
            ],
          ),
      ],
    );
  }
}

class WorkflowOutput extends StatelessWidget {
  const WorkflowOutput({
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
    if (operation.group == 'reports' && object(value)['rows'] is List) {
      return FeatureResult(
        value: value,
        operation: operation,
        contextValues: contextValues,
      );
    }
    final kind = operation.group == 'reports' && object(value)['id'] != null
        ? 'exportJobId'
        : workflowResultKind(operation.path);
    final group = kind == 'exportJobId' ? 'exports' : operation.group;
    final inherited = {
      ...contextValues,
      for (final p in operation.parameters.where((p) => p['in'] == 'path'))
        if (contextValues[p['name']] != null)
          workflowReference(p['name'], operation.path):
              contextValues[p['name']],
    };
    final list = value is List || object(value)['data'] is List
        ? records(value)
        : <Json>[object(value)];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (list.isEmpty) const EmptyView(),
        for (final raw in list)
          if (raw.isNotEmpty)
            if (workflowRow(kind, raw)[workflowRecordKey(kind)] != null)
              WorkflowRecordCard(
                row: workflowRow(kind, raw),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => WorkflowRecordPage(
                      group: group,
                      kind: kind,
                      record: workflowRow(kind, raw),
                      contextValues: inherited,
                    ),
                  ),
                ),
              )
            else
              WorkflowRecordSummary(record: raw),
        if (list.every((r) => r.isEmpty))
          Text(displayValue(context, '', value)),
      ],
    );
  }
}

import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'resources.dart';
import 'features.dart';
import '../core/features.dart';
import 'workflows.dart';
import 'workflow_task.dart';

class ChildrenPage extends StatefulWidget {
  const ChildrenPage({super.key, this.select = false, this.lookupPermission});
  final bool select;
  final String? lookupPermission;
  @override
  State<ChildrenPage> createState() => _ChildrenPageState();
}

class _ChildrenPageState extends State<ChildrenPage> {
  List<Json>? rows;
  Object? error;
  String search = '';
  int page = 1, total = 0, generation = 0;
  Timer? debounce;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (generation == 0) load();
  }

  @override
  void dispose() {
    debounce?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    final request = ++generation;
    try {
      final data = object(
        await AppScope.of(context).api.request(
          widget.lookupPermission == null ? '/children' : '/lookups/children',
          query: {
            'q': search,
            'page': page,
            'limit': 30,
            if (widget.lookupPermission != null)
              'permission': widget.lookupPermission,
          },
        ),
      );
      if (mounted && request == generation) {
        setState(() {
          rows = records(data);
          total =
              (object(data['meta'])['total'] as num?)?.toInt() ?? rows!.length;
          error = null;
        });
      }
    } catch (e) {
      if (mounted && request == generation) setState(() => error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = Column(
      children: [
        if (!widget.select && AppScope.of(context).can('child:create'))
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
            child: FilledButton.icon(
              onPressed: () async {
                final catalog = await FeatureCatalog.load();
                if (!context.mounted) return;
                await openWorkflowTask(
                  context,
                  catalog,
                  catalog.operations.firstWhere(
                    (o) => o.id == 'ChildrenController_create',
                  ),
                );
                if (mounted) load();
              },
              icon: const Icon(Icons.person_add_alt),
              label: Text(tr(context, 'ChildrenController_create')),
            ),
          ),
        Padding(
          padding: const EdgeInsets.all(20),
          child: TextField(
            onChanged: (v) {
              debounce?.cancel();
              search = v;
              page = 1;
              generation++;
              setState(() {
                rows = null;
                error = null;
              });
              debounce = Timer(const Duration(milliseconds: 350), load);
            },
            decoration: InputDecoration(
              hintText: tr(context, 'search'),
              prefixIcon: const Icon(Icons.search),
            ),
          ),
        ),
        Expanded(
          child: error != null
              ? FailureView(error!, load)
              : rows == null
              ? const Center(child: CircularProgressIndicator.adaptive())
              : RefreshIndicator(
                  onRefresh: load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    children: [
                      if (rows!.isEmpty) const EmptyView(),
                      ...rows!.map(
                        (child) => Card(
                          child: ListTile(
                            contentPadding: const EdgeInsets.all(14),
                            leading: PrivateAvatar(
                              name: childName(child),
                              fileId: child['photoFileId'] as String?,
                            ),
                            title: Text(
                              childName(child),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            subtitle: widget.lookupPermission != null
                                ? null
                                : Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: Text(
                                      (child['groupName'] ??
                                              tr(
                                                context,
                                                child['status']?.toString() ??
                                                    'pending',
                                              ))
                                          .toString(),
                                    ),
                                  ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () {
                              if (widget.select) {
                                Navigator.pop(context, child);
                              } else {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                    builder: (_) => ChildPage(
                                      id: child['id'].toString(),
                                      name: childName(child),
                                    ),
                                  ),
                                );
                              }
                            },
                          ),
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          IconButton(
                            tooltip: tr(context, 'previous'),
                            onPressed: page > 1
                                ? () {
                                    setState(() {
                                      page--;
                                      rows = null;
                                    });
                                    load();
                                  }
                                : null,
                            icon: const Icon(Icons.chevron_left),
                          ),
                          Text('${tr(context, 'page')} $page'),
                          IconButton(
                            tooltip: tr(context, 'next'),
                            onPressed: page * 30 < total
                                ? () {
                                    setState(() {
                                      page++;
                                      rows = null;
                                    });
                                    load();
                                  }
                                : null,
                            icon: const Icon(Icons.chevron_right),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
        ),
      ],
    );
    return widget.select
        ? Scaffold(
            appBar: AppBar(title: Text(tr(context, 'children'))),
            body: body,
          )
        : body;
  }
}

class ChildPage extends StatefulWidget {
  const ChildPage({super.key, required this.id, required this.name});
  final String id, name;
  @override
  State<ChildPage> createState() => _ChildPageState();
}

class _ChildPageState extends State<ChildPage> {
  Json? child;
  Object? error;
  bool started = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      load();
    }
  }

  Future<void> load() async {
    try {
      final data = object(
        await AppScope.of(context).api.request('/children/${widget.id}'),
      );
      if (mounted) {
        setState(() {
          child = data;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.name),
        actions: [
          IconButton(
            tooltip: tr(context, 'recordActions'),
            icon: const Icon(Icons.more_horiz),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute<void>(
                builder: (_) => FeatureWorkspace(
                  contextValues: {'id': widget.id, 'childId': widget.id},
                  initialRecord: child ?? {},
                  recordGroup: 'children',
                ),
              ),
            ),
          ),
        ],
      ),
      body: error != null
          ? FailureView(error!, load)
          : child == null
          ? const Center(child: CircularProgressIndicator.adaptive())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        children: [
                          PrivateAvatar(
                            name: widget.name,
                            fileId: child!['photoFileId'] as String?,
                            size: 96,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            widget.name,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 12),
                          StatusPill(child!['status']?.toString() ?? 'pending'),
                          const SizedBox(height: 20),
                          detail(
                            context,
                            'birthDate',
                            dateText(child!['birthDate']),
                          ),
                          detail(
                            context,
                            'group',
                            (child!['groupName'] ?? '—').toString(),
                          ),
                        ],
                      ),
                    ),
                  ),
                  FutureBuilder<FeatureCatalog>(
                    future: FeatureCatalog.load(),
                    builder: (context, snapshot) => snapshot.hasData
                        ? WorkflowRecordActions(
                            group: 'children',
                            kind: 'childId',
                            record: child!,
                            contextValues: {'childId': widget.id},
                            catalog: snapshot.data!,
                            onChanged: load,
                          )
                        : const SizedBox.shrink(),
                  ),
                  for (final module in [
                    ResourceSpec(
                      'guardians',
                      '/children/${widget.id}/guardians',
                      'child:read',
                      Icons.family_restroom,
                      ['fullName', 'phone', 'relationship'],
                    ),
                    ResourceSpec(
                      'medical',
                      '/children/${widget.id}/medical',
                      'medical:read',
                      Icons.health_and_safety_outlined,
                      [
                        'bloodType',
                        'chronicConditions',
                        'emergencyInstructions',
                        'note',
                      ],
                      singleton: true,
                    ),
                    if (!session.can('medical:read'))
                      ResourceSpec(
                        'medical',
                        '/children/${widget.id}/medical/alerts',
                        'medical:alerts',
                        Icons.health_and_safety_outlined,
                        ['allergies', 'emergencyInstructions'],
                        singleton: true,
                      ),
                    ResourceSpec(
                      'documents',
                      '/children/${widget.id}/documents',
                      'child:read',
                      Icons.description_outlined,
                      ['type', 'number', 'expiresAt'],
                    ),
                    ResourceSpec(
                      'charges',
                      '/children/${widget.id}/charge-ledger',
                      'charge:read',
                      Icons.receipt_long,
                      ['description', 'amountTiyin', 'issuedAt', 'sign'],
                    ),
                  ])
                    if (session.can(module.permission))
                      Card(
                        child: ListTile(
                          leading: Icon(module.icon),
                          title: Text(tr(context, module.title)),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute<void>(
                              builder: (_) => ResourcePage(spec: module),
                            ),
                          ),
                        ),
                      ),
                ],
              ),
            ),
    );
  }
}

Widget detail(BuildContext context, String label, String value) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 7),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: Text(
          tr(context, label),
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ),
      const SizedBox(width: 12),
      Flexible(
        child: Text(
          value,
          textAlign: TextAlign.end,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
    ],
  ),
);

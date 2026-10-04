import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'features.dart';
import 'reference_picker.dart';
import 'reference_field.dart';

class GroupsPage extends StatefulWidget {
  const GroupsPage({super.key, this.catalog});
  final FeatureCatalog? catalog;
  @override
  State<GroupsPage> createState() => _GroupsPageState();
}

class _GroupsPageState extends State<GroupsPage> {
  List<Json>? groups;
  Object? error;
  String search = '';
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
      final data = records(await AppScope.of(context).api.request('/groups'));
      if (mounted) {
        setState(() {
          groups = data;
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
        title: Text(tr(context, 'groups')),
        actions: [
          IconButton(
            tooltip: tr(context, 'recordActions'),
            icon: const Icon(Icons.more_horiz),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) =>
                    FeatureWorkspace(group: 'groups', catalog: widget.catalog),
              ),
            ),
          ),
        ],
      ),
      body: !session.can('group:read')
          ? Center(child: Text(tr(context, 'FORBIDDEN')))
          : error != null
          ? FailureView(error!, load)
          : groups == null
          ? const Center(child: CircularProgressIndicator.adaptive())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  Text(
                    tr(context, 'groupsHint'),
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    onChanged: (v) =>
                        setState(() => search = v.trim().toLowerCase()),
                    decoration: InputDecoration(
                      hintText: tr(context, 'searchByName'),
                      prefixIcon: const Icon(Icons.search),
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (!groups!.any(
                    (g) => referenceTitle(
                      context,
                      g,
                    ).toLowerCase().contains(search),
                  ))
                    const EmptyView(),
                  for (final group in groups!.where(
                    (g) => referenceTitle(
                      context,
                      g,
                    ).toLowerCase().contains(search),
                  ))
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              referenceTitle(context, group),
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${tr(context, 'children')}: ${group['currentCount'] ?? '—'} / ${group['capacity'] ?? '—'}',
                            ),
                            const SizedBox(height: 14),
                            Wrap(
                              spacing: 10,
                              runSpacing: 8,
                              children: [
                                FilledButton.tonalIcon(
                                  icon: const Icon(Icons.badge_outlined),
                                  label: Text(tr(context, 'groupStaff')),
                                  onPressed: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          GroupStaffPage(group: group),
                                    ),
                                  ),
                                ),
                                OutlinedButton.icon(
                                  icon: const Icon(Icons.child_care),
                                  label: Text(tr(context, 'children')),
                                  onPressed: () async {
                                    await Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) =>
                                            GroupChildrenPage(group: group),
                                      ),
                                    );
                                    if (mounted) load();
                                  },
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

class GroupStaffPage extends StatefulWidget {
  const GroupStaffPage({super.key, this.group});
  final Json? group;
  @override
  State<GroupStaffPage> createState() => _GroupStaffPageState();
}

class _GroupStaffPageState extends State<GroupStaffPage> {
  static const slots = {
    'mainTeacherId': 'mainTeacher',
    'assistantTeacherId': 'assistant',
    'nurseId': 'nurse',
  };
  int loadGeneration = 0;
  Json? group;
  Json original = {}, assigned = {};
  Object? error;
  bool started = false, loading = false, saving = false, leaving = false;
  Json get changes => {
    for (final key in slots.keys)
      if (assigned[key] != original[key]) key: assigned[key],
  };
  bool get dirty => changes.isNotEmpty;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      group = widget.group;
      if (group != null) load();
    }
  }

  Future<void> load() async {
    final ticket = ++loadGeneration;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = object(
        await AppScope.of(context).api.request(
          '/groups/${Uri.encodeComponent(group!['id'].toString())}/staff',
        ),
      );
      if (!mounted || ticket != loadGeneration) return;
      final session = AppScope.of(context);
      final next = <String, dynamic>{};
      for (final slot in slots.entries) {
        final person = object(data[slot.value]);
        session.rememberReference('userId', person);
        next[slot.key] = person['id'];
      }
      setState(() {
        original = next;
        assigned = {...next};
        loading = false;
      });
    } catch (e) {
      if (mounted && ticket == loadGeneration) {
        setState(() {
          error = e;
          loading = false;
        });
      }
    }
  }

  Future<void> chooseGroup() async {
    if (dirty &&
        !await confirm(
          context,
          tr(context, 'cancel'),
          tr(context, 'discard'),
        )) {
      return;
    }
    if (!mounted) return;
    final selected = await Navigator.push<Json>(
      context,
      MaterialPageRoute(
        builder: (_) =>
            ReferencePicker(path: '/groups', title: tr(context, 'chooseGroup')),
      ),
    );
    if (selected != null && mounted) {
      setState(() {
        group = selected;
        original = {};
        assigned = {};
      });
      await load();
    }
  }

  Future<void> save() async {
    final session = AppScope.of(context);
    if (saving || !dirty || !session.can('group:manage')) return;
    final body = changes;
    final review = [
      referenceTitle(context, group!),
      for (final entry in body.entries)
        '${tr(context, entry.key)}: ${entry.value == null ? tr(context, 'notAssigned') : referenceTitle(context, session.references['userId']?[entry.value] ?? {})}',
    ].join('\n');
    if (!await confirm(context, tr(context, 'saveGroupStaff'), review) ||
        !mounted) {
      return;
    }
    setState(() => saving = true);
    try {
      await session.api.request(
        '/groups/${Uri.encodeComponent(group!['id'].toString())}/staff',
        method: 'PUT',
        data: body,
      );
      if (!mounted) return;
      // The mutation succeeded even if a subsequent refresh is unavailable.
      setState(() => original = {...assigned});
      toast(context, tr(context, 'saved'));
      await load();
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    final editable = session.can('group:manage') && !saving && !loading;
    return PopScope(
      canPop: leaving || (!dirty && !saving),
      onPopInvokedWithResult: (popped, _) async {
        if (popped || saving) return;
        if (await confirm(
              context,
              tr(context, 'cancel'),
              tr(context, 'discard'),
            ) &&
            mounted) {
          setState(() => leaving = true);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) Navigator.pop(context);
          });
        }
      },
      child: Scaffold(
        appBar: AppBar(title: Text(tr(context, 'groupStaff'))),
        bottomNavigationBar:
            group == null ||
                error != null ||
                loading ||
                !session.can('group:manage')
            ? null
            : SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton.icon(
                    onPressed: saving || !dirty ? null : save,
                    icon: const Icon(Icons.check),
                    label: Text(
                      tr(context, saving ? 'saving' : 'saveGroupStaff'),
                    ),
                  ),
                ),
              ),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(tr(context, 'groupStaffHint')),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.groups_outlined),
                title: Text(
                  group == null
                      ? tr(context, 'chooseGroup')
                      : referenceTitle(context, group!),
                ),
                trailing: const Icon(Icons.expand_more),
                onTap: saving ? null : chooseGroup,
              ),
            ),
            if (loading)
              const Center(child: CircularProgressIndicator.adaptive())
            else if (error != null)
              FailureView(error!, load)
            else if (group != null) ...[
              if (editable && !session.can('user:manage'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(tr(context, 'staffSelectionUnavailable')),
                ),
              for (final slot in slots.keys)
                Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: ReferenceField(
                          name: slot,
                          label: tr(context, slot),
                          value: assigned[slot],
                          enabled: editable && session.can('user:manage'),
                          onChanged: (v) => setState(() => assigned[slot] = v),
                        ),
                      ),
                      if (assigned[slot] != null && editable)
                        IconButton(
                          tooltip: tr(context, 'removeAssignment'),
                          icon: const Icon(Icons.person_remove_outlined),
                          onPressed: () =>
                              setState(() => assigned[slot] = null),
                        ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class GroupChildrenPage extends StatefulWidget {
  const GroupChildrenPage({super.key, required this.group});
  final Json group;
  @override
  State<GroupChildrenPage> createState() => _GroupChildrenPageState();
}

class _GroupChildrenPageState extends State<GroupChildrenPage> {
  List<Json>? children;
  Object? error;
  bool started = false, busy = false;
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
      final data = records(
        await AppScope.of(context).api.request(
          '/groups/${Uri.encodeComponent(widget.group['id'].toString())}/children',
        ),
      );
      if (mounted) {
        setState(() {
          children = data;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  Future<void> assign() async {
    final session = AppScope.of(context);
    final source = referenceSource(session, 'childId');
    if (source == null || busy || !session.can('group:manage')) return;
    final child = await Navigator.push<Json>(
      context,
      MaterialPageRoute(
        builder: (_) => ReferencePicker(
          path: source.$1,
          query: source.$2,
          title: tr(context, 'chooseChild'),
        ),
      ),
    );
    if (child == null || !mounted) return;
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(today()),
      firstDate: DateTime(2000),
      lastDate: DateTime(2200),
      helpText: tr(context, 'effectiveDate'),
    );
    if (date == null || !mounted) return;
    final day = date.toIso8601String().substring(0, 10);
    if (!await confirm(
          context,
          tr(context, 'assignToGroup'),
          '${referenceTitle(context, child)} → ${referenceTitle(context, widget.group)}\n${dateText(day)}',
        ) ||
        !mounted) {
      return;
    }
    setState(() => busy = true);
    try {
      await session.api.request(
        '/groups/${Uri.encodeComponent(widget.group['id'].toString())}/children',
        method: 'POST',
        data: {'childId': child['id'], 'effectiveDate': day},
      );
      if (!mounted) return;
      toast(context, tr(context, 'saved'));
      await load();
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(referenceTitle(context, widget.group))),
      bottomNavigationBar: !session.can('group:manage')
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton.icon(
                  onPressed: busy || referenceSource(session, 'childId') == null
                      ? null
                      : assign,
                  icon: const Icon(Icons.person_add_alt),
                  label: Text(tr(context, 'assignToGroup')),
                ),
              ),
            ),
      body: error != null
          ? FailureView(error!, load)
          : children == null
          ? const Center(child: CircularProgressIndicator.adaptive())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  Text(tr(context, 'groupChildrenHint')),
                  const SizedBox(height: 16),
                  if (children!.isEmpty) const EmptyView(),
                  for (final child in children!)
                    Card(
                      child: ListTile(
                        leading: PersonAvatar(childName(child)),
                        title: Text(childName(child)),
                        subtitle: Text(referenceSubtitle(context, child)),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

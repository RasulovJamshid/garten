import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'absence_form.dart';

String attendanceStatus(Json row) {
  final attendance = object(row['attendance']);
  if (attendance['checkOutAt'] != null) return 'left';
  if (attendance['checkInAt'] != null) return 'inside';
  return attendance['status']?.toString() ?? 'pending';
}

class AttendancePage extends StatefulWidget {
  const AttendancePage({super.key});
  @override
  State<AttendancePage> createState() => _AttendancePageState();
}

class _AttendancePageState extends State<AttendancePage> {
  List<Json>? rows;
  Object? error;
  String? groupId;
  String search = '', filter = 'total';
  final pending = <String>{};
  int generation = 0;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (rows == null && error == null && generation == 0) load();
  }

  Future<void> load() async {
    final request = ++generation;
    try {
      final data = await AppScope.of(context).api.request(
        '/attendance/board',
        query: {if (groupId != null) 'groupId': groupId},
      );
      if (mounted && request == generation) {
        setState(() {
          rows = records(data);
          error = null;
        });
      }
    } catch (e) {
      if (mounted && request == generation) setState(() => error = e);
    }
  }

  Future<void> checkIn(Json row) async {
    final id = object(row['child'])['id'].toString();
    if (pending.contains(id)) return;
    setState(() => pending.add(id));
    try {
      await AppScope.of(context).api.request(
        '/attendance/check-in',
        method: 'POST',
        data: {'childId': id},
      );
      await load();
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => pending.remove(id));
    }
  }

  Future<void> markAbsence(Json row) async {
    final result = await showModalBottomSheet<Json>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const AbsenceForm(),
    );
    if (result == null || !mounted) return;
    final id = object(row['child'])['id'].toString();
    setState(() => pending.add(id));
    try {
      await AppScope.of(context).api.request(
        '/attendance/status',
        method: 'POST',
        data: {'childId': id, 'date': today(), ...result},
      );
      await load();
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => pending.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    if (!session.can('attendance:read')) {
      return Center(child: Text(tr(context, 'FORBIDDEN')));
    }
    if (error != null) return FailureView(error!, load);
    if (rows == null) {
      return const Center(child: CircularProgressIndicator.adaptive());
    }
    final visible = rows!
        .where(
          (r) =>
              childName(
                object(r['child']),
              ).toLowerCase().contains(search.toLowerCase()) &&
              (filter == 'total' || attendanceStatus(r) == filter),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            dateText(today()),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            onChanged: (v) => setState(() => search = v),
            decoration: InputDecoration(
              hintText: tr(context, 'search'),
              prefixIcon: const Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: groupId ?? '',
            isExpanded: true,
            decoration: InputDecoration(labelText: tr(context, 'group')),
            items: [
              DropdownMenuItem(
                value: '',
                child: Text(tr(context, 'allGroups')),
              ),
              ...session.groups.map(
                (g) => DropdownMenuItem(
                  value: g['id'].toString(),
                  child: Text(g['name'].toString()),
                ),
              ),
            ],
            onChanged: (v) {
              setState(() {
                groupId = v == '' ? null : v;
              });
              load();
            },
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: ['total', 'pending', 'inside', 'left']
                .map(
                  (s) => FilterChip(
                    selected: filter == s,
                    label: Text(
                      '${tr(context, s)} · ${s == 'total' ? rows!.length : rows!.where((r) => attendanceStatus(r) == s).length}',
                    ),
                    onSelected: (_) => setState(() => filter = s),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 16),
          if (visible.isEmpty) const EmptyView(),
          ...visible.map((row) {
            final child = object(row['child']);
            final name = childName(child);
            final status = attendanceStatus(row);
            final busy = pending.contains(child['id']);
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        PrivateAvatar(
                          name: name,
                          fileId: child['photoFileId'] as String?,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            name,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        StatusPill(status),
                      ],
                    ),
                    if ((session.can('attendance:checkin') &&
                            !['inside', 'left'].contains(status)) ||
                        (session.can('attendance:checkout') &&
                            session.can('pickup:read') &&
                            status == 'inside')) ...[
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.tonal(
                          onPressed: busy
                              ? null
                              : () async {
                                  if (status == 'inside') {
                                    final done = await Navigator.push<bool>(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) =>
                                            PickupPage(child: child),
                                      ),
                                    );
                                    if (done == true && mounted) await load();
                                  } else {
                                    await checkIn(row);
                                  }
                                },
                          child: busy
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(
                                  tr(
                                    context,
                                    status == 'inside' ? 'checkOut' : 'checkIn',
                                  ),
                                ),
                        ),
                      ),
                    ],
                    if (session.can('attendance:checkin') &&
                        !['inside', 'left'].contains(status))
                      TextButton(
                        onPressed: busy ? null : () => markAbsence(row),
                        child: Text(tr(context, 'absent')),
                      ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

class PickupPage extends StatefulWidget {
  const PickupPage({super.key, required this.child});
  final Json child;
  @override
  State<PickupPage> createState() => _PickupPageState();
}

class _PickupPageState extends State<PickupPage> {
  List<Json>? permissions;
  Object? error;
  bool busy = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (permissions == null && error == null && !busy) load();
  }

  Future<void> load() async {
    busy = true;
    try {
      final data = await AppScope.of(context).api.request(
        '/pickup-permissions/active',
        query: {'childId': widget.child['id']},
      );
      if (mounted) {
        setState(() {
          permissions = records(data);
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> release(Json permission) async {
    setState(() => busy = true);
    try {
      final api = AppScope.of(context).api;
      final payload = {
        'childId': widget.child['id'],
        'pickupPermissionId': permission['id'],
      };
      final verdict = object(
        await api.request('/pickup/verify', query: payload),
      );
      if (!mounted) return;
      if (verdict['allowed'] != true) {
        toast(context, tr(context, 'notAllowed'));
        return;
      }
      final name =
          verdict['pickupName'] ??
          object(permission['pickupPerson'])['fullName'] ??
          permission['adhocFullName'] ??
          '';
      if (!await confirm(
        context,
        tr(context, 'checkOut'),
        '${childName(widget.child)}\n$name\n\n${tr(context, 'identityCheck')}',
      )) {
        return;
      }
      await api.request('/attendance/check-out', method: 'POST', data: payload);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr(context, 'checkOut'))),
    body: error != null
        ? FailureView(error!, load)
        : permissions == null
        ? const Center(child: CircularProgressIndicator.adaptive())
        : ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text(
                childName(widget.child),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              SectionTitle(tr(context, 'pickupPerson')),
              if (permissions!.isEmpty) const EmptyView(),
              ...permissions!.map((p) {
                final person = object(p['pickupPerson']);
                final name = (person['fullName'] ?? p['adhocFullName'] ?? '—')
                    .toString();
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: PrivateAvatar(
                            name: name,
                            fileId: person['photoFileId'] as String?,
                          ),
                          title: Text(name),
                          subtitle: Text(
                            (person['phone'] ?? p['adhocPhone'] ?? '')
                                .toString(),
                          ),
                        ),
                        FilledButton.tonal(
                          onPressed: busy ? null : () => release(p),
                          child: Text(tr(context, 'verify')),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ],
          ),
  );
}

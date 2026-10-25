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
  final searchController = TextEditingController();
  bool refreshing = false;
  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  bool matchesStatus(Json row, String value) =>
      value == 'total' ||
      (value == 'away'
          ? [
              'absent',
              'sick',
              'vacation',
              'excused',
            ].contains(attendanceStatus(row))
          : attendanceStatus(row) == value);
  final pending = <String>{};
  int generation = 0, revision = 0;
  final updates = <String, (int, Json)>{};
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (rows == null && error == null && generation == 0) load();
  }

  Future<void> load() async {
    final request = ++generation;
    final startedRevision = revision;
    setState(() => refreshing = true);
    try {
      final data = await AppScope.of(context).api.request(
        '/attendance/board',
        query: {if (groupId != null) 'groupId': groupId},
      );
      if (mounted && request == generation) {
        setState(() {
          rows = records(data).map((row) {
            final update = updates[object(row['child'])['id']];
            return update != null && update.$1 > startedRevision
                ? <String, dynamic>{...row, 'attendance': update.$2}
                : row;
          }).toList();
          updates.removeWhere((_, update) => update.$1 <= startedRevision);
          error = null;
        });
      }
    } catch (e) {
      if (mounted && request == generation) setState(() => error = e);
    } finally {
      if (mounted && request == generation) setState(() => refreshing = false);
    }
  }

  void updateAttendance(String childId, dynamic response) {
    if (!mounted) return;
    final attendance = object(response);
    if (attendance['childId'] != childId) {
      throw const ApiFailure('INVALID_RESPONSE');
    }
    updates[childId] = (++revision, attendance);
    setState(() {
      rows = rows
          ?.map(
            (row) => object(row['child'])['id'] == childId
                ? <String, dynamic>{...row, 'attendance': attendance}
                : row,
          )
          .toList();
    });
  }

  Future<void> checkIn(Json row) async {
    final id = object(row['child'])['id'].toString();
    if (pending.contains(id)) return;
    setState(() => pending.add(id));
    try {
      final updated = await AppScope.of(context).api.request(
        '/attendance/check-in',
        method: 'POST',
        data: {'childId': id},
      );
      updateAttendance(id, updated);
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
      builder: (_) => AbsenceForm(childName: childName(object(row['child']))),
    );
    if (result == null || !mounted) return;
    final id = object(row['child'])['id'].toString();
    setState(() => pending.add(id));
    try {
      final updated = await AppScope.of(context).api.request(
        '/attendance/status',
        method: 'POST',
        data: {'childId': id, 'date': today(), ...result},
      );
      updateAttendance(id, updated);
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
              matchesStatus(r, filter),
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
                rows = [];
                error = null;
              });
              load();
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: searchController,
            onChanged: (v) => setState(() => search = v.trim()),
            decoration: InputDecoration(
              hintText: tr(context, 'attendanceSearch'),
              prefixIcon: const Icon(Icons.search),
              suffixIcon: search.isEmpty
                  ? null
                  : IconButton(
                      tooltip: tr(context, 'clearSearch'),
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        searchController.clear();
                        setState(() => search = '');
                      },
                    ),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: ['total', 'pending', 'inside', 'away', 'left']
                .map(
                  (s) => FilterChip(
                    selected: filter == s,
                    label: Text(
                      '${tr(context, s == 'pending'
                          ? 'arrivalQueue'
                          : s == 'inside'
                          ? 'departureQueue'
                          : s == 'away'
                          ? 'absences'
                          : s)} · ${s == 'total' ? rows!.length : rows!.where((r) => matchesStatus(r, s)).length}',
                    ),
                    onSelected: (_) => setState(() => filter = s),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 16),
          if (refreshing) const LinearProgressIndicator(),
          if (!refreshing && visible.isNotEmpty) ...[
            Text(
              tr(context, filter == 'inside' ? 'pickupHelp' : 'attendanceHelp'),
            ),
            const SizedBox(height: 12),
          ],
          if (visible.isEmpty && !refreshing)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  tr(
                    context,
                    search.isNotEmpty
                        ? 'attendanceNoMatch'
                        : rows!.isEmpty
                        ? 'attendanceNoScopedChildren'
                        : filter == 'pending'
                        ? 'arrivalsComplete'
                        : filter == 'inside'
                        ? 'attendanceNobodyInside'
                        : filter == 'left'
                        ? 'attendanceNobodyLeft'
                        : filter == 'away'
                        ? 'attendanceNobodyAbsent'
                        : 'attendanceEmpty',
                  ),
                ),
              ),
            ),
          ...visible.map((row) {
            final child = object(row['child']);
            final name = childName(child);
            final status = attendanceStatus(row);
            final busy = refreshing || pending.contains(child['id'].toString());
            return Card(
              key: ValueKey<String>(child['id'].toString()),
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
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 6),
                              StatusPill(status),
                              if (object(child['group'])['name'] != null)
                                Text(object(child['group'])['name'].toString()),
                            ],
                          ),
                        ),
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
                                    final done = await Navigator.push<Json>(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) =>
                                            PickupPage(child: child),
                                      ),
                                    );
                                    if (done != null && mounted) {
                                      updateAttendance(
                                        child['id'].toString(),
                                        done,
                                      );
                                    }
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
                        child: Text(tr(context, 'markAbsence')),
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
  List<Json> guardians = [];
  Object? guardianError;
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
      final api = AppScope.of(context).api;
      try {
        guardians = records(
          await api.request(
            '/lookups/children/${widget.child['id']}/pickup-guardians',
            query: {'permission': 'pickup:read'},
          ),
        );
        guardianError = null;
      } catch (e) {
        guardianError = e;
      }
      final data = await api.request(
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

  Future<void> release(Json permission, {bool guardian = false}) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final api = AppScope.of(context).api;
      final payload = {
        'childId': widget.child['id'],
        if (guardian)
          'guardianId': permission['id']
        else
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
      final updated = object(
        await api.request(
          '/attendance/check-out',
          method: 'POST',
          data: payload,
        ),
      );
      if (mounted) Navigator.pop(context, updated);
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
              SectionTitle(tr(context, 'childGuardians')),
              if (guardianError != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        Text(tr(context, 'pickupGuardiansUnavailable')),
                        TextButton(
                          onPressed: busy ? null : load,
                          child: Text(tr(context, 'retry')),
                        ),
                      ],
                    ),
                  ),
                ),
              if (guardians.isEmpty && guardianError == null)
                Text(tr(context, 'noLinkedGuardians')),
              ...guardians.map(
                (g) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.family_restroom),
                          title: Text(g['fullName'].toString()),
                          subtitle: Text(
                            [
                              tr(
                                context,
                                g['relationship']?.toString() ?? 'guardian',
                              ),
                              g['phone'],
                            ].whereType<String>().join(' · '),
                          ),
                        ),
                        FilledButton.tonal(
                          onPressed: busy
                              ? null
                              : () => release(g, guardian: true),
                          child: Text(tr(context, 'verify')),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              SectionTitle(tr(context, 'pickupPerson')),
              if (permissions!.isEmpty) Text(tr(context, 'noAdditionalPickup')),

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

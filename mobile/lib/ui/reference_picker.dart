import 'dart:async';
import 'package:dio/dio.dart';
import 'package:file_selector/file_selector.dart';
import 'features.dart' show multipartFile;
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'schema_form.dart' show displayValue, formLabel;

String referenceTitle(BuildContext context, Json row) {
  final language = AppScope.of(context).language;
  for (final key in [
    'fullName',
    'adhocFullName',
    'name',
    language == 'ru' ? 'nameRu' : 'nameUz',
    'nameUz',
    'nameRu',
    'title',
    'originalName',
    'description',
  ]) {
    final text = row[key]?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  if (object(row['pickupPerson']).isNotEmpty) {
    return referenceTitle(context, object(row['pickupPerson']));
  }
  final child = childName(row).isNotEmpty
      ? childName(row)
      : childName(object(row['child']));
  if (child.isNotEmpty) return child;
  if (row['year'] != null && row['month'] != null) {
    return '${row['month']}/${row['year']}';
  }
  if (row['version'] != null) {
    return '${tr(context, 'version')} ${row['version']}';
  }
  for (final key in [
    'receiptNo',
    'templateKey',
    'code',
    'key',
    'kind',
    'type',
    'consentType',
    'action',
    'status',
  ]) {
    if (row[key] != null) return tr(context, row[key].toString());
  }
  return tr(context, 'record');
}

String referenceSubtitle(BuildContext context, Json row) {
  final session = AppScope.of(context);
  final details = <String>[];
  void add(dynamic value) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty &&
        text != referenceTitle(context, row) &&
        !details.contains(text)) {
      details.add(text);
    }
  }

  void field(String key, dynamic value) {
    if (value != null && value.toString().isNotEmpty) {
      add('${formLabel(context, key)}: ${displayValue(context, key, value)}');
    }
  }

  add(row['phone']);
  add(row['email']);
  add(row['groupName'] ?? object(row['group'])['name']);
  for (final assignment in records(
    row['groupAssignment'] ?? row['groupAssignments'],
  )) {
    add(object(assignment['group'])['name']);
  }
  final branch =
      row['branchName'] ??
      object(row['branch'])['name'] ??
      session.branches
          .where((b) => b['id'] == row['branchId'])
          .firstOrNull?['name'];
  if (branch != null) field('branch', branch);
  if (childName(object(row['child'])).isNotEmpty) {
    add(childName(object(row['child'])));
  }
  final period = object(row['accountingPeriod'] ?? row['period']);
  final year = row['billingYear'] ?? row['year'] ?? period['year'];
  final month = row['billingMonth'] ?? row['month'] ?? period['month'];
  if (year != null && month != null) add('$month/$year');
  for (final key in [
    'type',
    'kind',
    'channel',
    'receiptNo',
    'birthDate',
    'dueDate',
    'paidAt',
    'date',
    'createdAt',
    'queuedAt',
    'sentAt',
    'occurredAt',
    'issuedAt',
  ]) {
    field(key, row[key]);
  }
  if (row['amountTiyin'] != null) add(money(row['amountTiyin']));
  for (final key in ['recipient', 'guardian', 'user', 'actor']) {
    final related = object(row[key]);
    if (related.isNotEmpty) add(referenceTitle(context, related));
  }
  for (final key in [
    'recipientId',
    'recipientGuardianId',
    'recipientUserId',
    'guardianId',
    'userId',
  ]) {
    final id = row[key]?.toString();
    final kind = ['recipientId', 'recipientGuardianId'].contains(key)
        ? 'guardianId'
        : key == 'recipientUserId'
        ? 'userId'
        : key;
    final related = session.references[kind]?[id];
    if (related != null) {
      add(referenceTitle(context, related));
    } else if (id != null) {
      field(kind, id.length > 8 ? id.substring(0, 8) : id);
    }
  }
  field('entityType', row['entityType']);
  field('childCount', row['childCount']);
  if (row['status'] != null) add(tr(context, row['status'].toString()));
  // Minimal scoped lookups must not acquire extra permissions just to show context.
  if (row['id'] != null &&
      (childName(row).isNotEmpty ||
          row['fullName'] == tr(context, 'selectedRecord') ||
          details.isEmpty ||
          row['periodId'] != null)) {
    final id = row['registrationNumber']?.toString() ?? row['id'].toString();
    add(
      '${tr(context, 'recordReference')}: ${id.length > 8 ? id.substring(0, 8) : id}',
    );
  }
  return details.join(' · ');
}

class ReferencePicker extends StatefulWidget {
  const ReferencePicker({
    super.key,
    required this.path,
    this.query = const {},
    this.title,
    this.valueKey = 'id',
  });
  final String path, valueKey;
  final String? title;
  final Json query;
  @override
  State<ReferencePicker> createState() => _ReferencePickerState();
}

class _ReferencePickerState extends State<ReferencePicker> {
  final searchController = TextEditingController();
  Timer? debounce;
  List<Json>? rows;
  Object? error;
  int page = 1, request = 0;
  bool more = false, started = false, loading = false;
  String search = '';
  bool uploading = false;
  Future<void> uploadFile() async {
    final session = AppScope.of(context);
    if (uploading || !session.can('file:manage')) return;
    setState(() => uploading = true);
    try {
      final file = await openFile();
      if (file == null || !mounted) return;
      final result = object(
        await session.api.request(
          '/files',
          method: 'POST',
          data: FormData.fromMap({'file': await multipartFile(file)}),
        ),
      );
      final row = {
        ...result,
        'id': result['fileId'],
        'originalName': file.name,
      };
      if (row['id'] == null) throw const ApiFailure('INVALID_RESPONSE');
      if (!mounted) return;
      session.rememberReference('fileId', row);
      Navigator.pop(context, row);
    } catch (e) {
      if (mounted) toast(context, errorText(context, e));
    } finally {
      if (mounted) setState(() => uploading = false);
    }
  }

  bool get remoteSearch =>
      widget.path == '/lookups/children' ||
      widget.path == '/children' ||
      widget.path == '/guardians';
  List<Json>? cached(Session session) => switch (widget.path) {
    final path when path.startsWith('@recent/') =>
      session.references[path.substring(8)]?.values.toList() ?? [],
    '/branches' when !session.can('branch:manage') => session.branches,
    '/groups' when !session.can('group:read') => session.groups,
    _ => null,
  };

  Future<void> load({bool append = false}) async {
    final ticket = ++request;
    final session = AppScope.of(context);
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final local = cached(session);
      final data =
          local ??
          await session.api.request(
            widget.path,
            query: {
              ...widget.query,
              'page': page,
              'limit': 50,
              if (remoteSearch && search.isNotEmpty) 'q': search,
            },
          );
      var values = records(data);
      if (widget.path == '/notification-templates') {
        values = values
            .map((r) => {...r, 'key': r['templateKey'] ?? r['key']})
            .toList();
      }
      if (widget.path == '/landing') values = records(object(data)['blocks']);
      final meta = object(object(data)['meta']);
      if (!mounted || ticket != request) return;
      setState(() {
        rows = append ? [...?rows, ...values] : values;
        // Bare arrays are complete lists; never infer pagination from their length.
        more = meta['pages'] is num
            ? page < meta['pages']
            : meta['total'] is num
            ? page * 50 < meta['total']
            : false;
        loading = false;
      });
    } catch (e) {
      if (mounted && ticket == request) {
        setState(() {
          error = e;
          loading = false;
        });
      }
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      load();
    }
  }

  @override
  void dispose() {
    debounce?.cancel();
    searchController.dispose();
    super.dispose();
  }

  void searchChanged(String value) {
    debounce?.cancel();
    search = value.trim();
    if (remoteSearch) {
      // Invalidate outstanding responses immediately, before the debounce fires.
      request++;
      setState(() {
        loading = true;
        rows = null;
      });
      debounce = Timer(const Duration(milliseconds: 300), () {
        page = 1;
        load();
      });
    } else {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = (rows ?? [])
        .where(
          (row) =>
              remoteSearch ||
              '${referenceTitle(context, row)} ${referenceSubtitle(context, row)}'
                  .toLowerCase()
                  .contains(search.toLowerCase()),
        )
        .toList();
    return PopScope(
      canPop: !uploading,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.title ?? tr(context, 'selectRecord')),
        ),
        bottomNavigationBar:
            widget.path == '@recent/fileId' &&
                AppScope.of(context).can('file:manage')
            ? SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton.icon(
                    onPressed: uploading ? null : uploadFile,
                    icon: uploading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.attach_file),
                    label: Text(
                      tr(context, uploading ? 'saving' : 'chooseFile'),
                    ),
                  ),
                ),
              )
            : null,
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: searchController,
                autofocus: false,
                onChanged: searchChanged,
                decoration: InputDecoration(
                  hintText: tr(context, 'searchByName'),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: search.isEmpty
                      ? null
                      : IconButton(
                          tooltip: tr(context, 'clearSearch'),
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            searchController.clear();
                            searchChanged('');
                          },
                        ),
                ),
              ),
            ),
            if (loading && rows != null) const LinearProgressIndicator(),
            Expanded(
              child: error != null && rows == null
                  ? FailureView(error!, load)
                  : rows == null
                  ? const Center(child: CircularProgressIndicator.adaptive())
                  : ListView(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      children: [
                        if (visible.isEmpty && !more) const EmptyView(),
                        for (final row in visible)
                          Card(
                            child: ListTile(
                              leading: PersonAvatar(
                                referenceTitle(context, row),
                              ),
                              title: Text(referenceTitle(context, row)),
                              subtitle: referenceSubtitle(context, row).isEmpty
                                  ? null
                                  : Text(referenceSubtitle(context, row)),
                              trailing: const Icon(Icons.chevron_right),
                              onTap:
                                  loading ||
                                      uploading ||
                                      row[widget.valueKey] == null
                                  ? null
                                  : () => Navigator.pop(context, row),
                            ),
                          ),
                        if (error != null)
                          TextButton(
                            onPressed: () => load(append: true),
                            child: Text(tr(context, 'retry')),
                          ),
                        if (more)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 24),
                            child: OutlinedButton(
                              onPressed: loading || error != null
                                  ? null
                                  : () {
                                      page++;
                                      load(append: true);
                                    },
                              child: Text(tr(context, 'loadMore')),
                            ),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

(String, Json)? referenceSource(
  Session session,
  String name, {
  Json values = const {},
}) {
  final child = values['childId'];
  if (name == 'grantedByGuardianId') {
    final permission = [
      'pickup:manage',
      'pickup:temporary',
      'pickup:read',
    ].where(session.can).firstOrNull;
    if (child == null || child == '' || permission == null) return null;
    return (
      '/lookups/children/$child/pickup-guardians',
      {'permission': permission},
    );
  }
  if (name == 'fileId' &&
      (session.can('file:manage') ||
          session.references['fileId']?.isNotEmpty == true)) {
    return ('@recent/fileId', {});
  }
  if (name == 'pickupPermissionId' &&
      child != null &&
      child != '' &&
      session.can('pickup:read')) {
    return (
      '/pickup-permissions/active',
      {'childId': child, if (values['date'] != null) 'date': values['date']},
    );
  }
  if (name == 'childId') {
    final permission = [
      'child:read',
      'payment:create',
      'charge:generate',
      'charge:read',
      'payment:read',
      'pickup:read',
      'pickup:manage',
      'pickup:temporary',
      'billing_rules:manage',
      'attendance:checkin',
    ].where(session.can).firstOrNull;
    return permission == null
        ? null
        : ('/lookups/children', {'permission': permission});
  }
  if (name == 'branchId' && session.branches.isNotEmpty) {
    return ('/branches', {});
  }
  if (['groupId', 'toGroupId'].contains(name) && session.groups.isNotEmpty) {
    return ('/groups', {});
  }
  if (name == 'payerGuardianId' &&
      child != null &&
      session.can('payment:create')) {
    return ('/lookups/children/$child/payers', {});
  }
  final nested = {
    'docId': ('documents', 'child:read'),
    'consentId': ('consents', 'consent:read'),
    'discountId': ('discounts', 'charge:read'),
    'assignmentId': ('tariffs', 'charge:read'),
    'pickupPersonId': ('pickup-persons', 'pickup:read'),
  }[name];
  if (nested != null &&
      child != null &&
      child != '' &&
      session.can(nested.$2)) {
    return ('/children/$child/${nested.$1}', {});
  }
  final entry = {
    'branchId': ('/branches', 'branch:manage'),
    'groupId': ('/groups', 'group:read'),
    'toGroupId': ('/groups', 'group:read'),
    'guardianId': ('/guardians', 'guardian:read'),
    'roleId': ('/roles', 'role:manage'),
    'userId': ('/users', 'user:manage'),
    'mainTeacherId': ('/users', 'user:manage'),
    'assistantTeacherId': ('/users', 'user:manage'),
    'nurseId': ('/users', 'user:manage'),
    'tariffId': ('/tariffs', 'charge:read'),
    'periodId': ('/periods', 'charge:read'),
    'paymentId': ('/payments', 'payment:read'),
    'chargeId': ('/charges', 'charge:read'),
    'expenseId': ('/expenses', 'expense:read'),
    'billingRunId': ('/billing-runs', 'charge:read'),
    'billingRulesId': ('/billing-rules', 'billing_rules:manage'),
    'announcementId': ('/announcements', 'announcement:manage'),
    'notificationId': ('/notifications', 'notification:read'),
    'holidayId': ('/holidays', 'holiday:manage'),
    'auditId': ('/audit', 'audit:read'),
    'attendanceDayId': ('/attendance', 'attendance:read'),
    'blockId': ('/landing', 'landing:manage'),
    'templateKey': ('/notification-templates', 'notification_template:manage'),
  }[name];
  return entry != null && session.can(entry.$2)
      ? (
          entry.$1,
          {
            if ([
              'mainTeacherId',
              'assistantTeacherId',
              'nurseId',
            ].contains(name))
              'status': 'active',
          },
        )
      : null;
}

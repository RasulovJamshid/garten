import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'editors.dart';

class ResourceSpec {
  const ResourceSpec(
    this.title,
    this.path,
    this.permission,
    this.icon,
    this.fields, {
    this.singleton = false,
  });
  final String title, path, permission;
  final IconData icon;
  final List<String> fields;
  final bool singleton;
}

const modules = [
  ResourceSpec(
    'payments',
    '/payments',
    'payment:read',
    Icons.account_balance_wallet_outlined,
    ['child', 'amountTiyin', 'paidAt', 'method', 'receiptNo'],
  ),
  ResourceSpec('debts', '/debts', 'debt:read', Icons.account_balance_outlined, [
    'child',
    'debtTiyin',
    'advanceTiyin',
  ]),
  ResourceSpec(
    'charges',
    '/charges',
    'charge:read',
    Icons.receipt_long_outlined,
    ['child', 'description', 'amountTiyin', 'outstandingTiyin', 'issuedAt'],
  ),
  ResourceSpec(
    'expenses',
    '/expenses',
    'expense:read',
    Icons.payments_outlined,
    ['description', 'amountTiyin', 'status', 'dueDate'],
  ),
  ResourceSpec('groups', '/groups', 'group:read', Icons.groups_outlined, [
    'name',
    'capacity',
    'status',
  ]),
  ResourceSpec(
    'guardians',
    '/guardians',
    'guardian:read',
    Icons.family_restroom,
    ['fullName', 'phone'],
  ),
  ResourceSpec(
    'announcements',
    '/announcements',
    'announcement:manage',
    Icons.campaign_outlined,
    ['title', 'body', 'status', 'publishAt'],
  ),
  ResourceSpec(
    'notifications',
    '/notifications',
    'notification:read',
    Icons.notifications_outlined,
    ['templateKey', 'status', 'channel', 'createdAt'],
  ),
  ResourceSpec('staff', '/users', 'user:manage', Icons.badge_outlined, [
    'fullName',
    'phone',
    'email',
    'status',
  ]),
  ResourceSpec(
    'roles',
    '/roles',
    'role:manage',
    Icons.admin_panel_settings_outlined,
    ['nameUz', 'nameRu', 'code'],
  ),
  ResourceSpec('audit', '/audit', 'audit:read', Icons.history, [
    'action',
    'entityType',
    'createdAt',
  ]),
];

bool isReversed(Json row) =>
    row['sign'] == -1 ||
    row['cancelledAt'] != null ||
    row['reversedAt'] != null ||
    records(row['otherPayment']).isNotEmpty ||
    records(row['otherCharge']).isNotEmpty;

class ResourcePage extends StatefulWidget {
  const ResourcePage({super.key, required this.spec});
  final ResourceSpec spec;
  @override
  State<ResourcePage> createState() => _ResourcePageState();
}

class _ResourcePageState extends State<ResourcePage> {
  List<Json>? rows;
  Object? error;
  int page = 1, total = 0;
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
      final data = await AppScope.of(context).api.request(
        widget.spec.path,
        query: widget.spec.singleton ? null : {'page': page, 'limit': 30},
      );
      if (mounted) {
        setState(() {
          rows = widget.spec.singleton ? [object(data)] : records(data);
          total =
              (object(object(data)['meta'])['total'] as num?)?.toInt() ??
              rows!.length;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(tr(context, widget.spec.title)),
      actions: [
        if (widget.spec.title == 'medical' &&
            widget.spec.permission == 'medical:read' &&
            rows != null &&
            AppScope.of(context).can('medical:write'))
          IconButton(
            tooltip: tr(context, 'editMedical'),
            icon: const Icon(Icons.edit_outlined),
            onPressed: () async {
              final changed = await Navigator.push<bool>(
                context,
                MaterialPageRoute(
                  builder: (_) => RecordEditor(
                    title: 'editMedical',
                    path: widget.spec.path,
                    method: 'PUT',
                    fields: const [
                      'bloodType',
                      'chronicConditions',
                      'emergencyInstructions',
                      'note',
                    ],
                    initial: object(rows!.first['record']),
                  ),
                ),
              );
              if (changed == true && mounted) await load();
            },
          ),
      ],
    ),
    body: !AppScope.of(context).can(widget.spec.permission)
        ? Center(child: Text(tr(context, 'FORBIDDEN')))
        : error != null
        ? FailureView(error!, load)
        : rows == null
        ? const Center(child: CircularProgressIndicator.adaptive())
        : RefreshIndicator(
            onRefresh: load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(20),
              children: [
                if (rows!.isEmpty) const EmptyView(),
                ...rows!.map((raw) {
                  final row = {
                    ...raw,
                    ...object(raw['guardian']),
                    if (widget.spec.title == 'medical')
                      ...object(raw['record']),
                  };
                  final reversed = isReversed(row);
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (reversed)
                            Align(
                              alignment: Alignment.centerLeft,
                              child: Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: StatusPill('cancelled'),
                              ),
                            ),
                          ...widget.spec.fields
                              .where((f) => row[f] != null || f == 'child')
                              .map((field) {
                                final value = row[field];
                                final text =
                                    field == 'allergies' && value is List
                                    ? value
                                          .map((item) {
                                            final alert = object(item);
                                            return [
                                                  alert['allergen'],
                                                  alert['instruction'],
                                                ]
                                                .whereType<String>()
                                                .where(
                                                  (text) =>
                                                      text.trim().isNotEmpty,
                                                )
                                                .join(' — ');
                                          })
                                          .where((text) => text.isNotEmpty)
                                          .join('\n')
                                    : field == 'child'
                                    ? (childName(object(value)).isNotEmpty
                                          ? childName(object(value))
                                          : childName(row))
                                    : field.endsWith('Tiyin')
                                    ? money(value)
                                    : field.endsWith('At') ||
                                          field.endsWith('Date')
                                    ? dateText(value)
                                    : [
                                        'status',
                                        'method',
                                        'relationship',
                                      ].contains(field)
                                    ? tr(context, value.toString())
                                    : value.toString();
                                if (text.isEmpty) {
                                  return const SizedBox.shrink();
                                }
                                return Padding(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 5,
                                  ),
                                  child: Column(
                                    crossAxisAlignment: field.endsWith('Tiyin')
                                        ? CrossAxisAlignment.end
                                        : CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        tr(context, field),
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: Colors.black54,
                                        ),
                                      ),
                                      const SizedBox(height: 3),
                                      Text(
                                        text,
                                        style: TextStyle(
                                          fontSize: field.endsWith('Tiyin')
                                              ? 22
                                              : 16,
                                          fontWeight: FontWeight.w600,
                                          decoration:
                                              reversed &&
                                                  field.endsWith('Tiyin')
                                              ? TextDecoration.lineThrough
                                              : null,
                                          color: reversed
                                              ? Colors.black54
                                              : navy,
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              }),
                          if (widget.spec.title == 'medical') ...[
                            SectionTitle(tr(context, 'allergies')),
                            for (final allergy in records(raw['allergies']))
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(
                                  Icons.warning_amber,
                                  color: Color(0xFFB63D4E),
                                ),
                                title: Text(
                                  allergy['allergen']?.toString() ?? '',
                                ),
                                subtitle: Text(
                                  allergy['instruction']?.toString() ?? '',
                                ),
                              ),
                            SectionTitle(tr(context, 'medications')),
                            for (final medication in records(
                              raw['medications'],
                            ))
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  medication['name']?.toString() ?? '',
                                ),
                                subtitle: Text(
                                  [
                                    medication['dosage'],
                                    medication['schedule'],
                                  ].whereType<String>().join(' · '),
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                  );
                }),
                if (!widget.spec.singleton)
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
  );
}

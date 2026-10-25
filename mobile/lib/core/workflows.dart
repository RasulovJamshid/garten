import 'api.dart';
import 'features.dart';
import 'session.dart';
import 'workflow_metadata.dart';

class WorkflowSpec {
  const WorkflowSpec(
    this.category,
    this.kind, {
    this.listing,
    this.singleton = false,
  });
  final String category, kind;
  final String? listing;
  final bool singleton;
}

const workflowSpecs = <String, WorkflowSpec>{
  'children': WorkflowSpec(
    'peopleWork',
    'childId',
    listing: 'ChildrenController_list',
  ),
  'guardians': WorkflowSpec(
    'peopleWork',
    'guardianId',
    listing: 'GuardiansController_list',
  ),
  'groups': WorkflowSpec(
    'peopleWork',
    'groupId',
    listing: 'GroupsController_list',
  ),
  'users': WorkflowSpec('teamWork', 'userId', listing: 'UsersController_list'),
  'roles': WorkflowSpec('teamWork', 'roleId', listing: 'RolesController_list'),
  'permissions': WorkflowSpec(
    'teamWork',
    'permissionKey',
    listing: 'PermissionsController_list',
  ),
  'attendance': WorkflowSpec(
    'dailyWork',
    'attendanceDayId',
    listing: 'AttendanceController_list',
  ),
  'pickup': WorkflowSpec(
    'dailyWork',
    'pickupPersonId',
    listing: 'PickupPersonsController_list',
  ),
  'holidays': WorkflowSpec(
    'dailyWork',
    'holidayId',
    listing: 'HolidaysController_list',
  ),
  'payments': WorkflowSpec(
    'moneyWork',
    'paymentId',
    listing: 'PaymentsController_list',
  ),
  'charges': WorkflowSpec(
    'moneyWork',
    'chargeId',
    listing: 'ChargesController_list',
  ),
  'debts': WorkflowSpec(
    'moneyWork',
    'childId',
    listing: 'DebtsController_list',
  ),
  'expenses': WorkflowSpec(
    'moneyWork',
    'expenseId',
    listing: 'ExpensesController_list',
  ),
  'tariffs': WorkflowSpec(
    'moneyWork',
    'tariffId',
    listing: 'TariffsController_list',
  ),
  'discounts': WorkflowSpec(
    'moneyWork',
    'discountId',
    listing: 'DiscountsController_list',
  ),
  'periods': WorkflowSpec(
    'moneyWork',
    'periodId',
    listing: 'PeriodsController_list',
  ),
  'billing-rules': WorkflowSpec(
    'moneyWork',
    'billingRulesId',
    listing: 'BillingRulesController_list',
  ),
  'billing-runs': WorkflowSpec(
    'moneyWork',
    'billingRunId',
    listing: 'BillingRunsController_list',
  ),
  'announcements': WorkflowSpec(
    'communicationWork',
    'announcementId',
    listing: 'AnnouncementsController_list',
  ),
  'notifications': WorkflowSpec(
    'communicationWork',
    'notificationId',
    listing: 'NotificationsController_list',
  ),
  'notification-templates': WorkflowSpec(
    'communicationWork',
    'templateKey',
    listing: 'NotificationTemplatesController_list',
  ),
  'telegram': WorkflowSpec(
    'communicationWork',
    'guardianId',
    listing: 'TelegramInviteController_unbound',
  ),
  'reports': WorkflowSpec('insightsWork', 'report'),
  'dashboard': WorkflowSpec('insightsWork', 'dashboard'),
  'exports': WorkflowSpec('insightsWork', 'exportJobId'),
  'audit': WorkflowSpec(
    'insightsWork',
    'auditId',
    listing: 'AuditController_list',
  ),
  'branches': WorkflowSpec(
    'organizationWork',
    'branchId',
    listing: 'BranchesController_list',
  ),
  'settings': WorkflowSpec(
    'organizationWork',
    'settings',
    listing: 'SettingsController_get',
    singleton: true,
  ),
  'landing': WorkflowSpec(
    'organizationWork',
    'blockId',
    listing: 'LandingController_get',
  ),
  'files': WorkflowSpec('organizationWork', 'fileId'),
  'imports': WorkflowSpec('organizationWork', 'importJobId'),
  'lookups': WorkflowSpec(
    'peopleWork',
    'childId',
    listing: 'LookupsController_children',
  ),
  'auth': WorkflowSpec('teamWork', 'account'),
};

const workflowCategories = [
  'dailyWork',
  'peopleWork',
  'moneyWork',
  'communicationWork',
  'teamWork',
  'insightsWork',
  'organizationWork',
];

String workflowReference(String name, String path) {
  if (name == 'against') {
    return path.startsWith('/roles') ? 'roleId' : 'billingRulesId';
  }
  if (name == 'key' && path.startsWith('/notification-templates')) {
    return 'templateKey';
  }
  return referenceName(name, path);
}

String workflowResultKind(String path) {
  final parts = path.split('/').where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty) return 'record';
  if (path.startsWith('/children/') && parts.length >= 3) {
    return {
          'documents': 'docId',
          'consents': 'consentId',
          'tariffs': 'assignmentId',
          'discounts': 'discountId',
          'guardians': 'guardianId',
          'charges': 'chargeId',
          'pickup-persons': 'pickupPersonId',
        }[parts[2]] ??
        'record';
  }
  if (path.endsWith('/pickup-guardians')) return 'guardianId';
  if (path.endsWith('/children') ||
      path.startsWith('/lookups/children') && !path.endsWith('/payers')) {
    return 'childId';
  }
  if (path.endsWith('/payers')) return 'guardianId';
  if (path.endsWith('/roles')) return 'roleId';
  if (path.endsWith('/users')) return 'userId';
  if (path.startsWith('/landing/versions')) return 'version';
  if (path.startsWith('/landing')) return 'blockId';
  if (path.startsWith('/notification-templates')) return 'templateKey';
  if (path.startsWith('/pickup-permissions')) return 'pickupPermissionId';
  return referenceName('id', path);
}

String workflowRecordKey(String kind) =>
    kind == 'templateKey' || kind == 'permissionKey'
    ? 'key'
    : kind == 'version'
    ? 'version'
    : 'id';

Json workflowRow(String kind, Json row) {
  if (kind == 'guardianId' && row['guardian'] is Map) {
    return {...row, ...object(row['guardian'])};
  }
  if (kind == 'userId' && row['user'] is Map) {
    return {...row, ...object(row['user'])};
  }
  if (kind == 'roleId' && row['role'] is Map) {
    return {...row, ...object(row['role'])};
  }
  if (kind == 'childId' && row['child'] is Map) {
    return {...row, ...object(row['child'])};
  }
  if (kind == 'childId' && row['id'] == null && row['childId'] != null) {
    return {...row, 'id': row['childId']};
  }
  if (kind == 'importJobId' && row['importJobId'] != null) {
    return {...row, 'id': row['importJobId']};
  }
  if (kind == 'fileId' && row['fileId'] != null) {
    return {...row, 'id': row['fileId']};
  }
  return row;
}

Json workflowContext(String kind, Json record, {Json inherited = const {}}) => {
  ...inherited,
  for (final entry in record.entries)
    if (entry.key.endsWith('Id') && entry.value != null) entry.key: entry.value,
  if (record[workflowRecordKey(kind)] != null)
    kind: record[workflowRecordKey(kind)],
};

Json bindWorkflowOperation(FeatureOperation operation, Json context) => {
  ...context,
  // Generic path IDs are resolved by resource type, never copied between entities.
  'id': '',
  for (final p in operation.parameters)
    if (context[workflowReference(p['name'], operation.path)] != null)
      p['name'] as String:
          context[workflowReference(p['name'], operation.path)],
};

bool workflowTargets(FeatureOperation operation, String kind) =>
    operation.parameters.any(
      (p) => workflowReference(p['name'], operation.path) == kind,
    ) ||
    ((operation.body['required'] as List? ?? []).contains(kind));

bool workflowDestructive(FeatureOperation op) =>
    op.method == 'DELETE' ||
    RegExp(
      r'_(cancel|reverse|deactivate|revoke|revokeOne|removeRole|removeOverride|restore|discard|reopen|commit|publish)$',
    ).hasMatch(op.id);

List<FeatureOperation> workflowRecordActions(
  FeatureCatalog catalog,
  Session session,
  String group,
  String kind, {
  Json context = const {},
}) {
  return catalog
      .available(session)
      .where(
        (op) =>
            workflowTargets(op, kind) &&
            (op.group == group ||
                context['childId'] != null &&
                    op.path.startsWith('/children/') ||
                kind == 'childId' ||
                kind == 'guardianId' && op.group == 'telegram') &&
            // A record already displays its details; do not require a second "Get" action.
            !(op.method == 'GET' &&
                RegExp(r'/\{[^}]+\}$').hasMatch(op.path) &&
                op.id.endsWith('_get')),
      )
      .toList();
}

List<FeatureOperation> workflowSectionTasks(
  FeatureCatalog catalog,
  Session session,
  String group,
) {
  final spec = workflowSpecs[group]!;
  return catalog
      .available(session)
      .where(
        (op) =>
            op.group == group &&
            op.id != spec.listing &&
            (!workflowTargets(op, spec.kind) ||
                spec.listing == null ||
                spec.singleton ||
                op.id == 'NotificationTemplatesController_upsert'),
      )
      .toList();
}

Json workflowDefaults(FeatureOperation op, Json values) {
  final day = today();
  final now = DateTime.parse(day);
  final fields = {
    ...object(op.parameterSchema('query')['properties']),
    ...object(op.body['properties']),
  };
  final required = {
    ...(op.parameterSchema('query')['required'] as List? ?? []),
    ...(op.body['required'] as List? ?? []),
  };
  return {
    for (final name in required)
      if (!values.containsKey(name))
        if (['year', 'billingYear'].contains(name))
          name: now.year
        else if (['month', 'billingMonth'].contains(name))
          name: now.month
        else if ([
          'date',
          'effectiveDate',
          'effectiveFrom',
          'validFrom',
        ].contains(name))
          name: day
        else if (name == 'paidAt')
          name: DateTime.now().toUtc().toIso8601String()
        else if (name == 'from')
          name: '${day.substring(0, 7)}-01'
        else if (name == 'to')
          name: day
        else if (object(fields[name])['default'] != null)
          name: object(fields[name])['default'],
    ...values,
  };
}

const suggestedWorkflowFields = <String>{
  'firstName',
  'lastName',
  'middleName',
  'fullName',
  'name',
  'nameUz',
  'nameRu',
  'phone',
  'email',
  'birthDate',
  'gender',
  'branchId',
  'branchIds',
  'groupId',
  'childId',
  'guardianId',
  'userId',
  'roleId',
  'roles',
  'status',
  'address',
  'note',
  'description',
  'reason',
  'photoFileId',
  'fileId',
  'fileIds',
  'attachmentFileId',
  'evidenceFileId',
  'payerGuardianId',
  'chargeId',
  'number',
  'issuedAt',
  'expiresAt',
  'date',
  'effectiveDate',
  'validFrom',
  'validTo',
  'effectiveFrom',
  'effectiveTo',
  'year',
  'month',
  'billingYear',
  'billingMonth',
  'capacity',
  'amountTiyin',
  'dueDate',
  'method',
  'paidAt',
  'title',
  'body',
  'priority',
  'audienceType',
  'audienceIds',
  'publishAt',
  'channel',
  'recipients',
  'templateKey',
  'relationship',
  'isPrimary',
  'canPickup',
  'bloodType',
  'allergies',
  'medications',
  'chronicConditions',
  'emergencyInstructions',
};

Json workflowBodySchema(FeatureOperation op, Json values, Session session) {
  final properties = {...object(op.body['properties'])};
  if (op.group == 'settings') {
    for (final entry in properties.entries.toList()) {
      properties[entry.key] = {...object(entry.value), 'x-visible': true};
    }
  }
  if (op.group == 'roles' || op.group == 'users') {
    if (properties.containsKey('key')) {
      properties['key'] = {
        'type': 'string',
        'enum': object(workflowMetadata['permissions']).keys.toList(),
      };
    }
  }
  if (op.group == 'landing' && properties.containsKey('content')) {
    final schema = object(
      object(workflowMetadata['blocks'])[values['type'] ?? values['blockType']],
    );
    if (schema.isNotEmpty) properties['content'] = schema;
  }
  if (op.group == 'notifications' || op.group == 'notification-templates') {
    final template =
        session.references['templateKey']?[values['templateKey']?.toString() ??
            values['key']?.toString()];
    final variables = (template?['variables'] ?? values['variables']) as List?;
    if (variables == null) {
      for (final key in ['data', 'sampleData']) {
        if (properties.containsKey(key)) {
          properties[key] = {
            'type': 'object',
            'properties': <String, dynamic>{},
            'additionalProperties': false,
          };
        }
      }
    }
    if (variables != null) {
      for (final key in ['data', 'sampleData']) {
        if (properties.containsKey(key)) {
          properties[key] = {
            'type': 'object',
            'properties': {
              for (final name in variables)
                name.toString(): {'type': 'string', 'x-visible': true},
            },
            'required': variables,
            'additionalProperties': false,
          };
        }
      }
    }
  }
  return {...op.body, 'properties': properties};
}

Json workflowInputSchema(
  String name,
  Json schema, {
  String? group,
  Json values = const {},
}) {
  if (name == 'scope' && values['key'] != null) {
    final scopes = object(
      object(workflowMetadata['permissions'])[values['key']],
    )['scopes'];
    if (scopes is List) return {...schema, 'enum': scopes};
  }
  if ([
        'date',
        'from',
        'to',
        'validFrom',
        'validTo',
        'effectiveFrom',
        'effectiveTo',
        'effectiveDate',
      ].contains(name) &&
      schema['format'] == null) {
    return {...schema, 'type': 'string', 'format': 'date'};
  }
  if (['year', 'billingYear', 'month', 'billingMonth'].contains(name)) {
    return {
      ...schema,
      'type': 'integer',
      'minimum': name.toLowerCase().contains('year') ? 2000 : 1,
      'maximum': name.toLowerCase().contains('year') ? 2200 : 12,
    };
  }
  return schema;
}

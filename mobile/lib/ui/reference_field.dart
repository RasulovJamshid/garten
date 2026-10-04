import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'reference_picker.dart';

String referenceKind(String name) => switch (name) {
  'toGroupId' => 'groupId',
  'photoFileId' ||
  'evidenceFileId' ||
  'attachmentFileId' ||
  'ogImageFileId' => 'fileId',
  'recipientId' => 'guardianId',
  'mainTeacherId' || 'assistantTeacherId' || 'nurseId' => 'userId',
  'grantedByGuardianId' || 'payerGuardianId' => 'guardianId',
  _ => name.endsWith('FileId') ? 'fileId' : name,
};

class ReferenceField extends StatelessWidget {
  const ReferenceField({
    super.key,
    required this.name,
    required this.label,
    required this.value,
    required this.onChanged,
    this.schema = const {},
    this.values = const {},
    this.required = false,
    this.enabled = true,
  });
  final String name, label;
  final dynamic value;
  final Json schema, values;
  final ValueChanged<dynamic> onChanged;
  final bool required, enabled;

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    final resolvedName = name == 'audienceId'
        ? {
                'group': 'groupId',
                'children': 'childId',
                'guardians': 'guardianId',
                'staff': 'userId',
              }[values['audienceType']] ??
              name
        : referenceKind(name) == 'fileId'
        ? 'fileId'
        : name == 'recipientId'
        ? 'guardianId'
        : name;
    final kind = referenceKind(resolvedName);
    final source = referenceSource(session, resolvedName, values: values);
    final selected =
        session.references[kind]?[value?.toString()] ??
        (kind == 'branchId'
                ? session.branches
                : kind == 'groupId'
                ? session.groups
                : <Json>[])
            .where((row) => row['id']?.toString() == value?.toString())
            .firstOrNull;
    final recent = session.references[kind]?.values.toList() ?? <Json>[];
    final available =
        source != null ||
        (![
              'docId',
              'consentId',
              'discountId',
              'assignmentId',
              'pickupPersonId',
              'pickupPermissionId',
              'payerGuardianId',
              'grantedByGuardianId',
            ].contains(name) &&
            recent.isNotEmpty);
    return FormField<String>(
      key: ValueKey('$name:$value'),
      initialValue: value?.toString(),
      validator: (_) => validateField(value, schema, required: required) == null
          ? null
          : tr(context, 'chooseRecordRequired'),
      builder: (field) => InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: !enabled || !available
            ? null
            : () async {
                final row = await Navigator.push<Json>(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ReferencePicker(
                      path: source?.$1 ?? '@recent/$kind',
                      query: source?.$2 ?? {},
                      title: label,
                      valueKey: name == 'templateKey' ? 'key' : 'id',
                    ),
                  ),
                );
                if (row != null && context.mounted) {
                  final key = name == 'templateKey' ? 'key' : 'id';
                  session.rememberReference(kind, row, valueKey: key);
                  onChanged(row[key]);
                }
              },
        child: InputDecorator(
          isEmpty: false,
          decoration: InputDecoration(
            labelText: label,
            enabled: enabled,
            errorText: field.errorText,
            helperText: !available && (value == null || value == '')
                ? tr(
                    context,
                    [
                          'docId',
                          'consentId',
                          'discountId',
                          'assignmentId',
                          'pickupPersonId',
                          'pickupPermissionId',
                          'payerGuardianId',
                          'grantedByGuardianId',
                        ].contains(name)
                        ? 'chooseChildFirst'
                        : 'selectionUnavailable',
                  )
                : null,
            helperMaxLines: 3,
            suffixIcon: Icon(
              available ? Icons.search_rounded : Icons.link_rounded,
            ),
          ),
          child: Text(
            selected != null
                ? referenceTitle(context, selected)
                : value != null && value != ''
                ? tr(context, 'selectedRecord')
                : tr(context, 'tapToChoose'),
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ),
      ),
    );
  }
}

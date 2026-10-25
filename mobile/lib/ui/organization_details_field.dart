import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/strings.dart';

/// These settings are free-form API objects. Editing known business fields must
/// preserve any existing custom fields, including nested configuration.
class OrganizationDetailsField extends StatelessWidget {
  const OrganizationDetailsField({
    super.key,
    required this.name,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });
  final String name;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    final details = object(value);
    final fields = name == 'bankDetails'
        ? {
            'bankName': 'bankNameLabel',
            'accountNumber': 'bankAccountLabel',
            'mfo': 'bankCodeLabel',
          }
        : {'inn': 'taxIdLabel', 'legalName': 'legalNameLabel'};
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text(tr(context, name)),
      children: [
        for (final entry in fields.entries)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: TextFormField(
              key: ValueKey('$name:${entry.key}'),
              initialValue: details[entry.key]?.toString() ?? '',
              enabled: enabled,
              decoration: InputDecoration(labelText: tr(context, entry.value)),
              onChanged: (text) {
                final next = {...details};
                if (text.isEmpty) {
                  next.remove(entry.key);
                } else {
                  next[entry.key] = text;
                }
                onChanged(next);
              },
            ),
          ),
        if (details.keys.any((key) => !fields.containsKey(key)))
          ExpansionTile(
            title: Text(tr(context, 'additionalFields')),
            children: [
              for (final entry in details.entries.where(
                (e) => !fields.containsKey(e.key),
              ))
                ListTile(
                  title: Text(entry.key),
                  subtitle: Text(entry.value.toString()),
                ),
            ],
          ),
      ],
    );
  }
}

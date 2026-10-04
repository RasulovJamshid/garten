import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/strings.dart';
import '../core/workflow_metadata.dart';

class PermissionSelection extends StatelessWidget {
  const PermissionSelection({
    super.key,
    required this.value,
    required this.onChanged,
    required this.enabled,
  });
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    final selected = records(value);
    final definitions = object(workflowMetadata['permissions']);
    Future<void> choose() async {
      var draft = {
        for (final p in selected) p['key'].toString(): p['scope'].toString(),
      };
      String search = '';
      final result = await showModalBottomSheet<List<Json>>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => SizedBox(
            height: MediaQuery.sizeOf(context).height * .9,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: TextField(
                    onChanged: (v) => update(() => search = v.toLowerCase()),
                    decoration: InputDecoration(
                      hintText: tr(context, 'searchPermission'),
                      prefixIcon: const Icon(Icons.search),
                    ),
                  ),
                ),
                Expanded(
                  child: ListView(
                    children: [
                      for (final entry in definitions.entries.where(
                        (e) =>
                            tr(context, e.key).toLowerCase().contains(search),
                      ))
                        CheckboxListTile(
                          title: Text(tr(context, entry.key)),
                          value: draft.containsKey(entry.key),
                          onChanged: (checked) => update(() {
                            if (checked == true) {
                              draft[entry.key] =
                                  (object(entry.value)['scopes'] as List).first
                                      .toString();
                            } else {
                              draft.remove(entry.key);
                            }
                          }),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context, <Json>[
                      for (final p in draft.entries)
                        {'key': p.key, 'scope': p.value},
                    ]),
                    child: Text(tr(context, 'applySelection')),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (result != null) onChanged(result);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          tr(context, 'permissions'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        for (var i = 0; i < selected.length; i++)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(tr(context, selected[i]['key'].toString())),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: selected[i]['scope']?.toString(),
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: tr(context, 'scope'),
                    ),
                    items:
                        {
                              ...(object(
                                        definitions[selected[i]['key']],
                                      )['scopes']
                                      as List? ??
                                  []),
                              selected[i]['scope'],
                            }
                            .whereType<String>()
                            .map(
                              (s) => DropdownMenuItem(
                                value: s,
                                child: Text(tr(context, s)),
                              ),
                            )
                            .toList(),
                    onChanged: !enabled
                        ? null
                        : (scope) {
                            final next = selected
                                .map((p) => <String, dynamic>{...p})
                                .toList();
                            next[i]['scope'] = scope;
                            onChanged(next);
                          },
                  ),
                ],
              ),
            ),
          ),
        if (enabled)
          OutlinedButton.icon(
            onPressed: choose,
            icon: const Icon(Icons.checklist),
            label: Text(tr(context, 'choosePermissions')),
          ),
      ],
    );
  }
}

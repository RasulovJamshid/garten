import 'package:flutter/material.dart';
import 'package:file_selector/file_selector.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'reference_field.dart';
import 'permission_selection.dart';
import '../core/workflows.dart';

String formLabel(BuildContext context, String key) {
  if (labels.containsKey(key)) return tr(context, key);
  final indexed = RegExp(r'^(.*) (\d+)$').firstMatch(key);
  if (indexed != null) {
    return '${formLabel(context, indexed[1]!)} ${indexed[2]}';
  }
  return tr(context, 'additionalInfo');
}

// Translate categorical API values only; preserve user-authored content.
String displayValue(BuildContext context, String key, dynamic value) {
  if (value == null) return '—';
  if (value is bool) return tr(context, value ? 'yes' : 'no');
  final text = value.toString();
  if (key == 'date' || RegExp(r'(Date|At|From|To|Until)$').hasMatch(key)) {
    final parsed = DateTime.tryParse(text);
    if (parsed != null && text.length >= 10) {
      if (text.length == 10) return dateText(text);
      final local = parsed.toUtc().add(const Duration(hours: 5));
      return '${dateText(local.toIso8601String())} · ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
    }
  }
  const categorical = {
    'status',
    'gender',
    'method',
    'kind',
    'type',
    'channel',
    'scope',
    'severity',
    'language',
    'preferredLanguage',
    'defaultLanguage',
    'audienceType',
    'effect',
    'consentType',
    'permissionType',
    'relationship',
    'mode',
    'position',
    'code',
    'permissionKey',
    'systemKind',
    'oldStatus',
    'newStatus',
    'staffRole',
    'templateKey',
    'docType',
    'expenseType',
  };
  return categorical.contains(key) && labels.containsKey(text)
      ? tr(context, text)
      : text;
}

class SchemaObjectForm extends StatefulWidget {
  const SchemaObjectForm({
    super.key,
    required this.schema,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.referenceValues = const {},
    this.suggestedFields = const {},
  });
  final Set<String> suggestedFields;
  final Json schema, value;
  final Json referenceValues;
  final ValueChanged<Json> onChanged;
  final bool enabled;
  @override
  State<SchemaObjectForm> createState() => _SchemaObjectFormState();
}

class _SchemaObjectFormState extends State<SchemaObjectForm> {
  final customSchemas = <String, Json>{};
  Future<void> addProperty() async {
    final name = TextEditingController();
    String type = 'string';
    final result = await showDialog<(String, String)>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(tr(context, 'addField')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: InputDecoration(labelText: tr(context, 'name')),
              ),
              DropdownButtonFormField<String>(
                initialValue: type,
                items: ['string', 'number', 'boolean', 'object', 'array']
                    .map(
                      (t) => DropdownMenuItem(
                        value: t,
                        child: Text(tr(context, t)),
                      ),
                    )
                    .toList(),
                onChanged: (v) => update(() => type = v!),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(tr(context, 'cancel')),
            ),
            FilledButton(
              onPressed: () {
                final key = name.text.trim();
                if (key.isNotEmpty &&
                    !widget.value.containsKey(key) &&
                    !object(widget.schema['properties']).containsKey(key)) {
                  Navigator.pop(context, (key, type));
                }
              },
              child: Text(tr(context, 'add')),
            ),
          ],
        ),
      ),
    );
    // Controllers used by an exiting route must survive its closing animation.
    if (result != null && mounted) {
      setState(
        () => customSchemas[result.$1] = {
          'type': result.$2,
          if (result.$2 == 'array') 'items': <String, dynamic>{},
        },
      );
      widget.onChanged({
        ...widget.value,
        result.$1: switch (result.$2) {
          'object' => <String, dynamic>{},
          'array' => <dynamic>[],
          'boolean' => false,
          'number' => 0,
          _ => '',
        },
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final properties = object(widget.schema['properties']);
    final open =
        (properties.isEmpty &&
            widget.schema['additionalProperties'] != false) ||
        widget.schema['additionalProperties'] != null &&
            widget.schema['additionalProperties'] != false;
    final fields = {...properties, ...customSchemas};
    if (open) {
      for (final entry in widget.value.entries) {
        fields.putIfAbsent(entry.key, () => inferSchema(entry.value));
      }
    }
    final required = (widget.schema['required'] as List? ?? []).cast<String>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final field in fields.entries.where(
          (f) =>
              required.contains(f.key) ||
              widget.value.containsKey(f.key) ||
              (widget.suggestedFields.contains(f.key) ||
                  object(f.value)['x-visible'] == true),
        ))
          Padding(
            key: ValueKey('field:${field.key}'),
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!(object(field.value)['nullable'] == true &&
                    widget.value[field.key] == null))
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: SchemaValueForm(
                          key: ValueKey(field.key),
                          name: field.key,
                          schema: workflowInputSchema(
                            field.key,
                            object(field.value),
                            values: widget.value,
                          ),
                          referenceValues: {
                            ...widget.referenceValues,
                            ...widget.value,
                          },
                          value: widget.value[field.key],
                          required: required.contains(field.key),
                          enabled: widget.enabled,
                          onChanged: (v) =>
                              widget.onChanged({...widget.value, field.key: v}),
                        ),
                      ),
                      if (!required.contains(field.key) &&
                          widget.enabled &&
                          widget.value.containsKey(field.key) &&
                          !widget.suggestedFields.contains(field.key) &&
                          object(field.value)['x-visible'] != true)
                        IconButton(
                          tooltip: tr(context, 'removeField'),
                          icon: const Icon(
                            Icons.remove_circle_outline,
                            size: 20,
                          ),
                          onPressed: () {
                            final next = {...widget.value}..remove(field.key);
                            widget.onChanged(next);
                          },
                        ),
                    ],
                  ),
                if (object(field.value)['nullable'] == true &&
                    widget.value.containsKey(field.key))
                  CheckboxListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(tr(context, 'clearValue')),
                    subtitle: Text(formLabel(context, field.key)),
                    value: widget.value[field.key] == null,
                    onChanged: !widget.enabled
                        ? null
                        : (clear) => widget.onChanged({
                            ...widget.value,
                            field.key: clear == true ? null : '',
                          }),
                  ),
              ],
            ),
          ),
        if (fields.keys.any(
              (key) =>
                  !required.contains(key) &&
                  !widget.value.containsKey(key) &&
                  !widget.suggestedFields.contains(key) &&
                  object(fields[key])['x-visible'] != true,
            ) &&
            widget.enabled)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              leading: const Icon(Icons.add_circle_outline, size: 20),
              title: Text(tr(context, 'additionalFields')),
              children: [
                for (final field in fields.entries.where(
                  (f) =>
                      !required.contains(f.key) &&
                      !widget.value.containsKey(f.key) &&
                      !widget.suggestedFields.contains(f.key) &&
                      object(f.value)['x-visible'] != true,
                ))
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(formLabel(context, field.key)),
                    trailing: const Icon(Icons.add, size: 20),
                    onTap: () {
                      final schema = object(field.value);
                      widget.onChanged({
                        ...widget.value,
                        field.key:
                            schema['default'] ??
                            switch (schema['type']) {
                              'array' => <dynamic>[],
                              'object' => seededValues(schema, {}),
                              'boolean' => false,
                              _ => '',
                            },
                      });
                    },
                  ),
              ],
            ),
          ),
        if (open && widget.enabled)
          OutlinedButton.icon(
            onPressed: addProperty,
            icon: const Icon(Icons.add),
            label: Text(tr(context, 'addField')),
          ),
      ],
    );
  }
}

Json inferSchema(dynamic value) => {
  'type': value is Map
      ? 'object'
      : value is List
      ? 'array'
      : value is bool
      ? 'boolean'
      : value is num
      ? 'number'
      : 'string',
  if (value is List) 'items': <String, dynamic>{},
};

class SchemaValueForm extends StatefulWidget {
  const SchemaValueForm({
    super.key,
    required this.name,
    required this.schema,
    required this.value,
    required this.onChanged,
    this.required = false,
    this.enabled = true,
    this.referenceValues = const {},
  });
  final String name;
  final Json schema;
  final Json referenceValues;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final bool required, enabled;
  @override
  State<SchemaValueForm> createState() => _SchemaValueFormState();
}

class _SchemaValueFormState extends State<SchemaValueForm> {
  late final controller = TextEditingController(text: display(widget.value));
  late String recipientKind = object(widget.value).containsKey('userId')
      ? 'userId'
      : 'guardianId';
  String display(dynamic value) => widget.name.endsWith('Tiyin')
      ? decimalMoney(value)
      : value?.toString() ?? '';
  @override
  void didUpdateWidget(SchemaValueForm old) {
    super.didUpdateWidget(old);
    try {
      if (parseField(widget.name, controller.text, widget.schema) ==
          widget.value) {
        return;
      }
    } on FormatException {
      /* An external update replaces incomplete input. */
    }
    if (old.value != widget.value && display(widget.value) != controller.text) {
      controller.text = display(widget.value);
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final schema = widget.schema;
    final type = schema['type'] ?? inferSchema(widget.value)['type'];
    final rawName = schema['x-referenceName']?.toString() ?? widget.name;
    final indexedReference = RegExp(r'^(.*)Ids (\d+)$').firstMatch(rawName);
    final name = indexedReference == null
        ? rawName
        : '${indexedReference[1]}Id';
    final title = formLabel(context, name);
    final label = widget.name.endsWith('Tiyin') ? '$title (UZS)' : title;
    if (name == 'blocks' && type == 'array') {
      final values = records(widget.value);
      void move(int from, int to) {
        final next = values.map((v) => <String, dynamic>{...v}).toList();
        final block = next.removeAt(from);
        next.insert(to, block);
        for (var i = 0; i < next.length; i++) {
          next[i]['position'] = i;
        }
        widget.onChanged(next);
      }

      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(tr(context, 'reorderHint')),
          for (var i = 0; i < values.length; i++)
            Card(
              child: ListTile(
                title: Text(
                  tr(
                    context,
                    AppScope.of(context)
                            .references['blockId']?[values[i]['id']]?['type']
                            ?.toString() ??
                        'record',
                  ),
                ),
                leading: Text((i + 1).toString()),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: tr(context, 'moveUp'),
                      onPressed: !widget.enabled || i == 0
                          ? null
                          : () => move(i, i - 1),
                      icon: const Icon(Icons.arrow_upward),
                    ),
                    IconButton(
                      tooltip: tr(context, 'moveDown'),
                      onPressed: !widget.enabled || i == values.length - 1
                          ? null
                          : () => move(i, i + 1),
                      icon: const Icon(Icons.arrow_downward),
                    ),
                  ],
                ),
              ),
            ),
        ],
      );
    }
    if (name == 'permissions' && type == 'array') {
      return PermissionSelection(
        value: widget.value,
        onChanged: widget.onChanged,
        enabled: widget.enabled,
      );
    }
    if (name == 'order' && schema['anyOf'] is List) {
      final selected = (widget.value is List
          ? (widget.value as List).join(',')
          : null);
      return DropdownButtonFormField<String>(
        initialValue: selected,
        decoration: InputDecoration(labelText: label),
        isExpanded: true,
        items: [
          DropdownMenuItem(
            value: 'fixed,percent',
            child: Text(tr(context, 'fixedThenPercent')),
          ),
          DropdownMenuItem(
            value: 'percent,fixed',
            child: Text(tr(context, 'percentThenFixed')),
          ),
        ],
        onChanged: !widget.enabled
            ? null
            : (v) => widget.onChanged(v?.split(',')),
        validator: (v) => v == null ? tr(context, 'required') : null,
      );
    }
    if (type == 'array' && object(schema['items'])['enum'] is List) {
      final selected = widget.value is List
          ? List<dynamic>.from(widget.value)
          : <dynamic>[];
      return FormField<List<dynamic>>(
        validator: (_) =>
            schema['minItems'] is num && selected.length < schema['minItems']
            ? tr(context, 'required')
            : null,
        builder: (field) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.titleMedium),
            Wrap(
              spacing: 8,
              children: [
                for (final option in object(schema['items'])['enum'] as List)
                  FilterChip(
                    label: Text(tr(context, option.toString())),
                    selected: selected.contains(option),
                    onSelected: !widget.enabled
                        ? null
                        : (checked) {
                            if (checked) {
                              selected.add(option);
                            } else {
                              selected.remove(option);
                            }
                            widget.onChanged(selected);
                          },
                  ),
              ],
            ),
            if (field.errorText != null)
              Text(
                field.errorText!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      );
    }
    if ((name.endsWith('Id') ||
            name == 'id' ||
            name == 'templateKey' ||
            schema['format'] == 'uuid') &&
        schema['type'] != 'array') {
      return ReferenceField(
        name: name,
        label: title,
        value: widget.value,
        schema: schema,
        values: widget.referenceValues,
        required: widget.required,
        enabled: widget.enabled,
        onChanged: widget.onChanged,
      );
    }
    if (schema['format'] == 'binary') {
      return FormField<XFile>(
        initialValue: widget.value is XFile ? widget.value as XFile : null,
        validator: (v) =>
            widget.required && v == null ? tr(context, 'required') : null,
        builder: (field) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            OutlinedButton.icon(
              onPressed: !widget.enabled
                  ? null
                  : () async {
                      final file = await openFile();
                      if (file != null && mounted) {
                        field.didChange(file);
                        widget.onChanged(file);
                      }
                    },
              icon: const Icon(Icons.attach_file),
              label: Text(field.value?.name ?? tr(context, 'chooseFile')),
            ),
            if (field.errorText != null)
              Text(field.errorText!, style: const TextStyle(color: Colors.red)),
          ],
        ),
      );
    }
    if (type == 'object' && widget.name.startsWith('recipients ')) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(label),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(
                    value: 'guardianId',
                    label: Text(tr(context, 'guardians')),
                  ),
                  ButtonSegment(
                    value: 'userId',
                    label: Text(tr(context, 'staff')),
                  ),
                ],
                selected: {recipientKind},
                onSelectionChanged: !widget.enabled
                    ? null
                    : (v) {
                        setState(() => recipientKind = v.first);
                        widget.onChanged(<String, dynamic>{});
                      },
              ),
              const SizedBox(height: 16),
              ReferenceField(
                name: recipientKind,
                label: formLabel(context, recipientKind),
                schema: {'type': 'string', 'format': 'uuid'},
                required: true,
                value: object(widget.value)[recipientKind],
                enabled: widget.enabled,
                onChanged: (v) => widget.onChanged({recipientKind: v}),
              ),
            ],
          ),
        ),
      );
    }
    if (type == 'object') {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(label, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              SchemaObjectForm(
                schema: schema,
                suggestedFields: suggestedWorkflowFields,
                referenceValues: widget.referenceValues,
                value: object(widget.value),
                onChanged: widget.onChanged,
                enabled: widget.enabled,
              ),
            ],
          ),
        ),
      );
    }
    if (type == 'array') {
      final values = widget.value is List
          ? List<dynamic>.from(widget.value as List)
          : <dynamic>[];
      return FormField<List<dynamic>>(
        initialValue: values,
        validator: (_) =>
            schema['minItems'] is num && values.length < schema['minItems']
            ? tr(context, 'required')
            : null,
        builder: (field) => Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(label, style: Theme.of(context).textTheme.titleMedium),
                for (var i = 0; i < values.length; i++)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: SchemaValueForm(
                          key: ValueKey('$i:${values.length}'),
                          name: '${widget.name} ${i + 1}',
                          referenceValues: widget.referenceValues,
                          schema: object(schema['items']).isEmpty
                              ? inferSchema(values[i])
                              : object(schema['items']),
                          value: values[i],
                          required: true,
                          enabled: widget.enabled,
                          onChanged: (v) {
                            values[i] = v;
                            widget.onChanged(values);
                          },
                        ),
                      ),
                      IconButton(
                        onPressed: !widget.enabled
                            ? null
                            : () {
                                values.removeAt(i);
                                widget.onChanged(values);
                              },
                        icon: const Icon(Icons.remove_circle_outline),
                      ),
                    ],
                  ),
                if (widget.enabled)
                  OutlinedButton.icon(
                    onPressed: () async {
                      var item = object(schema['items']);
                      if (item.isEmpty) {
                        final selected = await showDialog<String>(
                          context: context,
                          builder: (context) => SimpleDialog(
                            title: Text(tr(context, 'add')),
                            children: [
                              for (final t in [
                                'string',
                                'number',
                                'boolean',
                                'object',
                                'array',
                              ])
                                SimpleDialogOption(
                                  onPressed: () => Navigator.pop(context, t),
                                  child: Text(tr(context, t)),
                                ),
                            ],
                          ),
                        );
                        if (selected == null || !mounted) return;
                        item = {'type': selected};
                      }
                      values.add(switch (item['type']) {
                        'object' => <String, dynamic>{},
                        'array' => <dynamic>[],
                        'boolean' => false,
                        'number' || 'integer' => 0,
                        _ => '',
                      });
                      widget.onChanged(values);
                    },
                    icon: const Icon(Icons.add),
                    label: Text(tr(context, 'add')),
                  ),
                if (field.errorText != null) Text(field.errorText!),
              ],
            ),
          ),
        ),
      );
    }
    if (type == 'boolean') {
      return SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        value: widget.value == true,
        onChanged: !widget.enabled ? null : widget.onChanged,
      );
    }
    if (schema['enum'] is List) {
      return DropdownButtonFormField<dynamic>(
        initialValue: (schema['enum'] as List).contains(widget.value)
            ? widget.value
            : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: (schema['enum'] as List)
            .map(
              (v) => DropdownMenuItem<dynamic>(
                value: v,
                child: Text(tr(context, v.toString())),
              ),
            )
            .toList(),
        onChanged: !widget.enabled ? null : widget.onChanged,
        validator: (v) =>
            validateField(v, schema, required: widget.required) == null
            ? null
            : tr(context, 'required'),
      );
    }
    final date =
        ['date', 'date-time'].contains(schema['format']) ||
        RegExp(r'(Date|At|From|Until)$').hasMatch(widget.name) ||
        [
          'date',
          'from',
          'to',
          'effectiveFrom',
          'effectiveTo',
        ].contains(widget.name);
    final numeric =
        ['integer', 'number'].contains(type) || widget.name.endsWith('Tiyin');
    return TextFormField(
      controller: controller,
      enabled: widget.enabled,
      obscureText: widget.name.toLowerCase().contains('password'),
      keyboardType: numeric
          ? const TextInputType.numberWithOptions(decimal: true, signed: true)
          : TextInputType.text,
      minLines: ['note', 'body', 'description', 'reason'].contains(widget.name)
          ? 2
          : 1,
      maxLines: widget.name.toLowerCase().contains('password')
          ? 1
          : ['note', 'body', 'description', 'reason'].contains(widget.name)
          ? 5
          : 1,
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: date
            ? IconButton(
                icon: const Icon(Icons.calendar_today),
                onPressed: !widget.enabled
                    ? null
                    : () async {
                        final chosen = await showDatePicker(
                          context: context,
                          initialDate:
                              DateTime.tryParse(controller.text) ??
                              DateTime.parse(today()),
                          firstDate: DateTime(1900),
                          lastDate: DateTime(2200),
                        );
                        if (chosen != null && context.mounted) {
                          var text = chosen.toIso8601String().substring(0, 10);
                          if (schema['format'] == 'date-time' ||
                              widget.name.endsWith('At')) {
                            final time = await showTimePicker(
                              context: context,
                              initialTime: TimeOfDay.now(),
                            );
                            if (time == null || !mounted) return;
                            // Business dates and times use Tashkent, independent of device timezone.
                            text =
                                DateTime.utc(
                                      chosen.year,
                                      chosen.month,
                                      chosen.day,
                                      time.hour,
                                      time.minute,
                                    )
                                    .subtract(const Duration(hours: 5))
                                    .toIso8601String();
                          }
                          controller.text = text;
                          widget.onChanged(text);
                        }
                      },
              )
            : null,
      ),
      onChanged: (text) {
        try {
          widget.onChanged(parseField(widget.name, text, schema));
        } on FormatException {
          /* validator handles partial input */
        }
      },
      validator: (text) {
        try {
          if (text!.isEmpty) {
            return widget.required || numeric || date
                ? tr(context, 'required')
                : null;
          }
          final v = parseField(widget.name, text, schema);
          if (date && DateTime.tryParse(v.toString()) == null) {
            return tr(context, 'invalid');
          }
          return validateField(v, schema, required: widget.required) == null
              ? null
              : tr(context, 'invalid');
        } on FormatException {
          return tr(context, 'invalid');
        }
      },
    );
  }
}

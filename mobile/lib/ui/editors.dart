import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import '../core/features.dart';
import 'workflow_task.dart';
import 'form_feedback.dart';

/// Small, explicit field sets. Payloads never contain read-only API properties.
class RecordEditor extends StatefulWidget {
  const RecordEditor({
    super.key,
    required this.title,
    required this.path,
    required this.fields,
    this.initial = const {},
    this.method = 'PATCH',
    this.fixed = const {},
    this.requiredFields = const {},
    this.notice,
  });
  final String title, path, method;
  final List<String> fields;
  final Set<String> requiredFields;
  final Json initial, fixed;
  final String? notice;
  @override
  State<RecordEditor> createState() => _RecordEditorState();
}

class _RecordEditorState extends State<RecordEditor> {
  final form = GlobalKey<FormState>();
  late final controllers = {
    for (final field in widget.fields)
      field: TextEditingController(
        text: widget.initial[field]?.toString() ?? '',
      ),
  };
  bool busy = false, dirty = false;
  Object? error;
  @override
  void dispose() {
    for (final c in controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> save() async {
    if (busy || !validateAndReveal(form)) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await AppScope.of(context).api.request(
        widget.path,
        method: widget.method,
        data: {
          ...widget.fixed,
          for (final field in widget.fields)
            field: controllers[field]!.text.trim(),
        },
      );
      if (mounted) {
        setState(() {
          dirty = false;
          busy = false;
        });
        toast(context, tr(context, 'saved'));
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !dirty && !busy,
    onPopInvokedWithResult: (didPop, _) async {
      if (didPop || busy) return;
      if (await confirm(
            context,
            tr(context, 'cancel'),
            tr(context, 'discard'),
          ) &&
          mounted) {
        setState(() => dirty = false);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.pop(context);
        });
      }
    },
    child: Scaffold(
      appBar: AppBar(title: Text(tr(context, widget.title))),
      body: Form(
        key: form,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.notice != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 24),
                  child: Text(tr(context, widget.notice!)),
                ),
              for (final field in widget.fields)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: TextFormField(
                    controller: controllers[field],
                    enabled: !busy,
                    readOnly: field == 'birthDate',
                    onTap: field != 'birthDate'
                        ? null
                        : () async {
                            final now = DateTime.parse(today());
                            final date = await showDatePicker(
                              context: context,
                              initialDate: DateTime(
                                now.year - 3,
                                now.month,
                                now.day,
                              ),
                              firstDate: DateTime(now.year - 18),
                              lastDate: now,
                            );
                            if (date != null && mounted) {
                              controllers[field]!.text =
                                  '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
                              setState(() => dirty = true);
                            }
                          },
                    minLines:
                        [
                          'note',
                          'emergencyInstructions',
                          'chronicConditions',
                        ].contains(field)
                        ? 3
                        : 1,
                    maxLines:
                        [
                          'note',
                          'emergencyInstructions',
                          'chronicConditions',
                        ].contains(field)
                        ? 5
                        : 1,
                    decoration: InputDecoration(
                      labelText: tr(context, field),
                      suffixIcon: field == 'birthDate'
                          ? const Icon(Icons.calendar_month)
                          : null,
                    ),
                    onChanged: (_) => setState(() => dirty = true),
                    validator: (value) =>
                        widget.requiredFields.contains(field) &&
                            (value == null || value.trim().isEmpty)
                        ? tr(context, 'required')
                        : null,
                  ),
                ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    errorText(context, error!),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              FilledButton(
                onPressed: busy ? null : save,
                child: Text(tr(context, 'save')),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

Future<void> addChild(BuildContext context) async {
  final catalog = await FeatureCatalog.load();
  if (!context.mounted) return;
  await openWorkflowTask(
    context,
    catalog,
    catalog.operations.firstWhere((o) => o.id == 'ChildrenController_create'),
  );
}

import 'package:flutter/material.dart';
import '../core/strings.dart';

class AbsenceForm extends StatefulWidget {
  const AbsenceForm({super.key});
  @override
  State<AbsenceForm> createState() => _AbsenceFormState();
}

class _AbsenceFormState extends State<AbsenceForm> {
  final form = GlobalKey<FormState>();
  final reason = TextEditingController();
  String status = 'absent';
  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      24,
      24,
      24,
      MediaQuery.viewInsetsOf(context).bottom + 24,
    ),
    child: SingleChildScrollView(
      child: Form(
        key: form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              tr(context, 'attendance'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 20),
            DropdownButtonFormField<String>(
              initialValue: status,
              decoration: InputDecoration(labelText: tr(context, 'status')),
              items: ['absent', 'sick', 'vacation', 'excused']
                  .map(
                    (s) =>
                        DropdownMenuItem(value: s, child: Text(tr(context, s))),
                  )
                  .toList(),
              onChanged: (s) => setState(() => status = s!),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              decoration: InputDecoration(
                labelText: tr(context, 'absenceReason'),
              ),
              validator: (s) => (s?.trim().length ?? 0) < 10
                  ? tr(context, 'absenceReason')
                  : null,
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () {
                if (form.currentState!.validate()) {
                  Navigator.pop(context, {
                    'status': status,
                    'reason': reason.text.trim(),
                  });
                }
              },
              child: Text(tr(context, 'save')),
            ),
          ],
        ),
      ),
    ),
  );
}

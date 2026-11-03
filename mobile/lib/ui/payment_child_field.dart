import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'children.dart';
import 'reference_picker.dart';

class PaymentChildField extends StatefulWidget {
  const PaymentChildField({
    super.key,
    required this.child,
    required this.enabled,
    required this.onChanged,
  });
  final Json? child;
  final bool enabled;
  final ValueChanged<Json> onChanged;

  @override
  State<PaymentChildField> createState() => _PaymentChildFieldState();
}

class _PaymentChildFieldState extends State<PaymentChildField> {
  final focus = FocusNode();

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FormField<Json>(
    initialValue: widget.child,
    validator: (_) =>
        widget.child == null ? tr(context, 'selectChildRequired') : null,
    builder: (field) => InputDecorator(
      decoration: InputDecoration(
        errorText: field.errorText,
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        contentPadding: EdgeInsets.zero,
      ),
      child: Card(
        child: ListTile(
          focusNode: focus,
          leading: const Icon(Icons.child_care),
          title: Text(
            widget.child == null
                ? tr(context, 'selectChildRequired')
                : childName(widget.child!),
          ),
          subtitle: widget.child == null
              ? null
              : Text(referenceSubtitle(context, widget.child!)),
          trailing: const Icon(Icons.chevron_right),
          onTap: !widget.enabled
              ? null
              : () async {
                  final selected = await Navigator.push<Json>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const ChildrenPage(
                        select: true,
                        lookupPermission: 'payment:create',
                      ),
                    ),
                  );
                  if (selected != null && mounted) {
                    field.didChange(selected);
                    widget.onChanged(selected);
                    if (field.hasError) {
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        if (field.mounted) field.validate();
                      });
                    }
                  }
                },
        ),
      ),
    ),
  );
}

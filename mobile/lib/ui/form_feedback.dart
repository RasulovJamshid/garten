import 'package:flutter/material.dart';

/// Keep failed validation reachable, including fields above the keyboard.
bool validateAndReveal(GlobalKey<FormState> key) {
  final invalid = key.currentState!.validateGranularly();
  if (invalid.isEmpty) return true;
  final first = invalid.first;
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!first.mounted) return;
    Scrollable.ensureVisible(
      first.context,
      alignment: .15,
      duration: const Duration(milliseconds: 250),
    );
    void focus(Element element) {
      if (element.widget is EditableText) {
        (element.widget as EditableText).focusNode.requestFocus();
      } else {
        element.visitChildren(focus);
      }
    }

    (first.context as Element).visitChildren(focus);
  });
  return false;
}

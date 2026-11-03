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
      duration: MediaQuery.disableAnimationsOf(first.context)
          ? Duration.zero
          : const Duration(milliseconds: 250),
    );
    var focused = false;
    void focus(Element element) {
      if (focused) return;
      if (element.widget is EditableText) {
        (element.widget as EditableText).focusNode.requestFocus();
        focused = true;
      } else if (element.widget case Focus(
        :final focusNode,
      ) when focusNode != null && focusNode.canRequestFocus) {
        focusNode.requestFocus();
        focused = true;
      } else {
        element.visitChildren(focus);
      }
    }

    (first.context as Element).visitChildren(focus);
  });
  return false;
}

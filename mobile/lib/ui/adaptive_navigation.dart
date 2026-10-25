import 'package:flutter/material.dart';
import '../core/strings.dart';

/// Full-size labels remain on one line; a visible scrollbar exposes other tabs.
class LargeTextNavigation extends StatefulWidget {
  const LargeTextNavigation({
    super.key,
    required this.tabs,
    required this.selected,
    required this.onSelected,
  });
  final List<(String, IconData)> tabs;
  final String selected;
  final ValueChanged<String> onSelected;
  @override
  State<LargeTextNavigation> createState() => _LargeTextNavigationState();
}

class _LargeTextNavigationState extends State<LargeTextNavigation> {
  final controller = ScrollController();
  final keys = <String, GlobalKey>{};
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = keys[widget.selected]?.currentContext;
      if (mounted && target != null) {
        Scrollable.ensureVisible(target, alignment: .5);
      }
    });
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(LargeTextNavigation oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected != widget.selected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final target = keys[widget.selected]?.currentContext;
        if (mounted && target != null) {
          Scrollable.ensureVisible(
            target,
            alignment: .5,
            duration: const Duration(milliseconds: 200),
          );
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.surface,
    child: SafeArea(
      top: false,
      child: Scrollbar(
        controller: controller,
        thumbVisibility: true,
        trackVisibility: true,
        child: SingleChildScrollView(
          controller: controller,
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            children: [
              for (final tab in widget.tabs)
                Semantics(
                  selected: widget.selected == tab.$1,
                  child: TextButton(
                    key: keys.putIfAbsent(tab.$1, () => GlobalKey()),
                    onPressed: () => widget.onSelected(tab.$1),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(96, 64),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      backgroundColor: widget.selected == tab.$1
                          ? Theme.of(context).colorScheme.secondaryContainer
                          : null,
                      foregroundColor: widget.selected == tab.$1
                          ? Theme.of(context).colorScheme.onSecondaryContainer
                          : Theme.of(context).colorScheme.onSurface,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(tab.$2),
                        Text(
                          tr(
                            context,
                            tab.$1 == 'attendance' ? 'attendanceNav' : tab.$1,
                          ),
                          softWrap: false,
                          style: const TextStyle(fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}

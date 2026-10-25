import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';

class NotificationPreview extends StatelessWidget {
  const NotificationPreview({super.key, required this.values});
  final Json values;
  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    final template =
        session.references['templateKey']?[values['templateKey']?.toString()];
    if (template == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Text(tr(context, 'chooseTemplateFirst')),
      );
    }
    final data = object(values['data']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              tr(context, 'messagePreview'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            for (final language in ['uz', 'ru']) ...[
              const SizedBox(height: 12),
              Text(
                tr(context, language),
                style: Theme.of(context).textTheme.labelLarge,
              ),
              Text(
                (template[language == 'ru' ? 'bodyRu' : 'bodyUz']?.toString() ??
                        '')
                    .replaceAllMapped(RegExp(r'\{([\w.]+)\}'), (m) {
                      final value = data[m[1]]?.toString() ?? '';
                      return value.isEmpty ? '[${m[1]}]' : value;
                    }),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

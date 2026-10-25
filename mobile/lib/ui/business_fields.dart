import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/features.dart';
import '../core/strings.dart';

/// Display local business time while keeping the API's UTC timestamp intact.
class BusinessDateField extends StatelessWidget {
  const BusinessDateField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.timestamp = false,
    this.required = false,
    this.enabled = true,
    this.birthDate = false,
  });
  final String label;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final bool timestamp, required, enabled, birthDate;

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    final local = timestamp
        ? parsed?.toUtc().add(const Duration(hours: 5))
        : parsed;
    final text = local == null
        ? ''
        : '${dateText(local.toIso8601String())}'
              '${timestamp ? ' · ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}' : ''}';
    Future<void> choose() async {
      final now = DateTime.parse(today());
      final last = birthDate ? now : DateTime(2200);
      final initial = local == null || local.year < 1900 || local.isAfter(last)
          ? (birthDate ? DateTime(now.year - 3, now.month, now.day) : now)
          : local;
      final date = await showDatePicker(
        context: context,
        initialDate: initial,
        firstDate: DateTime(1900),
        lastDate: last,
      );
      if (date == null || !context.mounted) return;
      if (!timestamp) {
        onChanged(date.toIso8601String().substring(0, 10));
        return;
      }
      final initialTime =
          local ?? DateTime.now().toUtc().add(const Duration(hours: 5));
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay(
          hour: initialTime.hour,
          minute: initialTime.minute,
        ),
      );
      if (time != null && context.mounted) {
        onChanged(
          DateTime.utc(
            date.year,
            date.month,
            date.day,
            time.hour,
            time.minute,
          ).subtract(const Duration(hours: 5)).toIso8601String(),
        );
      }
    }

    return TextFormField(
      key: ValueKey('$label:$value'),
      initialValue: text,
      readOnly: true,
      enabled: enabled,
      decoration: InputDecoration(
        labelText: label,
        helperText: timestamp ? 'Asia/Tashkent (UTC+05:00)' : null,
        suffixIcon: IconButton(
          tooltip: label,
          icon: const Icon(Icons.calendar_month),
          onPressed: enabled ? choose : null,
        ),
      ),
      validator: (_) => (value == null || value == '')
          ? (required ? tr(context, 'required') : null)
          : parsed == null ||
                !validCalendarDate(value.toString().split('T').first)
          ? tr(context, 'invalid')
          : null,
      onTap: enabled ? choose : null,
    );
  }
}

class WeekdayField extends StatelessWidget {
  const WeekdayField({
    super.key,
    required this.value,
    required this.onChanged,
    required this.label,
    this.enabled = true,
  });
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final String label;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    final days = value is List ? List<int>.from(value as List) : <int>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            for (var day = 1; day <= 7; day++)
              FilterChip(
                label: Text(tr(context, 'weekday$day')),
                selected: days.contains(day),
                onSelected: !enabled
                    ? null
                    : (selected) {
                        final next = {...days};
                        selected ? next.add(day) : next.remove(day);
                        onChanged(next.toList()..sort());
                      },
              ),
          ],
        ),
      ],
    );
  }
}

class WorkingHoursField extends StatelessWidget {
  const WorkingHoursField({
    super.key,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    final hours = object(value);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          tr(context, 'workingHours'),
          style: Theme.of(context).textTheme.titleSmall,
        ),
        for (final key in ['open', 'close'])
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: TextFormField(
              key: ValueKey('$key:${hours[key]}'),
              initialValue: hours[key]?.toString() ?? '',
              readOnly: true,
              enabled: enabled,
              decoration: InputDecoration(
                labelText: tr(context, key == 'open' ? 'opensAt' : 'closesAt'),
                suffixIcon: const Icon(Icons.schedule),
              ),
              validator: (_) {
                final text = hours[key]?.toString() ?? '';
                if (text.isEmpty &&
                    hours.values.every((v) => v == null || v == '')) {
                  return null;
                }
                return RegExp(r'^([01]\d|2[0-3]):[0-5]\d$').hasMatch(text)
                    ? null
                    : tr(context, 'required');
              },
              onTap: !enabled
                  ? null
                  : () async {
                      final parts = (hours[key]?.toString() ?? '').split(':');
                      final hour =
                          int.tryParse(parts.first) ?? (key == 'open' ? 7 : 19);
                      final minute = parts.length > 1
                          ? int.tryParse(parts[1]) ?? 0
                          : 0;
                      final time = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay(
                          hour: hour.clamp(0, 23),
                          minute: minute.clamp(0, 59),
                        ),
                      );
                      if (time != null && context.mounted) {
                        onChanged({
                          ...hours,
                          key:
                              '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
                        });
                      }
                    },
            ),
          ),
      ],
    );
  }
}

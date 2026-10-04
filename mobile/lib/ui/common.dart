import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';

const navy = Color(0xFF3C57B8);
const amber = Color(0xFFFAB504);
const green = Color(0xFF128477);

class PrivateAvatar extends StatefulWidget {
  const PrivateAvatar({
    super.key,
    required this.name,
    this.fileId,
    this.size = 48,
  });
  final String name;
  final String? fileId;
  final double size;
  @override
  State<PrivateAvatar> createState() => _PrivateAvatarState();
}

class _PrivateAvatarState extends State<PrivateAvatar> {
  Future<dynamic>? image;
  String? loadedId;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final session = AppScope.of(context);
    if (widget.fileId != loadedId && session.can('file:read')) {
      loadedId = widget.fileId;
      image = loadedId == null
          ? null
          : session.api.request(
              '/files/${Uri.encodeComponent(loadedId!)}',
              responseType: ResponseType.bytes,
            );
    }
  }

  @override
  void didUpdateWidget(PrivateAvatar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.fileId != widget.fileId) didChangeDependencies();
  }

  @override
  Widget build(BuildContext context) {
    final fallback = SizedBox(
      width: widget.size,
      height: widget.size,
      child: PersonAvatar(widget.name),
    );
    if (!AppScope.of(context).can('file:read') || image == null) {
      return fallback;
    }
    return FutureBuilder<dynamic>(
      future: image,
      builder: (context, snapshot) =>
          snapshot.hasData && snapshot.data is List<int>
          ? ClipRRect(
              borderRadius: BorderRadius.circular(widget.size / 3),
              child: Image.memory(
                Uint8List.fromList(snapshot.data as List<int>),
                width: widget.size,
                height: widget.size,
                fit: BoxFit.cover,
                semanticLabel: widget.name,
                errorBuilder: (_, _, _) => fallback,
              ),
            )
          : fallback,
    );
  }
}

String errorText(BuildContext context, Object error) {
  if (error is ApiFailure) {
    if ([
      'PROFILE_LOAD_FAILED',
      'INVALID_AUTH_RESPONSE',
      'INVALID_CREDENTIALS',
      'ACCOUNT_LOCKED',
      'ACCOUNT_INACTIVE',
    ].contains(error.code)) {
      return tr(context, error.code);
    }
    if (error.status == 403) return tr(context, 'FORBIDDEN');
    if (error.status == 401) return tr(context, 'UNAUTHORIZED');
    if (error.status == 429) return tr(context, 'RATE_LIMITED');
    return tr(
      context,
      labels.containsKey(error.code) ? error.code : 'REQUEST_FAILED',
    );
  }
  return tr(context, 'REQUEST_FAILED');
}

void toast(BuildContext context, String text) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

class FailureView extends StatelessWidget {
  const FailureView(this.error, this.retry, {super.key});
  final Object error;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_rounded,
            size: 44,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 16),
          Text(errorText(context, error), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton.tonal(
            onPressed: retry,
            child: Text(tr(context, 'retry')),
          ),
        ],
      ),
    ),
  );
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(40),
    child: Column(
      children: [
        Icon(
          Icons.inbox_outlined,
          size: 48,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: 16),
        Text(tr(context, 'empty')),
      ],
    ),
  );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final good = [
      'active',
      'inside',
      'present',
      'paid',
      'sent',
    ].contains(status);
    final bad = ['cancelled', 'failed', 'sick', 'suspended'].contains(status);
    final color = good
        ? Theme.of(context).colorScheme.secondary
        : bad
        ? Theme.of(context).colorScheme.error
        : Theme.of(context).colorScheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .09),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        tr(context, status),
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class PersonAvatar extends StatelessWidget {
  const PersonAvatar(this.name, {super.key});
  final String name;
  @override
  Widget build(BuildContext context) => CircleAvatar(
    radius: 24,
    backgroundColor: Theme.of(context).colorScheme.primaryContainer,
    child: Text(
      name.isEmpty ? '?' : name.characters.first.toUpperCase(),
      style: TextStyle(
        color: Theme.of(context).colorScheme.onPrimaryContainer,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

Future<bool> confirm(BuildContext context, String title, String body) async =>
    await showAdaptiveDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog.adaptive(
        title: Text(title),
        content: SingleChildScrollView(child: Text(body)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(tr(context, 'cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(tr(context, 'confirm')),
          ),
        ],
      ),
    ) ??
    false;

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 12),
    child: Text(
      text,
      style: Theme.of(
        context,
      ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
    ),
  );
}

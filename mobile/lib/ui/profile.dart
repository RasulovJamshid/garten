import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';

String profileRoleName(Json role, String language) {
  for (final key in [
    language == 'ru' ? 'nameRu' : 'nameUz',
    language == 'ru' ? 'nameUz' : 'nameRu',
    'name',
  ]) {
    final name = role[key]?.toString().trim() ?? '';
    if (name.isNotEmpty) return name;
  }
  final code = role['code']?.toString().trim() ?? '';
  return translate(language, code.isEmpty ? 'role' : code);
}

class CurrentProfileCard extends StatelessWidget {
  const CurrentProfileCard({super.key});

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    final roles = session.roles;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                PersonAvatar(session.name),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        session.name,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        session.profile?['organization']?['name']?.toString() ??
                            'Alishax Kids',
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            const Divider(),
            const SizedBox(height: 14),
            Text(
              tr(context, 'currentRoles'),
              style: Theme.of(context).textTheme.labelSmall,
            ),
            const SizedBox(height: 8),
            if (roles.isEmpty)
              Text(
                tr(
                  context,
                  session.profile?['roles'] is List
                      ? 'noAssignedRoles'
                      : 'roleInfoUnavailable',
                ),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final role in roles)
                    Chip(
                      avatar: Icon(
                        Icons.verified_user_outlined,
                        size: 17,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                      label: Text(profileRoleName(role, session.language)),
                      backgroundColor: Theme.of(
                        context,
                      ).colorScheme.primary.withValues(alpha: .06),
                      side: BorderSide.none,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 4,
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

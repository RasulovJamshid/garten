import 'package:flutter/material.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'attendance.dart';
import 'children.dart';
import 'common.dart';
import 'payment.dart';
import 'resources.dart';
import 'editors.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  String selected = 'today';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      AppScope.of(context).reload().catchError((Object _) {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    final tabs = <(String, IconData)>[
      ('today', Icons.wb_sunny_outlined),
      if (session.can('attendance:read'))
        ('attendance', Icons.fact_check_outlined),
      if (session.can('child:read')) ('children', Icons.child_care),
      if ([
        'payment:read',
        'payment:create',
        'debt:read',
        'charge:read',
        'expense:read',
      ].any(session.can))
        ('finance', Icons.account_balance_wallet_outlined),
      ('more', Icons.grid_view_rounded),
    ];
    if (!tabs.any((t) => t.$1 == selected)) selected = 'today';
    final index = tabs.indexWhere((t) => t.$1 == selected);
    final body = switch (selected) {
      'attendance' => const AttendancePage(),
      'children' => const ChildrenPage(),
      'finance' => const FinancePage(),
      'more' => const MorePage(),
      _ => TodayPage(
        onAttendance: () => setState(() => selected = 'attendance'),
        onChildren: () => setState(() => selected = 'children'),
      ),
    };
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 720;
        return Scaffold(
          appBar: AppBar(
            toolbarHeight: MediaQuery.textScalerOf(
              context,
            ).scale(52).clamp(72, 120),
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'ALISHAX KIDS',
                  style: TextStyle(
                    fontSize: 11,
                    letterSpacing: 2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  tr(context, selected),
                  style: const TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                tooltip: tr(context, 'account'),
                onPressed: () => setState(() => selected = 'more'),
                icon: const Icon(Icons.account_circle_outlined),
              ),
              const SizedBox(width: 8),
            ],
          ),
          body: SafeArea(
            child: Row(
              children: [
                if (wide)
                  NavigationRail(
                    selectedIndex: index,
                    labelType: NavigationRailLabelType.all,
                    onDestinationSelected: (i) =>
                        setState(() => selected = tabs[i].$1),
                    destinations: tabs
                        .map(
                          (t) => NavigationRailDestination(
                            icon: Icon(t.$2),
                            label: Text(tr(context, t.$1)),
                          ),
                        )
                        .toList(),
                  ),
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 900),
                      child: body,
                    ),
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: wide
              ? null
              : NavigationBar(
                  selectedIndex: index,
                  onDestinationSelected: (i) =>
                      setState(() => selected = tabs[i].$1),
                  destinations: tabs
                      .map(
                        (t) => NavigationDestination(
                          icon: Icon(t.$2),
                          label: tr(context, t.$1),
                        ),
                      )
                      .toList(),
                ),
        );
      },
    );
  }
}

class TodayPage extends StatelessWidget {
  const TodayPage({
    super.key,
    required this.onAttendance,
    required this.onChildren,
  });
  final VoidCallback onAttendance, onChildren;
  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    return RefreshIndicator(
      onRefresh: () async {
        try {
          await session.reload();
        } catch (e) {
          if (context.mounted) toast(context, errorText(context, e));
        }
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(26),
            decoration: BoxDecoration(
              color: navy,
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.wb_sunny_rounded, color: amber),
                    const SizedBox(width: 10),
                    Text(
                      dateText(today()),
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
                const SizedBox(height: 26),
                Text(
                  session.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  tr(context, 'workspace'),
                  style: const TextStyle(color: Colors.white70, fontSize: 16),
                ),
              ],
            ),
          ),
          SectionTitle(tr(context, 'quickActions')),
          if (session.can('child:create'))
            action(
              context,
              Icons.person_add_alt,
              'addChild',
              () => addChild(context),
            ),
          if (session.can('attendance:read'))
            action(
              context,
              Icons.fact_check_outlined,
              'attendance',
              onAttendance,
            ),
          if (session.can('child:read'))
            action(context, Icons.child_care, 'children', onChildren),
          if (session.can('payment:create'))
            action(
              context,
              Icons.add_card,
              'recordPayment',
              () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const PaymentPage()),
              ),
            ),
          for (final spec in modules.where(
            (m) =>
                ['debts', 'announcements', 'groups'].contains(m.title) &&
                session.can(m.permission),
          ))
            action(
              context,
              spec.icon,
              spec.title,
              () => Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => ResourcePage(spec: spec),
                ),
              ),
            ),
          if (![
            'attendance:read',
            'child:read',
            'debt:read',
            'announcement:manage',
            'group:read',
          ].any(session.can))
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(tr(context, 'noAccess')),
            ),
        ],
      ),
    );
  }
}

Widget action(
  BuildContext context,
  IconData icon,
  String title,
  VoidCallback onTap,
) => Card(
  child: ListTile(
    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
    leading: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: amber.withValues(alpha: .16),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Icon(icon, color: navy),
    ),
    title: Text(
      tr(context, title),
      style: const TextStyle(fontWeight: FontWeight.w700),
    ),
    trailing: const Icon(Icons.chevron_right),
    onTap: onTap,
  ),
);

class FinancePage extends StatelessWidget {
  const FinancePage({super.key});
  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (session.can('payment:create')) ...[
          FilledButton.icon(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute<void>(builder: (_) => const PaymentPage()),
            ),
            icon: const Icon(Icons.add),
            label: Text(tr(context, 'recordPayment')),
          ),
          const SizedBox(height: 20),
        ],
        for (final spec
            in modules.take(4).where((m) => session.can(m.permission)))
          action(
            context,
            spec.icon,
            spec.title,
            () => Navigator.push(
              context,
              MaterialPageRoute<void>(builder: (_) => ResourcePage(spec: spec)),
            ),
          ),
      ],
    );
  }
}

class MorePage extends StatelessWidget {
  const MorePage({super.key});
  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(20),
            leading: PersonAvatar(session.name),
            title: Text(
              session.name,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              session.profile?['organization']?['name']?.toString() ??
                  'Alishax Kids',
            ),
          ),
        ),
        for (final spec
            in modules.skip(4).where((m) => session.can(m.permission)))
          action(
            context,
            spec.icon,
            spec.title,
            () => Navigator.push(
              context,
              MaterialPageRoute<void>(builder: (_) => ResourcePage(spec: spec)),
            ),
          ),
        SectionTitle(tr(context, 'account')),
        Card(
          child: SwitchListTile.adaptive(
            title: Text(tr(context, 'language')),
            subtitle: Text(session.language == 'ru' ? 'Русский' : 'O‘zbekcha'),
            value: session.language == 'ru',
            onChanged: (v) => session.setLanguage(v ? 'ru' : 'uz'),
          ),
        ),
        action(context, Icons.refresh, 'refreshAccess', () async {
          try {
            await session.reload();
            if (context.mounted) toast(context, tr(context, 'updated'));
          } catch (e) {
            if (context.mounted) toast(context, errorText(context, e));
          }
        }),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () async {
            if (!await confirm(context, tr(context, 'logout'), session.name)) {
              return;
            }
            try {
              await session.api.logout();
            } catch (_) {
              /* Local credentials are cleared even offline. */
            }
          },
          icon: const Icon(Icons.logout),
          label: Text(tr(context, 'logout')),
        ),
      ],
    );
  }
}

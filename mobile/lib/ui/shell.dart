import 'package:flutter/material.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'attendance.dart';
import 'children.dart';
import 'common.dart';
import 'payment.dart';
import 'resources.dart';
import 'editors.dart';
import 'features.dart';
import 'profile.dart';
import '../core/workflows.dart';
import '../core/features.dart';
import 'workflows.dart';

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
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
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
              : DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(color: Theme.of(context).dividerColor),
                    ),
                  ),
                  child: NavigationBar(
                    selectedIndex: index,
                    onDestinationSelected: (i) =>
                        setState(() => selected = tabs[i].$1),
                    destinations: tabs
                        .map(
                          (t) => NavigationDestination(
                            icon: Icon(t.$2),
                            label: tr(
                              context,
                              t.$1 == 'attendance' ? 'attendanceNav' : t.$1,
                            ),
                            tooltip: tr(context, t.$1),
                          ),
                        )
                        .toList(),
                  ),
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
    void open(Widget page) =>
        Navigator.push(context, MaterialPageRoute<void>(builder: (_) => page));
    final shortcuts = <(IconData, String, VoidCallback)>[
      if (session.can('attendance:read'))
        (Icons.fact_check_outlined, 'attendance', onAttendance),
      if (session.can('child:read'))
        (Icons.child_care_rounded, 'children', onChildren),
      if (session.can('payment:create'))
        (
          Icons.add_card_rounded,
          'recordPayment',
          () => open(const PaymentPage()),
        ),
      if (session.can('child:create'))
        (Icons.person_add_alt_rounded, 'addChild', () => addChild(context)),
      for (final spec in modules.where(
        (m) =>
            ['debts', 'announcements', 'groups'].contains(m.title) &&
            session.can(m.permission),
      ))
        (spec.icon, spec.title, () => open(ResourcePage(spec: spec))),
    ];
    return RefreshIndicator(
      onRefresh: () async {
        try {
          await session.reload();
        } catch (e) {
          if (context.mounted) toast(context, errorText(context, e));
        }
      },
      child: LayoutBuilder(
        builder: (context, constraints) {
          final columns = constraints.maxWidth >= 650
              ? 3
              : MediaQuery.textScalerOf(context).scale(14) < 20
              ? 2
              : 1;
          final width =
              (constraints.maxWidth - 40 - (columns - 1) * 12) / columns;
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            children: [
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF3C57B8), Color(0xFF243B89)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(
                          Icons.wb_sunny_outlined,
                          color: Color(0xFFFFD57E),
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            dateText(today()),
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.auto_awesome_outlined,
                          color: Colors.white54,
                          size: 22,
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Text(
                      session.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 25,
                        height: 1.3,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -.4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      tr(context, 'workspaceSubtitle'),
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 14,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Card(
                color: Theme.of(context).colorScheme.surfaceContainerHigh,
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 10,
                  ),
                  leading: Icon(
                    Icons.space_dashboard_outlined,
                    color: Theme.of(context).colorScheme.primary,
                    size: 26,
                  ),
                  title: Text(
                    tr(context, 'allFeatures'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  trailing: Icon(
                    Icons.arrow_forward_rounded,
                    color: Theme.of(context).colorScheme.primary,
                    size: 20,
                  ),
                  onTap: () => open(const FeatureWorkspace()),
                ),
              ),
              SectionTitle(tr(context, 'quickActions')),
              Wrap(
                spacing: 12,
                children: [
                  for (var i = 0; i < shortcuts.length; i++)
                    SizedBox(
                      width: width,
                      child: Card(
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: shortcuts[i].$3,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 128),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(10),
                                    decoration: BoxDecoration(
                                      color:
                                          (i.isEven
                                                  ? Theme.of(
                                                      context,
                                                    ).colorScheme.primary
                                                  : Theme.of(
                                                      context,
                                                    ).colorScheme.secondary)
                                              .withValues(alpha: .08),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Icon(
                                      shortcuts[i].$1,
                                      color: i.isEven
                                          ? Theme.of(
                                              context,
                                            ).colorScheme.primary
                                          : Theme.of(
                                              context,
                                            ).colorScheme.secondary,
                                      size: 23,
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    tr(context, shortcuts[i].$2),
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              if (shortcuts.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(tr(context, 'noAccess')),
                ),
            ],
          );
        },
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
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    leading: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Icon(icon, color: Theme.of(context).colorScheme.primary, size: 22),
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
        FutureBuilder<FeatureCatalog>(
          future: FeatureCatalog.load(),
          builder: (context, snapshot) {
            if (!snapshot.hasData) return const SizedBox.shrink();
            final groups = snapshot.data!
                .available(session)
                .map((o) => o.group)
                .toSet();
            return Column(
              children: [
                for (final group in groups.where(
                  (g) => workflowSpecs[g]?.category == 'moneyWork',
                ))
                  action(
                    context,
                    featureIcon(group),
                    group,
                    () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => WorkflowSection(
                          group: group,
                          catalog: snapshot.data,
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
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
        const CurrentProfileCard(),
        action(
          context,
          Icons.apps,
          'allFeatures',
          () => Navigator.push(
            context,
            MaterialPageRoute<void>(builder: (_) => const FeatureWorkspace()),
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
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: DropdownButtonFormField<ThemeMode>(
              initialValue: session.themeMode,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: tr(context, 'appearance'),
                prefixIcon: const Icon(Icons.contrast),
              ),
              items: [
                for (final mode in ThemeMode.values)
                  DropdownMenuItem(
                    value: mode,
                    child: Text(tr(context, 'theme_${mode.name}')),
                  ),
              ],
              onChanged: (mode) async {
                if (mode == null) return;
                try {
                  await session.setThemeMode(mode);
                } catch (e) {
                  if (context.mounted) toast(context, errorText(context, e));
                }
              },
            ),
          ),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  tr(context, 'language'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'uz', label: Text('O‘zbekcha')),
                    ButtonSegment(value: 'ru', label: Text('Русский')),
                  ],
                  selected: {session.language},
                  onSelectionChanged: (values) =>
                      session.setLanguage(values.first),
                ),
              ],
            ),
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

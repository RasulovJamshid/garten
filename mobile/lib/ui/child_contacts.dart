import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import '../core/workflows.dart';
import 'common.dart';
import 'reference_picker.dart';

/// Read only the guardians linked to this child, under child:read scope.
class ChildContacts extends StatefulWidget {
  const ChildContacts({super.key, required this.childId});
  final String childId;
  @override
  State<ChildContacts> createState() => _ChildContactsState();
}

class _ChildContactsState extends State<ChildContacts> {
  Future<dynamic>? request;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (AppScope.of(context).can('child:read')) request ??= load();
  }

  Future<dynamic> load() =>
      AppScope.of(context).api.request('/children/${widget.childId}/guardians');

  @override
  void didUpdateWidget(ChildContacts oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.childId != widget.childId &&
        AppScope.of(context).can('child:read')) {
      request = load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!AppScope.of(context).can('child:read')) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(tr(context, 'parentContacts')),
        FutureBuilder<dynamic>(
          future: request,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return FailureView(
                snapshot.error!,
                () => setState(() => request = load()),
              );
            }
            if (snapshot.connectionState != ConnectionState.done) {
              return const LinearProgressIndicator();
            }
            final contacts = records(snapshot.data);
            if (contacts.isEmpty) return Text(tr(context, 'noLinkedParents'));
            return Column(
              children: [
                for (final raw in contacts)
                  Builder(
                    builder: (context) {
                      final person = workflowRow('guardianId', raw);
                      final phone = person['phone'] ?? person['phoneNumber'];
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                referenceTitle(context, person),
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              if (person['relationship'] != null)
                                Text(
                                  tr(
                                    context,
                                    person['relationship'].toString(),
                                  ),
                                ),
                              SelectableText(
                                phone?.toString() ??
                                    tr(context, 'phoneNotProvided'),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

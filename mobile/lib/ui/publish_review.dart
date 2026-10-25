import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/features.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'features.dart';
import 'workflows.dart';

class PublishReviewPage extends StatefulWidget {
  const PublishReviewPage({super.key, required this.operation});
  final FeatureOperation operation;
  @override
  State<PublishReviewPage> createState() => _PublishReviewPageState();
}

class _PublishReviewPageState extends State<PublishReviewPage> {
  Future<dynamic>? draft;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (AppScope.of(context).can('landing:manage')) draft ??= load();
  }

  Future<dynamic> load() => AppScope.of(context).api.request('/landing');
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr(context, 'reviewPublication'))),
    body: !AppScope.of(context).can('landing:manage')
        ? Padding(
            padding: const EdgeInsets.all(20),
            child: Text(tr(context, 'publicationReadRequired')),
          )
        : FutureBuilder<dynamic>(
            future: draft,
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return FailureView(
                  snapshot.error!,
                  () => setState(() => draft = load()),
                );
              }
              if (!snapshot.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              final data = object(snapshot.data);
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(tr(context, 'publicationReviewHelp')),
                  const SizedBox(height: 16),
                  Text(
                    tr(
                      context,
                      data['hasUnpublishedChanges'] == false
                          ? 'noDraftChanges'
                          : 'draftChangesPending',
                    ),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  WorkflowRecordSummary(
                    record: {
                      'version': data['version'],
                      'publishedAt': data['publishedAt'],
                      'seo': data['seo'],
                    },
                  ),
                  for (final block in records(data['blocks']))
                    WorkflowRecordSummary(
                      record: {
                        'type': block['type'],
                        'blockOrder': block['position'] is num
                            ? (block['position'] as num) + 1
                            : block['position'],
                        'isVisible': block['isVisible'],
                        'content': block['content'],
                      },
                    ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: data['hasUnpublishedChanges'] == false
                        ? null
                        : () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => FeatureOperationPage(
                                operation: widget.operation,
                                guided: true,
                              ),
                            ),
                          ),
                    child: Text(tr(context, 'continuePublication')),
                  ),
                ],
              );
            },
          ),
  );
}

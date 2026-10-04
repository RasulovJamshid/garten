import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'children.dart';
import 'common.dart';

class PaymentPage extends StatefulWidget {
  const PaymentPage({super.key});
  @override
  State<PaymentPage> createState() => _PaymentPageState();
}

class _PaymentPageState extends State<PaymentPage> {
  final form = GlobalKey<FormState>();
  final amount = TextEditingController(), note = TextEditingController();
  Json? child, submission;
  String method = 'cash', key = const Uuid().v4();
  bool busy = false, restoring = true, dirty = false;
  late String storageKey;
  Object? error;
  bool initialized = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!initialized) {
      initialized = true;
      restore();
    }
  }

  Future<void> restore() async {
    final session = AppScope.of(context);
    storageKey =
        'payment:${session.api.dio.options.baseUrl}:${object(session.profile?['user'])['id']}';
    try {
      final saved = await session.api.secrets.read(storageKey);
      if (saved != null) {
        final data = object(jsonDecode(saved));
        submission = object(data['payload']);
        key = data['key'].toString();
        child = object(data['child']);
        method = submission!['method'].toString();
        amount.text =
            (BigInt.parse(submission!['amountTiyin'].toString()) ~/
                    BigInt.from(100))
                .toString();
        dirty = true;
      }
    } catch (e) {
      error = e;
    }
    if (mounted) setState(() => restoring = false);
  }

  @override
  void dispose() {
    amount.dispose();
    note.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (busy || !form.currentState!.validate()) return;
    if (child == null) {
      toast(context, tr(context, 'children'));
      return;
    }
    final session = AppScope.of(context);
    final payload =
        submission ??
        {
          'childId': child!['id'],
          'amountTiyin': toTiyin(amount.text),
          'method': method,
          'paidAt': DateTime.now().toUtc().toIso8601String(),
          if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
        };
    if (!await confirm(
      context,
      tr(context, 'paymentReview'),
      '${childName(child!)}\n${money(payload['amountTiyin'])}\n${tr(context, method)}',
    )) {
      return;
    }
    if (!mounted) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      // Persist the exact request BEFORE sending. Retrying after restart reuses
      // both the original payload and its idempotency key, including paidAt.
      await session.api.secrets.write(
        storageKey,
        jsonEncode({'payload': payload, 'key': key, 'child': child}),
      );
      submission = payload;
      await session.api.request(
        '/payments',
        method: 'POST',
        data: payload,
        idempotencyKey: key,
      );
      await session.api.secrets.delete(storageKey);
      if (mounted) {
        setState(() {
          dirty = false;
          busy = false;
        });
        toast(context, tr(context, 'saved'));
        Navigator.pop(context, true);
      }
    } catch (e) {
      // Validation errors are definitive rejection, so the operator can fix
      // fields. Timeouts/server errors keep the original operation intact.
      if (e is ApiFailure && [400, 422].contains(e.status)) {
        await session.api.secrets.delete(storageKey);
        submission = null;
        key = const Uuid().v4();
      }
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !busy && !dirty,
    onPopInvokedWithResult: (didPop, result) async {
      if (didPop || busy) return;
      if (await confirm(
            context,
            tr(context, 'cancel'),
            tr(context, submission == null ? 'discard' : 'paymentUncertain'),
          ) &&
          mounted) {
        setState(() => dirty = false);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.pop(context);
        });
      }
    },
    child: Scaffold(
      appBar: AppBar(title: Text(tr(context, 'recordPayment'))),
      body: restoring
          ? const Center(child: CircularProgressIndicator.adaptive())
          : Form(
              key: form,
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.child_care),
                      title: Text(
                        child == null
                            ? tr(context, 'children')
                            : childName(child!),
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: busy || submission != null
                          ? null
                          : () async {
                              final selected = await Navigator.push<Json>(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => const ChildrenPage(
                                    select: true,
                                    lookupPermission: 'payment:create',
                                  ),
                                ),
                              );
                              if (selected != null && mounted) {
                                setState(() {
                                  child = selected;
                                  dirty = true;
                                });
                              }
                            },
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (submission != null) ...[
                    Text(
                      money(submission!['amountTiyin']),
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 12),
                    Text(tr(context, 'paymentUncertain')),
                    const SizedBox(height: 16),
                  ],
                  if (submission == null) ...[
                    TextFormField(
                      controller: amount,
                      enabled: !busy,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      onChanged: (_) => setState(() => dirty = true),
                      decoration: InputDecoration(
                        labelText: tr(context, 'amount'),
                      ),
                      validator: (v) {
                        try {
                          toTiyin(v ?? '');
                          return null;
                        } catch (_) {
                          return tr(context, 'invalidAmount');
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      initialValue: method,
                      decoration: InputDecoration(
                        labelText: tr(context, 'method'),
                      ),
                      items: ['cash', 'bank', 'card', 'online', 'other']
                          .map(
                            (m) => DropdownMenuItem(
                              value: m,
                              child: Text(tr(context, m)),
                            ),
                          )
                          .toList(),
                      onChanged: busy
                          ? null
                          : (v) => setState(() {
                              method = v!;
                              dirty = true;
                            }),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: note,
                      enabled: !busy,
                      maxLines: 3,
                      onChanged: (_) => setState(() => dirty = true),
                      decoration: InputDecoration(
                        labelText: tr(context, 'note'),
                      ),
                    ),
                  ],
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Text(
                        errorText(context, error!),
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: busy ? null : submit,
                    child: Text(
                      tr(context, submission == null ? 'next' : 'retry'),
                    ),
                  ),
                ],
              ),
            ),
    ),
  );
}

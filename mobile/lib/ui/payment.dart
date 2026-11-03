import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../core/api.dart';
import '../core/features.dart' show decimalMoney;
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'schema_form.dart';
import 'payment_details.dart';
import 'reference_picker.dart';
import 'form_feedback.dart';
import 'payment_child_field.dart';

class PaymentPage extends StatefulWidget {
  const PaymentPage({super.key, this.initialChild});
  final Json? initialChild;
  @override
  State<PaymentPage> createState() => _PaymentPageState();
}

class _PaymentPageState extends State<PaymentPage> {
  final form = GlobalKey<FormState>();
  final amount = TextEditingController(), note = TextEditingController();
  Json? child, submission;
  Json details = {};
  String method = 'cash', key = const Uuid().v4();
  bool busy = false, restoring = true, dirty = false;
  late String storageKey;
  Object? error;
  bool initialized = false, recoveryFailed = false;
  bool legacyRecovery = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!initialized) {
      initialized = true;
      restore();
    }
  }

  Future<void> restore() async {
    setState(() {
      restoring = true;
      recoveryFailed = false;
      error = null;
    });
    final session = AppScope.of(context);
    final selectedLabel = tr(context, 'selectedRecord');
    storageKey =
        'payment:${session.api.dio.options.baseUrl}:${object(session.profile?['user'])['id']}';
    try {
      var saved = await session.api.secrets.read(storageKey);
      legacyRecovery = false;
      if (saved == null) {
        final legacyKey =
            'operation:${session.api.dio.options.baseUrl}:${object(session.profile?['user'])['id']}:PaymentsController_create';
        final legacy = await session.api.secrets.read(legacyKey);
        if (legacy != null) {
          final previous = object(jsonDecode(legacy));
          if (previous['path'] != '/payments') {
            throw const ApiFailure('INVALID_RESPONSE');
          }
          final payload = object(previous['data']);
          saved = jsonEncode({
            'payload': payload,
            'key': previous['key'],
            'child': {'id': payload['childId'], 'fullName': selectedLabel},
          });
          storageKey = legacyKey;
          legacyRecovery = true;
        }
      }
      if (saved != null) {
        final data = object(jsonDecode(saved));
        final restored = object(data['payload']);
        final restoredChild = object(data['child']);
        final restoredKey = data['key'];
        if (restoredKey is! String ||
            restoredKey.isEmpty ||
            restored['childId'] == null ||
            restored['childId'] != restoredChild['id'] ||
            (BigInt.tryParse(restored['amountTiyin']?.toString() ?? '') ??
                    BigInt.zero) <=
                BigInt.zero ||
            ![
              'cash',
              'bank',
              'card',
              'online',
              'other',
            ].contains(restored['method']) ||
            DateTime.tryParse(restored['paidAt']?.toString() ?? '') == null) {
          throw const ApiFailure('INVALID_RESPONSE');
        }
        submission = restored;
        details = {
          for (final e in restored.entries)
            if (!['childId', 'amountTiyin', 'method', 'note'].contains(e.key))
              e.key: e.value,
        };
        key = restoredKey;
        child = restoredChild;
        method = restored['method'].toString();
        amount.text = decimalMoney(restored['amountTiyin']);
        note.text = restored['note']?.toString() ?? '';
        dirty = true;
      } else {
        submission = null;
        child = widget.initialChild;
        details = {'paidAt': DateTime.now().toUtc().toIso8601String()};
        amount.clear();
        note.clear();
        method = 'cash';
        key = const Uuid().v4();
        dirty = false;
      }
    } catch (e) {
      recoveryFailed = true;
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
    if (busy || restoring || recoveryFailed || !validateAndReveal(form)) {
      return;
    }
    final session = AppScope.of(context);
    final wasUncertain = submission != null;
    final payload =
        submission ??
        {
          ...details,
          'childId': child!['id'],
          'amountTiyin': toTiyin(amount.text),
          'method': method,
          if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
        };
    if (!await confirm(
      context,
      tr(context, 'paymentReview'),
      [
        childName(child!),
        referenceSubtitle(context, child!),
        money(payload['amountTiyin']),
        tr(context, method),
        displayValue(context, 'paidAt', payload['paidAt']),
        if (payload['payerGuardianId'] != null)
          '${tr(context, 'payerGuardianId')}: ${session.references['guardianId']?[payload['payerGuardianId']]?['fullName'] ?? payload['payerGuardianId']}',
        if (payload['attachmentFileId'] != null)
          tr(context, 'attachmentFileId'),
        if (payload['note'] != null) payload['note'].toString(),
      ].where((v) => v.isNotEmpty).join('\n'),
      confirmLabel: tr(context, 'recordPayment'),
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
        jsonEncode(
          legacyRecovery
              ? {
                  'path': '/payments',
                  'pathValues': <String, dynamic>{},
                  'query': <String, dynamic>{},
                  'data': payload,
                  'key': key,
                }
              : {'payload': payload, 'key': key, 'child': child},
        ),
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
      // A later rejection cannot establish that an earlier attempt did not
      // commit. Restored operations always remain immutable until resolved.
      if (!wasUncertain &&
          e is ApiFailure &&
          e.status == 422 &&
          e.code == 'VALIDATION_FAILED') {
        try {
          await session.api.secrets.delete(storageKey);
          submission = null;
          key = const Uuid().v4();
        } catch (storageError) {
          if (mounted) {
            setState(() {
              recoveryFailed = true;
              error = storageError;
            });
          }
          return;
        }
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
            confirmLabel: tr(context, 'discardChanges'),
            cancelLabel: tr(context, 'keepEditing'),
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
          : recoveryFailed
          ? FailureView(error!, restore)
          : Form(
              key: form,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    PaymentChildField(
                      child: child,
                      enabled: !busy && submission == null,
                      onChanged: (selected) => setState(() {
                        child = selected;
                        details.remove('payerGuardianId');
                        details.remove('allocations');
                        dirty = true;
                      }),
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
                      const SizedBox(height: 16),
                      SchemaObjectForm(
                        schema: paymentDetailSchema,
                        value: details,
                        referenceValues: {'childId': child?['id']},
                        enabled: !busy,
                        onChanged: (v) => setState(() {
                          details = v;
                          dirty = true;
                        }),
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
    ),
  );
}

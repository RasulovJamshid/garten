import 'package:flutter/material.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';
import 'form_feedback.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final form = GlobalKey<FormState>();
  final login = TextEditingController();
  final password = TextEditingController();
  bool busy = false, hidden = true;
  Object? error;
  @override
  void dispose() {
    login.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (!validateAndReveal(form) || busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await AppScope.of(context).login(login.text.trim(), password.text);
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: AutofillGroup(
              child: Form(
                key: form,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.language_rounded, size: 18),
                        onPressed: () => AppScope.of(context).setLanguage(
                          AppScope.of(context).language == 'uz' ? 'ru' : 'uz',
                        ),
                        label: const Text('O‘zbekcha / Русский'),
                      ),
                    ),
                    const SizedBox(height: 28),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Image.asset(
                        'assets/logo-mark.png',
                        width: 68,
                        height: 68,
                        semanticLabel: 'Alishax Kids',
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Alishax Kids',
                      style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w700,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      tr(context, 'welcome'),
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      tr(context, 'loginHint'),
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    const SizedBox(height: 36),
                    TextFormField(
                      controller: login,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      decoration: InputDecoration(
                        labelText: tr(context, 'username'),
                        prefixIcon: const Icon(Icons.person_outline),
                      ),
                      validator: (v) => v == null || v.trim().isEmpty
                          ? tr(context, 'required')
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: password,
                      obscureText: hidden,
                      autofillHints: const [AutofillHints.password],
                      onFieldSubmitted: (_) => submit(),
                      decoration: InputDecoration(
                        labelText: tr(context, 'password'),
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: tr(
                            context,
                            hidden ? 'showPassword' : 'hidePassword',
                          ),
                          onPressed: () => setState(() => hidden = !hidden),
                          icon: Icon(
                            hidden
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                      ),
                      validator: (v) => v == null || v.isEmpty
                          ? tr(context, 'required')
                          : null,
                    ),
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
                      child: busy
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(tr(context, 'login')),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: busy
                          ? null
                          : () => Navigator.push(
                              context,
                              MaterialPageRoute<void>(
                                builder: (_) => const ResetPasswordPage(),
                              ),
                            ),
                      child: Text(tr(context, 'forgot')),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class ResetPasswordPage extends StatefulWidget {
  const ResetPasswordPage({super.key});
  @override
  State<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends State<ResetPasswordPage> {
  final form = GlobalKey<FormState>();
  final login = TextEditingController(),
      token = TextEditingController(),
      password = TextEditingController();
  bool sent = false, busy = false, hidden = true;
  @override
  void dispose() {
    login.dispose();
    token.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> send() async {
    if (busy || !validateAndReveal(form)) return;
    setState(() => busy = true);
    try {
      final api = AppScope.of(context).api;
      // Password recovery endpoints do not require a bearer token.
      await api.dio.post(
        sent ? '/auth/reset-password' : '/auth/forgot-password',
        data: sent
            ? {'token': token.text.trim(), 'newPassword': password.text}
            : {'login': login.text.trim()},
      );
      if (!mounted) return;
      if (sent) {
        toast(context, tr(context, 'saved'));
        Navigator.pop(context);
      } else {
        setState(() => sent = true);
      }
    } catch (_) {
      if (mounted) toast(context, tr(context, 'REQUEST_FAILED'));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr(context, 'reset'))),
    body: Form(
      key: form,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          if (!sent) ...[
            Text(tr(context, 'recoveryHelp')),
            const SizedBox(height: 20),
            TextFormField(
              key: const ValueKey('recovery-login'),
              controller: login,
              enabled: !busy,
              autocorrect: false,
              autofillHints: const [AutofillHints.username],
              textInputAction: TextInputAction.done,
              onFieldSubmitted: (_) => send(),
              decoration: InputDecoration(labelText: tr(context, 'username')),
              validator: (value) => value == null || value.trim().isEmpty
                  ? tr(context, 'recoveryLoginRequired')
                  : null,
            ),
          ],
          if (sent) ...[
            Text(tr(context, 'resetSent')),
            const SizedBox(height: 20),
            TextFormField(
              key: const ValueKey('recovery-code'),
              controller: token,
              enabled: !busy,
              autocorrect: false,
              autofillHints: const [AutofillHints.oneTimeCode],
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: tr(context, 'token')),
              validator: (value) => value == null || value.trim().isEmpty
                  ? tr(context, 'recoveryCodeRequired')
                  : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              key: const ValueKey('recovery-password'),
              controller: password,
              enabled: !busy,
              obscureText: hidden,
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.done,
              onFieldSubmitted: (_) => send(),
              decoration: InputDecoration(
                labelText: tr(context, 'newPassword'),
                helperText: tr(context, 'passwordRecoveryLength'),
                suffixIcon: IconButton(
                  tooltip: tr(
                    context,
                    hidden ? 'showPassword' : 'hidePassword',
                  ),
                  onPressed: busy
                      ? null
                      : () => setState(() => hidden = !hidden),
                  icon: Icon(
                    hidden
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
              ),
              validator: (value) => (value?.length ?? 0) < 10
                  ? tr(context, 'passwordRecoveryLength')
                  : null,
            ),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: busy ? null : send,
            child: Text(tr(context, sent ? 'save' : 'next')),
          ),
        ],
      ),
    ),
  );
}

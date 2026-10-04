import 'package:flutter/material.dart';
import '../core/session.dart';
import '../core/strings.dart';
import 'common.dart';

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
    if (!form.currentState!.validate() || busy) return;
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
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => AppScope.of(context).setLanguage(
                          AppScope.of(context).language == 'uz' ? 'ru' : 'uz',
                        ),
                        child: const Text('O‘zbekcha / Русский'),
                      ),
                    ),
                    const SizedBox(height: 36),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Image.asset(
                        'assets/logo-mark.png',
                        width: 84,
                        height: 84,
                        semanticLabel: 'Alishax Kids',
                      ),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'Alishax Kids',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w800,
                        color: navy,
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
  final login = TextEditingController(),
      token = TextEditingController(),
      password = TextEditingController();
  bool sent = false, busy = false;
  @override
  void dispose() {
    login.dispose();
    token.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> send() async {
    if ((!sent && login.text.trim().isEmpty) ||
        (sent && (token.text.trim().isEmpty || password.text.length < 12))) {
      toast(context, tr(context, 'required'));
      return;
    }
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
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        if (!sent)
          TextField(
            controller: login,
            decoration: InputDecoration(labelText: tr(context, 'username')),
          ),
        if (sent) ...[
          Text(tr(context, 'resetSent')),
          const SizedBox(height: 20),
          TextField(
            controller: token,
            decoration: InputDecoration(labelText: tr(context, 'token')),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: password,
            obscureText: true,
            decoration: InputDecoration(labelText: tr(context, 'newPassword')),
          ),
        ],
        const SizedBox(height: 24),
        FilledButton(
          onPressed: busy ? null : send,
          child: Text(tr(context, sent ? 'save' : 'next')),
        ),
      ],
    ),
  );
}

"""Linux deployment regression checks. Run: python3 -m unittest discover -s test/deployment.

Git and Docker are replaced with local fakes; no server or registry is contacted.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
FAKE_GIT = r'''#!/usr/bin/env python3
import io, os, sys, tarfile, subprocess
a = sys.argv[1:]
if 'apply' in a:
    sys.exit(subprocess.run([os.environ['TEST_REAL_GIT'], *a]).returncode)
elif 'rev-parse' in a:
    print(os.environ.get('TEST_REVISION', 'a' * 40))
elif 'init' in a:
    os.makedirs(a[-1], exist_ok=True)
elif 'archive' in a:
    with tarfile.open(fileobj=sys.stdout.buffer, mode='w|') as archive:
        data = b'{"name":"test-frontend"}'
        entry = tarfile.TarInfo('package.json')
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))
        data = b'export const value = 1;\n'
        entry = tarfile.TarInfo('src/example.ts')
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))
'''
FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
a = sys.argv[1:]
root = pathlib.Path(os.environ['TEST_ROOT'])
with (root / 'commands.jsonl').open('a') as f:
    f.write(json.dumps(a) + '\n')
if a[0] == 'compose':
    if 'config' in a:
        print(json.dumps({'services': {
            'web': {'image': 'alishax-web:prod'},
            'caddy': {'environment': {'API_DOMAIN': 'api.example.org'}},
            'api': {'environment': {'API_PREFIX': '/api/v1'}}}}))
    elif 'ps' in a and (root / 'running').exists():
        print('live-container')
    elif 'up' in a:
        if os.environ.get('FAIL_UP') and not (root / 'failed-up').exists():
            (root / 'failed-up').touch()
            sys.exit(1)
        (root / 'running').touch()
elif a[0] == 'build':
    if os.environ.get('FAIL_BUILD'):
        sys.exit(1)
    if (pathlib.Path(a[-1]) / 'src/example.ts').read_text() != 'export const value = 2;\n':
        sys.exit('Frontend patch was not applied before building')
elif a[0] == 'run':
    print('candidate-container')
elif a[0] == 'inspect':
    if a[2] == '{{.Image}}':
        print('sha256:previous')
    else:
        print('unhealthy' if os.environ.get('FAIL_HEALTH') and a[-1] == 'candidate-container' else 'healthy')
elif a[:2] == ['image', 'inspect']:
    print('sha256:previous')
'''


@unittest.skipUnless(os.name == 'posix', 'Deployment shell checks require a POSIX environment')
class FrontendDeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ('scripts', 'deploy/frontend/patches', 'bin'):
            (self.root / directory).mkdir(parents=True)
        for name in ('scripts/deploy-frontend.sh', 'deploy/frontend/Dockerfile',
                     'deploy/frontend/context.dockerignore', 'scripts/apply-frontend-patches.py'):
            shutil.copyfile(ROOT / name, self.root / name)
        (self.root / 'deploy/frontend/patches/contract.patch').write_text(
            '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n'
            '-export const value = 1;\n+export const value = 2;\n')
        (self.root / '.env.production').write_text('')
        for name, content in [('git', FAKE_GIT), ('docker', FAKE_DOCKER)]:
            file = self.root / 'bin' / name
            file.write_text(content)
            file.chmod(0o755)

    def deploy(self, **env):
        return subprocess.run(
            ['bash', str(self.root / 'scripts/deploy-frontend.sh')],
            env={**os.environ, 'PATH': f'{self.root}/bin:{os.environ["PATH"]}',
                 'TEST_ROOT': str(self.root), 'TEST_REAL_GIT': shutil.which('git'), **env},
            text=True, capture_output=True, timeout=20)

    def commands(self):
        file = self.root / 'commands.jsonl'
        return [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []

    def current(self):
        return (self.root / 'data/frontend-deploy/current').read_text()

    def test_deploy_and_unchanged_commit_skip(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        fingerprint = self.current()
        initial = self.commands()
        up = next(c for c in initial if c[0] == 'compose' and 'up' in c)
        self.assertIn('--no-deps', up)
        self.assertEqual(up[-1], 'web')
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.current(), fingerprint)
        check = (self.root / 'data/frontend-deploy/last-successful-check').read_text()
        self.assertTrue(check.rstrip().endswith('a' * 40))
        self.assertFalse(any(c[0] == 'build' for c in self.commands()[len(initial):]))

    def test_new_commit_deploys(self):
        self.assertEqual(self.deploy().returncode, 0)
        previous = self.current()
        result = self.deploy(TEST_REVISION='b' * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(self.current(), previous)
        self.assertEqual((self.root / 'data/frontend-deploy/revision').read_text().strip(), 'b' * 40)

    def test_build_failure_leaves_previous_deployment(self):
        self.assertEqual(self.deploy().returncode, 0)
        previous, offset = self.current(), len(self.commands())
        result = self.deploy(TEST_REVISION='b' * 40, FAIL_BUILD='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current(), previous)
        self.assertFalse(any(c[0] == 'tag' or 'up' in c for c in self.commands()[offset:]))

    def test_unhealthy_candidate_never_replaces_live_container(self):
        self.assertEqual(self.deploy().returncode, 0)
        previous, offset = self.current(), len(self.commands())
        result = self.deploy(TEST_REVISION='b' * 40, FAIL_HEALTH='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current(), previous)
        self.assertFalse(any('up' in c for c in self.commands()[offset:]))
        self.assertIn(['rm', '-f', 'candidate-container'], self.commands()[offset:])

    def test_failed_replacement_restores_previous_image(self):
        self.assertEqual(self.deploy().returncode, 0)
        previous, offset = self.current(), len(self.commands())
        result = self.deploy(TEST_REVISION='b' * 40, FAIL_UP='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current(), previous)
        calls = self.commands()[offset:]
        self.assertIn(['tag', 'sha256:previous', 'alishax-web:prod'], calls)
        self.assertEqual(sum(c[0] == 'compose' and 'up' in c for c in calls), 2)

    def test_relative_api_url_rejected_before_build(self):
        result = self.deploy(FRONTEND_API_BASE_URL='/api/v1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('absolute HTTPS', result.stderr)
        self.assertFalse(any(c[0] == 'build' for c in self.commands()))


@unittest.skipIf(getattr(os, 'geteuid', lambda: -1)() == 0, 'Cron installer must be tested as a non-root deploy user')
class FrontendCronInstallationTest(FrontendDeploymentTest):
    # Reuse the deploy fixture without inheriting its test cases.
    test_deploy_and_unchanged_commit_skip = None
    test_new_commit_deploys = None
    test_build_failure_leaves_previous_deployment = None
    test_unhealthy_candidate_never_replaces_live_container = None
    test_failed_replacement_restores_previous_image = None
    test_relative_api_url_rejected_before_build = None

    def setUp(self):
        super().setUp()
        for name in ('install-frontend-watcher.sh', 'install-frontend-cron.sh'):
            shutil.copyfile(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        file = self.root / 'bin/crontab'
        file.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
file = pathlib.Path(os.environ['TEST_ROOT']) / 'user-crontab'
if sys.argv[1] == '-l':
    if not file.exists():
        print('no crontab for deploy', file=sys.stderr)
        sys.exit(1)
    print(file.read_text(), end='')
else:
    file.write_text(pathlib.Path(sys.argv[1]).read_text())
''')
        file.chmod(0o755)
        logger = self.root / 'bin/logger'
        logger.write_text('#!/bin/sh\nexit 0\n')
        logger.chmod(0o755)

    def install(self, **env):
        return subprocess.run(
            ['bash', str(self.root / 'scripts/install-frontend-watcher.sh')],
            env={**os.environ, 'PATH': f'{self.root}/bin:{os.environ["PATH"]}',
                 'TEST_ROOT': str(self.root), 'TEST_REAL_GIT': shutil.which('git'), **env},
            text=True, capture_output=True, timeout=20)

    def test_install_preserves_other_jobs_and_is_idempotent(self):
        file = self.root / 'user-crontab'
        existing = '17 3 * * * /usr/local/bin/existing-backup\n'
        file.write_text(existing)
        first = self.install()
        self.assertEqual(first.returncode, 0, first.stderr)
        installed = file.read_text()
        self.assertTrue(installed.startswith(existing))
        self.assertEqual(installed.count('# BEGIN alishax-frontend'), 1)
        self.assertIn('*/2 * * * *', installed)
        second = self.install()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(file.read_text(), installed)

    def test_failed_first_build_leaves_crontab_unchanged(self):
        file = self.root / 'user-crontab'
        existing = '17 3 * * * /usr/local/bin/existing-backup\n'
        file.write_text(existing)
        self.assertNotEqual(self.install(FAIL_BUILD='1').returncode, 0)
        self.assertEqual(file.read_text(), existing)

    def test_malformed_owned_block_does_not_remove_other_jobs(self):
        file = self.root / 'user-crontab'
        existing = '# BEGIN alishax-frontend\n17 3 * * * /usr/local/bin/existing-backup\n'
        file.write_text(existing)
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Malformed frontend cron block', result.stderr)
        self.assertEqual(file.read_text(), existing)
        self.assertEqual(self.commands(), [])


if __name__ == '__main__':
    unittest.main()

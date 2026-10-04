"""Portable checks for the maintained frontend patch workflow."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
PATCH = """--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
"""


@unittest.skipUnless(shutil.which("git"), "Git is required for patch checks")
class FrontendPatchTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        self.patches = self.root / "patches"
        (self.source / "src").mkdir(parents=True)
        self.patches.mkdir()
        self.file = self.source / "src/example.ts"
        self.file.write_text("export const value = 1;\n")
        (self.patches / "contract.patch").write_text(PATCH)

    def apply(self):
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts/apply-frontend-patches.py"),
             "--source", str(self.source), "--patches", str(self.patches)],
            text=True, capture_output=True, timeout=15,
        )

    def test_applies_to_archive_without_git_metadata(self):
        result = self.apply()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.file.read_text(), "export const value = 2;\n")

    def test_reapplying_upstream_fix_is_safe(self):
        self.assertEqual(self.apply().returncode, 0)
        self.assertEqual(self.apply().returncode, 0)
        self.assertEqual(self.file.read_text(), "export const value = 2;\n")

    def test_source_mismatch_fails_without_changes(self):
        self.file.write_text("export const value = 3;\n")
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no longer matches upstream", result.stderr)
        self.assertEqual(self.file.read_text(), "export const value = 3;\n")

    def test_checks_all_patches_before_mutating_any_file(self):
        bad = PATCH.replace("example.ts", "missing.ts")
        (self.patches / "second.patch").write_text(bad)
        self.assertNotEqual(self.apply().returncode, 0)
        self.assertEqual(self.file.read_text(), "export const value = 1;\n")

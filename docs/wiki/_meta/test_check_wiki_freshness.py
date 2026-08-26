#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_wiki_freshness.py").resolve()


class WikiFreshnessTest(unittest.TestCase):
    def make_repo(self) -> Path:
        root = Path(self.tmp.name) / self._testMethodName
        (root / "docs/wiki/_meta").mkdir(parents=True)
        (root / "v3/docs").mkdir(parents=True)
        shutil.copy(SCRIPT, root / "docs/wiki/_meta/check_wiki_freshness.py")
        self.git(root, "init", "-q")
        self.git(root, "config", "user.email", "test@example.com")
        self.git(root, "config", "user.name", "test")
        (root / "docs/wiki/README.md").write_text("# wiki\n", encoding="utf-8")
        (root / "v3/docs/base.md").write_text("# base\n", encoding="utf-8")
        self.git(root, "add", ".")
        self.git(root, "commit", "-qm", "base")
        return root

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def git(self, cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=cwd,
            check=True,
            text=True,
            capture_output=True,
        )

    def run_check(self, cwd: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", "docs/wiki/_meta/check_wiki_freshness.py"],
            cwd=cwd,
            check=False,
            text=True,
            capture_output=True,
        )

    def add_new_v3_doc(self, root: Path) -> None:
        (root / "v3/docs/new.md").write_text("# new\n", encoding="utf-8")
        self.git(root, "add", "v3/docs/new.md")

    def write_skip_ledger(
        self,
        root: Path,
        reason: str,
        source_path: str = "v3/docs/new.md",
    ) -> None:
        text = "\n".join(
            [
                "---",
                "title: skip",
                "tags: [meta/skip, status/living]",
                "status: active",
                "date: 2026-08-25",
                "links: []",
                "---",
                "",
                "| 원본 | 사유 |",
                "| --- | --- |",
                f"| `{source_path}` | {reason} |",
                "",
            ]
        )
        (root / "docs/wiki/_meta/WIKI-SKIP.md").write_text(text, encoding="utf-8")
        self.git(root, "add", "docs/wiki/_meta/WIKI-SKIP.md")

    def add_linked_evidence(self, root: Path) -> None:
        (root / "v3/functions/src").mkdir(parents=True)
        (root / "v3/functions/src/source.ts").write_text(
            "export const value = 1;\n",
            encoding="utf-8",
        )
        (root / "docs/wiki/note.md").write_text(
            "\n".join(
                [
                    "# note",
                    "",
                    "## Evidence",
                    "",
                    "- [source](../../v3/functions/src/source.ts)",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        self.git(root, "add", "v3/functions/src/source.ts", "docs/wiki/note.md")
        self.git(root, "commit", "-qm", "linked evidence")

    def change_linked_evidence(self, root: Path) -> None:
        (root / "v3/functions/src/source.ts").write_text(
            "export const value = 2;\n",
            encoding="utf-8",
        )
        self.git(root, "add", "v3/functions/src/source.ts")

    def test_missing_wiki_change_fails(self) -> None:
        root = self.make_repo()
        self.add_new_v3_doc(root)

        result = self.run_check(root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WIKI-SKIP.md", result.stdout)
        self.assertIn("v3/docs/new.md", result.stdout)

    def test_blank_skip_reason_fails(self) -> None:
        root = self.make_repo()
        self.add_new_v3_doc(root)
        self.write_skip_ledger(root, "—")

        result = self.run_check(root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing decisions", result.stdout)

    def test_skip_with_reason_passes(self) -> None:
        root = self.make_repo()
        self.add_new_v3_doc(root)
        self.write_skip_ledger(root, "one-off release note; no reusable rule")

        result = self.run_check(root)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("with skip decisions", result.stdout)

    def test_real_wiki_change_passes(self) -> None:
        root = self.make_repo()
        self.add_new_v3_doc(root)
        (root / "docs/wiki/new-note.md").write_text("# note\n", encoding="utf-8")
        self.git(root, "add", "docs/wiki/new-note.md")

        result = self.run_check(root)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_changed_linked_evidence_fails_when_wiki_doc_is_unchanged(self) -> None:
        root = self.make_repo()
        self.add_linked_evidence(root)
        self.change_linked_evidence(root)

        result = self.run_check(root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("changed evidence", result.stdout)
        self.assertIn("docs/wiki/note.md", result.stdout)
        self.assertIn("v3/functions/src/source.ts", result.stdout)

    def test_changed_linked_evidence_passes_when_wiki_doc_changes(self) -> None:
        root = self.make_repo()
        self.add_linked_evidence(root)
        self.change_linked_evidence(root)
        (root / "docs/wiki/note.md").write_text(
            "# note\n\n## Evidence\n\n- [source](../../v3/functions/src/source.ts)\n\nupdated\n",
            encoding="utf-8",
        )
        self.git(root, "add", "docs/wiki/note.md")

        result = self.run_check(root)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_changed_linked_evidence_passes_with_skip_reason(self) -> None:
        root = self.make_repo()
        self.add_linked_evidence(root)
        self.change_linked_evidence(root)
        self.write_skip_ledger(
            root,
            "implementation-only refactor; linked rule still current",
            "v3/functions/src/source.ts",
        )

        result = self.run_check(root)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_unlinked_source_change_passes(self) -> None:
        root = self.make_repo()
        self.add_linked_evidence(root)
        (root / "v3/functions/src/other.ts").write_text(
            "export const other = 1;\n",
            encoding="utf-8",
        )
        self.git(root, "add", "v3/functions/src/other.ts")

        result = self.run_check(root)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Focused regression tests for kind-aware wiki lint rules."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


def load_linter() -> object:
    target = Path(os.environ.get("LINT_TARGET", Path(__file__).with_name("lint_wiki.py")))
    spec = importlib.util.spec_from_file_location("wiki_lint_under_test", target)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load linter: {target}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


LINTER = load_linter()


class KindLintTest(unittest.TestCase):
    def lint(self, tags: str, body: str) -> list[object]:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            meta = root / "_meta"
            meta.mkdir()
            (meta / "TAXONOMY.md").write_text(
                "`domain/foundations` `kind/knowledge` `kind/archive`\n",
                encoding="utf-8",
            )
            (root / "index.md").write_text("[[note]]\n", encoding="utf-8")
            (root / "peer.md").write_text("[[note]]\n", encoding="utf-8")
            (root / "note.md").write_text(
                "---\n"
                "title: note\n"
                f"tags: [{tags}]\n"
                "status: active\n"
                "date: 2026-09-05\n"
                "links: []\n"
                "---\n\n"
                f"{body}\n",
                encoding="utf-8",
            )
            return [issue for issue in LINTER.lint(root) if issue.path == "note.md"]

    def test_knowledge_rejects_investigation_chrome(self) -> None:
        issues = self.lint(
            "domain/foundations, kind/knowledge",
            "## 무엇을 물었나\n\ntext\n\n## Evidence\n\ntext\n\n## Backlinks\n",
        )
        self.assertTrue(any(issue.code == "KSEC" for issue in issues))

    def test_knowledge_requires_current_truth(self) -> None:
        issues = self.lint(
            "domain/foundations, kind/knowledge",
            "## Evidence\n\ntext\n\n## Backlinks\n",
        )
        self.assertTrue(any(issue.code == "KSEC" for issue in issues))

    def test_archive_accepts_evidence_record(self) -> None:
        issues = self.lint(
            "domain/foundations, kind/archive",
            "## 결과 (수치)\n\ntext\n\n## Evidence\n\ntext\n\n## Backlinks\n",
        )
        self.assertFalse(any(issue.level == "ERROR" for issue in issues))


# --- ticket d8tUu9oXxZNrnaM6ZEmQ: --new-only-base (KIND WARN -> ERROR for new
# notes only) is a git-diff-driven CLI behavior, not a pure lint() input, so
# it needs a real git repo unlike the in-process tests above. Same subprocess
# + temp-git-repo shape as test_check_wiki_freshness.py.

SCRIPT = Path(os.environ.get("LINT_SCRIPT", Path(__file__).with_name("lint_wiki.py"))).resolve()

CONTENT_NOTE = """---
title: {title}
tags: [domain/methodology]
status: active
date: 2026-09-06
links: []
---

## Evidence

n/a

## Backlinks

- [[README]]
"""

README = """---
title: test wiki
tags: [meta/index]
status: active
date: 2026-09-06
links: {links}
---
# test wiki
"""


class NewOnlyBaseKindGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "docs/wiki/_meta").mkdir(parents=True)
        (self.root / "docs/wiki/40-methodology").mkdir(parents=True)
        (self.root / "docs/wiki/_meta/lint_wiki.py").write_text(
            SCRIPT.read_text(encoding="utf-8"), encoding="utf-8"
        )
        (self.root / "docs/wiki/_meta/TAXONOMY.md").write_text(
            "---\ntitle: taxonomy\ntags: [meta/index]\nstatus: active\n"
            "date: 2026-09-06\nlinks: []\n---\n\n"
            "`domain/methodology` `meta/index` `kind/knowledge` `kind/archive`\n\n"
            "## Evidence\nn/a\n\n## Backlinks\n\n- [[README]]\n",
            encoding="utf-8",
        )
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "test")
        self.write_note("legacy-note", "legacy note with no kind tag")
        self.write_readme(["legacy-note"])
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.base_sha = self.git("rev-parse", "HEAD").stdout.strip()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args], cwd=self.root, check=True, text=True, capture_output=True
        )

    def write_note(self, slug: str, title: str) -> None:
        (self.root / f"docs/wiki/40-methodology/{slug}.md").write_text(
            CONTENT_NOTE.format(title=title), encoding="utf-8"
        )

    def write_readme(self, slugs: list[str]) -> None:
        links = ", ".join(f"[[{slug}]]" for slug in [*slugs, "TAXONOMY"])
        (self.root / "docs/wiki/README.md").write_text(
            README.format(links=links), encoding="utf-8"
        )

    def run_lint(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", "docs/wiki/_meta/lint_wiki.py", "docs/wiki", *extra],
            cwd=self.root,
            check=False,
            text=True,
            capture_output=True,
        )

    def test_legacy_note_missing_kind_is_warn_without_gate(self) -> None:
        result = self.run_lint()
        self.assertEqual(result.returncode, 0)
        self.assertIn("[WARN] KIND 40-methodology/legacy-note.md", result.stdout)

    def test_legacy_note_missing_kind_stays_warn_with_gate(self) -> None:
        self.write_note("new-note", "brand new note with no kind tag")
        self.write_readme(["legacy-note", "new-note"])
        self.git("add", ".")
        self.git("commit", "-qm", "add new-note")

        result = self.run_lint("--new-only-base", self.base_sha)
        self.assertIn("[WARN] KIND 40-methodology/legacy-note.md", result.stdout)

    def test_new_note_missing_kind_is_error_with_gate(self) -> None:
        self.write_note("new-note", "brand new note with no kind tag")
        self.write_readme(["legacy-note", "new-note"])
        self.git("add", ".")
        self.git("commit", "-qm", "add new-note")

        without_gate = self.run_lint()
        self.assertEqual(without_gate.returncode, 0)
        self.assertIn("[WARN] KIND 40-methodology/new-note.md", without_gate.stdout)

        with_gate = self.run_lint("--new-only-base", self.base_sha)
        self.assertNotEqual(with_gate.returncode, 0)
        self.assertIn("[ERROR] KIND 40-methodology/new-note.md", with_gate.stdout)

    def test_tagged_new_note_passes_gate(self) -> None:
        (self.root / "docs/wiki/40-methodology/new-note.md").write_text(
            CONTENT_NOTE.format(title="brand new note")
            .replace(
                "tags: [domain/methodology]",
                "tags: [domain/methodology, kind/knowledge]",
            )
            .replace(
                "## Evidence",
                "## 지금 무엇이 참인가\n\nn/a\n\n## Evidence",
            ),
            encoding="utf-8",
        )
        self.write_readme(["legacy-note", "new-note"])
        self.git("add", ".")
        self.git("commit", "-qm", "add tagged new-note")

        result = self.run_lint("--new-only-base", self.base_sha)
        self.assertNotIn("KIND 40-methodology/new-note.md", result.stdout)
        self.assertEqual(result.returncode, 0)

    def test_unresolvable_base_warns_on_stderr_but_stays_conservative(self) -> None:
        """An unresolvable --new-only-base must not silently disable the gate.

        Reviewer note (PR #1484): this repo already learned this lesson once
        with MISSION_ADVANCE_SIGNAL going quiet for days with no trace. The
        fallback behavior (treat everything as legacy WARN) is correct and
        stays unchanged here -- only the silence was the bug.
        """
        result = self.run_lint("--new-only-base", "definitely-not-a-ref-xyz")
        self.assertEqual(result.returncode, 0)
        self.assertIn("[WARN] KIND 40-methodology/legacy-note.md", result.stdout)
        self.assertIn("--new-only-base", result.stderr)
        self.assertIn("could not be resolved", result.stderr)


if __name__ == "__main__":
    unittest.main()

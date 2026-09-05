#!/usr/bin/env python3
"""Focused regression tests for kind-aware wiki lint rules."""

from __future__ import annotations

import importlib.util
import os
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


if __name__ == "__main__":
    unittest.main()

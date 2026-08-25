#!/usr/bin/env python3
"""Flag v3/docs additions that did not touch docs/wiki.

This is intentionally small. It does not summarize source documents or write
wiki notes; it only reminds the author to decide whether a reusable rule belongs
in the wiki.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SKIP_LEDGER = Path("docs/wiki/_meta/WIKI-SKIP.md")


def run_git(args: list[str]) -> str:
    try:
        return subprocess.check_output(
            ["git", *args],
            text=True,
            stderr=subprocess.STDOUT,
        )
    except subprocess.CalledProcessError as err:
        print(err.output, file=sys.stderr, end="")
        raise


def changed_paths(diff_args: list[str]) -> tuple[set[str], set[str]]:
    output = run_git(["diff", "--name-status", "--diff-filter=AMR", *diff_args])
    added_v3_docs: set[str] = set()
    wiki_docs: set[str] = set()

    for raw_line in output.splitlines():
        parts = raw_line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0]
        path = parts[-1]
        if status.startswith("A") and path.startswith("v3/docs/") and path.endswith(".md"):
            added_v3_docs.add(path)
        if path.startswith("docs/wiki/") and path.endswith(".md"):
            wiki_docs.add(path)

    return added_v3_docs, wiki_docs


def parse_skip_ledger() -> dict[str, str]:
    if not SKIP_LEDGER.is_file():
        return {}

    decisions: dict[str, str] = {}
    for raw_line in SKIP_LEDGER.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 2:
            continue
        path = cells[0].strip("` ")
        reason = cells[1].strip()
        if not path.startswith("v3/docs/") or not path.endswith(".md"):
            continue
        decisions[path] = reason
    return decisions


def missing_skip_reasons(paths: set[str]) -> list[str]:
    decisions = parse_skip_ledger()
    missing: list[str] = []
    for path in sorted(paths):
        reason = decisions.get(path, "")
        if not reason or reason in {"-", "—"}:
            missing.append(path)
    return missing


def default_diff_args() -> list[str]:
    staged = run_git(["diff", "--cached", "--name-only"]).strip()
    if staged:
        return ["--cached"]
    return ["HEAD"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check that new v3/docs markdown prompts a wiki decision."
    )
    parser.add_argument(
        "diff_args",
        nargs="*",
        help="Arguments passed after `git diff`, for example origin/main...HEAD.",
    )
    args = parser.parse_args(argv)

    if not Path("docs/wiki").is_dir() or not Path("v3/docs").is_dir():
        print("wiki freshness: skipped outside the Marblo repo")
        return 0

    diff_args = args.diff_args or default_diff_args()
    added_v3_docs, wiki_docs = changed_paths(diff_args)
    substantive_wiki_docs = {
        path for path in wiki_docs if path != SKIP_LEDGER.as_posix()
    }
    if added_v3_docs and not substantive_wiki_docs:
        missing = missing_skip_reasons(added_v3_docs)
        if not missing:
            print(
                "wiki freshness: OK "
                f"({len(added_v3_docs)} new v3/docs markdown with skip decisions)"
            )
            return 0

        print("wiki freshness: new v3/docs markdown without docs/wiki markdown changes")
        print("Add a reusable wiki note, or record an explicit skip decision with a reason:")
        print(f"- edit {SKIP_LEDGER}")
        print("- add a table row: | `v3/docs/example.md` | one-line reason it is not wiki material |")
        print("Missing decisions:")
        for path in missing:
            print(f"- {path}")
        return 1

    print(
        "wiki freshness: OK "
        f"({len(added_v3_docs)} new v3/docs markdown, {len(wiki_docs)} wiki markdown changes)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

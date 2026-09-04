#!/usr/bin/env python3
"""Flag v3/docs additions that did not touch docs/wiki.

This is intentionally small. It does not summarize source documents or write
wiki notes; it only reminds the author to decide whether a reusable rule belongs
in the wiki.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

SKIP_LEDGER = Path("docs/wiki/_meta/WIKI-SKIP.md")
WIKI_ROOT = Path("docs/wiki")
V3_DOCS_ROOT = Path("v3/docs")
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE_RE = re.compile(r"```[\s\S]*?```|~~~[\s\S]*?~~~")
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


class StaleWikiReference:
    def __init__(self, wiki_path: str, evidence_path: str) -> None:
        self.wiki_path = wiki_path
        self.evidence_path = evidence_path


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


def changed_paths(diff_args: list[str]) -> tuple[set[str], set[str], set[str]]:
    output = run_git(["diff", "--name-status", *diff_args])
    added_v3_docs: set[str] = set()
    wiki_docs: set[str] = set()
    changed_repo_paths: set[str] = set()

    for raw_line in output.splitlines():
        parts = raw_line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0]
        changed_line_paths = [part for part in parts[1:] if part]
        path = changed_line_paths[-1]
        changed_repo_paths.update(changed_line_paths)
        if status.startswith("A") and path.startswith("v3/docs/") and path.endswith(".md"):
            added_v3_docs.add(path)
        if path.startswith("docs/wiki/") and path.endswith(".md"):
            wiki_docs.add(path)

    return added_v3_docs, wiki_docs, changed_repo_paths


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
        # ★대장이 면제할 수 있는 범위 = 검사가 지적할 수 있는 범위여야 한다.
        #   `stale_wiki_references` 는 위키가 링크한 **모든 저장소 경로**
        #   (`normalize_evidence_link` → `is_repo_path`)를 지적하는데, 여기서만
        #   `is_evidence_path`(v3/·docs/·marblo-web/docs/·terminal-sidecar/)로
        #   좁히면 그 밖의 경로는 **지적당할 수는 있어도 면제될 수는 없다** —
        #   검사가 직접 안내하는 해결책("대장에 행을 추가하라")이 조용히 듣지
        #   않는다. 실제로 `marblo-web/messages/*.json`(위키 가격 노트가 인용하는
        #   문구 사전)을 건드리는 PR 이 그 상태로 막혔다.
        #   신규 `v3/docs` 문서 쪽 게이트(`missing_skip_reasons`)는 애초에
        #   `v3/docs/**/*.md` 만 입력으로 받으므로 이 완화에 영향받지 않는다.
        if not is_repo_path(path):
            continue
        decisions[path] = reason
    return decisions


def is_repo_path(path: str) -> bool:
    return (
        bool(path)
        and not path.startswith("/")
        and not path.startswith("../")
        and "/../" not in path
        and not re.match(r"^[a-z][a-z0-9+.-]*:", path, re.IGNORECASE)
    )


def is_evidence_path(path: str) -> bool:
    return is_repo_path(path) and (
        path.startswith("v3/")
        or path.startswith("docs/")
        or path.startswith("marblo-web/docs/")
        or path.startswith("terminal-sidecar/")
    )


def missing_skip_reasons(paths: set[str]) -> list[str]:
    decisions = parse_skip_ledger()
    missing: list[str] = []
    for path in sorted(paths):
        reason = decisions.get(path, "")
        if not reason or reason in {"-", "—"}:
            missing.append(path)
    return missing


def strip_code(content: str) -> str:
    return INLINE_CODE_RE.sub(" ", FENCE_RE.sub("\n", content))


def normalize_evidence_link(repo_root: Path, wiki_doc: Path, href: str) -> str | None:
    bare = href.split("#", 1)[0].strip()
    if not bare or bare.startswith("#"):
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*:", bare, re.IGNORECASE):
        return None

    try:
        bare = unquote(bare)
    except UnicodeError:
        pass

    if is_evidence_path(bare):
        candidate = repo_root / bare
    else:
        candidate = wiki_doc.parent / bare

    try:
        rel = candidate.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return None

    if rel.startswith(f"{WIKI_ROOT.as_posix()}/"):
        return None
    return rel if is_repo_path(rel) else None


def wiki_evidence_references(repo_root: Path) -> dict[str, set[str]]:
    references: dict[str, set[str]] = {}
    root = repo_root / WIKI_ROOT
    if not root.is_dir():
        return references

    for wiki_doc in sorted(root.rglob("*.md")):
        rel_wiki = wiki_doc.relative_to(repo_root).as_posix()
        content = strip_code(wiki_doc.read_text(encoding="utf-8"))
        for match in MARKDOWN_LINK_RE.finditer(content):
            evidence = normalize_evidence_link(repo_root, wiki_doc, match.group(1))
            if evidence is None:
                continue
            references.setdefault(rel_wiki, set()).add(evidence)
    return references


def stale_wiki_references(
    changed_repo_paths: set[str],
    changed_wiki_docs: set[str],
    skip_decisions: dict[str, str],
    references: dict[str, set[str]],
) -> list[StaleWikiReference]:
    stale: list[StaleWikiReference] = []
    for wiki_path, evidence_paths in sorted(references.items()):
        if wiki_path in changed_wiki_docs:
            continue
        for evidence_path in sorted(evidence_paths & changed_repo_paths):
            reason = skip_decisions.get(evidence_path, "")
            if reason and reason not in {"-", "—"}:
                continue
            stale.append(StaleWikiReference(wiki_path, evidence_path))
    return stale


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

    if not WIKI_ROOT.is_dir() or not V3_DOCS_ROOT.is_dir():
        print("wiki freshness: skipped outside the Marblo repo")
        return 0

    diff_args = args.diff_args or default_diff_args()
    added_v3_docs, wiki_docs, changed_repo_paths = changed_paths(diff_args)
    substantive_wiki_docs = {
        path for path in wiki_docs if path != SKIP_LEDGER.as_posix()
    }
    stale_refs = stale_wiki_references(
        changed_repo_paths=changed_repo_paths,
        changed_wiki_docs=wiki_docs,
        skip_decisions=parse_skip_ledger(),
        references=wiki_evidence_references(Path(".")),
    )
    if stale_refs:
        print("wiki freshness: changed evidence is linked by unchanged wiki docs")
        print("Review the wiki note, or record an explicit skip decision with a reason:")
        print(f"- edit {SKIP_LEDGER}")
        print("- add a table row: | `v3/functions/src/example.ts` | one-line reason the linked wiki note is still current |")
        print("Stale candidates:")
        for item in stale_refs:
            print(f"- {item.wiki_path} references changed evidence {item.evidence_path}")
        return 1

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
        f"({len(added_v3_docs)} new v3/docs markdown, "
        f"{len(wiki_docs)} wiki markdown changes, "
        f"{len(stale_refs)} stale evidence references)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

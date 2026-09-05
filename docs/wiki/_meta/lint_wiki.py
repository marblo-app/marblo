#!/usr/bin/env python3
"""Read-only convention linter for docs/wiki (WIKI-SYSTEM.md §3.4).

Exit 1 on errors. Warnings (BL) do not fail. Stdlib only.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

FM_FIELDS = ("title", "tags", "status", "date", "links")
VALID_STATUS = {"stub", "draft", "active", "verified", "superseded"}
TOOL_OWNED = {"index.md", "log.md", "MEMORY.md"}
SKIP_DIRS = {
    ".git",
    ".marblo",
    "node_modules",
    ".obsidian",
    "__pycache__",
}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TAG_TOKEN_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
FENCE_RE = re.compile(r"```[\s\S]*?```|~~~[\s\S]*?~~~")
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
HEADING_EVIDENCE_RE = re.compile(r"^##\s+Evidence\s*$", re.M)
HEADING_BACKLINKS_RE = re.compile(r"^##\s+Backlinks\s*$", re.M)
BACKTICK_TAG_RE = re.compile(r"`([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)`")
ALIAS_CELL_RE = re.compile(r"`([^`]+)`")
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.M)

KIND_TAG_PREFIX = "kind/"
VALID_KINDS = {"knowledge", "archive"}
KIND_RULES: dict[str, dict[str, tuple[str, ...]]] = {
    "knowledge": {
        "required": ("지금 무엇이 참인가", "Evidence", "Backlinks"),
        "forbidden": ("한 줄 판정", "무엇을 물었나"),
    },
    "archive": {
        "required": ("Evidence", "Backlinks"),
        "forbidden": (),
    },
}


@dataclass
class Issue:
    code: str
    level: str
    path: str
    message: str


@dataclass
class Doc:
    rel: str
    text: str
    fm: dict[str, str] = field(default_factory=dict)
    fm_order: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    declared_links: list[str] = field(default_factory=list)
    body_links: list[str] = field(default_factory=list)
    backlinks_section: list[str] = field(default_factory=list)


def normalize_rel(raw: str) -> str:
    return raw.replace("\\", "/").lstrip("./")


def is_tool_owned(rel: str) -> bool:
    return Path(rel).name in TOOL_OWNED


def is_readme(rel: str) -> bool:
    return Path(rel).name.lower() == "readme.md"


def is_meta(rel: str) -> bool:
    return normalize_rel(rel).startswith("_meta/")


def is_content_note(rel: str) -> bool:
    return not (is_tool_owned(rel) or is_readme(rel) or is_meta(rel))


def strip_code(text: str) -> str:
    return INLINE_CODE_RE.sub(" ", FENCE_RE.sub("\n", text))


def extract_wikilinks(text: str) -> list[str]:
    out: list[str] = []
    for match in WIKILINK_RE.finditer(strip_code(text)):
        target = (match.group(1) or "").strip()
        if target:
            out.append(target)
    return out


def slug_of(rel: str) -> str:
    name = Path(rel).name
    stem, ext = os.path.splitext(name)
    if ext.lower() in {".md", ".markdown", ".mdown", ".mkd", ".mkdn"}:
        return stem
    return name


def walk_markdown(root: Path) -> list[Path]:
    files: list[Path] = []
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = list(current.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.is_dir():
                if entry.name not in SKIP_DIRS:
                    stack.append(entry)
                continue
            if entry.is_file() and entry.suffix.lower() in {
                ".md",
                ".markdown",
                ".mdown",
                ".mkd",
                ".mkdn",
            }:
                files.append(entry)
    files.sort()
    return files


def parse_frontmatter(text: str) -> tuple[dict[str, str], list[str], str]:
    if not text.startswith("---"):
        return {}, [], text
    rest = text[3:]
    if rest.startswith("\n"):
        rest = rest[1:]
    end = rest.find("\n---")
    if end < 0:
        return {}, [], text
    block = rest[:end]
    body = rest[end + 4 :]
    if body.startswith("\n"):
        body = body[1:]
    fields: dict[str, str] = {}
    order: list[str] = []
    for raw_line in block.splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key not in fields:
            order.append(key)
        fields[key] = value.strip()
    return fields, order, body


def parse_tags(raw: str) -> list[str]:
    return TAG_TOKEN_RE.findall(raw)


def parse_doc(rel: str, text: str) -> Doc:
    fm, order, body = parse_frontmatter(text)
    tags = parse_tags(fm.get("tags", ""))
    declared = extract_wikilinks(fm.get("links", ""))
    body_links = extract_wikilinks(body)
    backlinks: list[str] = []
    section = re.search(
        r"^##\s+Backlinks\s*$([\s\S]*?)(?=^##\s+|\Z)",
        body,
        re.M,
    )
    if section:
        backlinks = extract_wikilinks(section.group(1))
    return Doc(
        rel=rel,
        text=text,
        fm=fm,
        fm_order=order,
        tags=tags,
        declared_links=declared,
        body_links=body_links,
        backlinks_section=backlinks,
    )


def has_section(text: str, heading: str) -> bool:
    return bool(re.search(rf"^##\s+{re.escape(heading)}\s*$", text, re.M))


def load_taxonomy(root: Path) -> set[str]:
    path = root / "_meta" / "TAXONOMY.md"
    if not path.is_file():
        return set()
    text = path.read_text(encoding="utf-8")
    return set(BACKTICK_TAG_RE.findall(text))


def load_aliases(root: Path) -> dict[str, str]:
    path = root / "_meta" / "LINK-MAP.md"
    aliases: dict[str, str] = {}
    if not path.is_file():
        return aliases
    text = path.read_text(encoding="utf-8")
    in_alias = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            in_alias = stripped == "## 별칭"
            continue
        if not in_alias or not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 2:
            continue
        left = ALIAS_CELL_RE.search(cells[0])
        right = ALIAS_CELL_RE.search(cells[1])
        if not left or not right:
            continue
        alias = left.group(1).strip()
        target = right.group(1).strip()
        if alias.lower() in {"별칭", "alias"}:
            continue
        aliases[alias.lower()] = target
    return aliases


def resolve_target(
    raw: str,
    slug_map: dict[str, str],
    aliases: dict[str, str],
) -> str | None:
    key = raw.strip().replace("\\", "/").rstrip("/")
    if key.endswith(".md"):
        key = key[: -len(".md")]
    lower = key.lower()
    if lower in aliases:
        aliased = aliases[lower]
        alias_slug = slug_of(aliased).lower()
        if alias_slug in slug_map:
            return slug_map[alias_slug]
        return aliased
    base = Path(key).name.lower()
    if base in slug_map:
        return slug_map[base]
    return None


def lint(root: Path) -> list[Issue]:
    issues: list[Issue] = []
    taxonomy = load_taxonomy(root)
    aliases = load_aliases(root)
    docs: list[Doc] = []
    slug_map: dict[str, str] = {}
    slug_owners: dict[str, list[str]] = {}

    for abs_path in walk_markdown(root):
        rel = normalize_rel(str(abs_path.relative_to(root)))
        try:
            text = abs_path.read_text(encoding="utf-8")
        except OSError as err:
            issues.append(Issue("FM", "ERROR", rel, f"unreadable: {err}"))
            continue
        if is_tool_owned(rel):
            continue
        doc = parse_doc(rel, text)
        docs.append(doc)
        if is_readme(rel):
            continue
        slug = slug_of(rel).lower()
        slug_owners.setdefault(slug, []).append(rel)
        slug_map[slug] = rel

    for slug, owners in sorted(slug_owners.items()):
        if len(owners) > 1:
            issues.append(
                Issue(
                    "DUP",
                    "ERROR",
                    owners[0],
                    f"duplicate slug `{slug}` also at " + ", ".join(owners[1:]),
                )
            )

    inbound: dict[str, set[str]] = {doc.rel: set() for doc in docs}
    edges: list[tuple[str, str]] = []

    for doc in docs:
        if is_tool_owned(doc.rel):
            continue
        missing = [name for name in FM_FIELDS if name not in doc.fm]
        if missing or doc.fm_order[: len(FM_FIELDS)] != list(FM_FIELDS):
            issues.append(
                Issue(
                    "FM",
                    "ERROR",
                    doc.rel,
                    "frontmatter must be title, tags, status, date, links in that order",
                )
            )
        status = doc.fm.get("status", "")
        if status and status not in VALID_STATUS:
            issues.append(
                Issue("FM", "ERROR", doc.rel, f"invalid status `{status}`")
            )
        date = doc.fm.get("date", "")
        if date and not DATE_RE.match(date):
            issues.append(
                Issue("FM", "ERROR", doc.rel, f"invalid date `{date}`")
            )

        for tag in doc.tags:
            if taxonomy and tag not in taxonomy:
                issues.append(
                    Issue("TAG", "ERROR", doc.rel, f"tag `{tag}` is not in TAXONOMY")
                )

        if is_content_note(doc.rel):
            domains = [tag for tag in doc.tags if tag.startswith("domain/")]
            if len(domains) != 1:
                issues.append(
                    Issue(
                        "TAG",
                        "ERROR",
                        doc.rel,
                        "content notes need exactly one `domain/` tag",
                    )
                )
            if not HEADING_EVIDENCE_RE.search(doc.text) or not HEADING_BACKLINKS_RE.search(
                doc.text
            ):
                issues.append(
                    Issue(
                        "SEC",
                        "ERROR",
                        doc.rel,
                        "content notes need `## Evidence` and `## Backlinks`",
                    )
                )
            kinds = [tag.removeprefix(KIND_TAG_PREFIX) for tag in doc.tags if tag.startswith(KIND_TAG_PREFIX)]
            if not kinds:
                issues.append(
                    Issue(
                        "KIND",
                        "WARN",
                        doc.rel,
                        "unclassified legacy note; add one kind/knowledge or kind/archive tag when migrating",
                    )
                )
            elif len(kinds) != 1 or kinds[0] not in VALID_KINDS:
                issues.append(
                    Issue(
                        "KIND",
                        "ERROR",
                        doc.rel,
                        "content notes need exactly one valid kind/ tag",
                    )
                )
            else:
                kind = kinds[0]
                for heading in KIND_RULES[kind]["required"]:
                    if not has_section(doc.text, heading):
                        issues.append(
                            Issue(
                                "KSEC",
                                "ERROR",
                                doc.rel,
                                f"kind/{kind} needs `## {heading}`",
                            )
                        )
                for heading in KIND_RULES[kind]["forbidden"]:
                    if has_section(doc.text, heading):
                        issues.append(
                            Issue(
                                "KSEC",
                                "ERROR",
                                doc.rel,
                                f"kind/{kind} must not use `## {heading}`",
                            )
                        )

            title = doc.fm.get("title", "").strip()
            h1 = H1_RE.search(doc.text)
            if title and h1 and h1.group(1).strip() == title:
                issues.append(
                    Issue(
                        "TITLE",
                        "WARN",
                        doc.rel,
                        "frontmatter title duplicates H1; keep the frontmatter title and remove the H1",
                    )
                )
        elif is_meta(doc.rel):
            metas = [tag for tag in doc.tags if tag.startswith("meta/")]
            if not metas:
                issues.append(
                    Issue(
                        "TAG",
                        "ERROR",
                        doc.rel,
                        "_meta notes need at least one `meta/` tag",
                    )
                )

        sources: Iterable[str] = (*doc.declared_links, *doc.body_links)
        seen: set[str] = set()
        for raw in sources:
            key = raw.strip()
            if key.lower() in seen:
                continue
            seen.add(key.lower())
            if is_readme(key) or slug_of(key).lower() == "readme":
                continue
            resolved = resolve_target(key, slug_map, aliases)
            if not resolved:
                issues.append(
                    Issue("BRK", "ERROR", doc.rel, f"broken wikilink [[{raw}]]")
                )
                continue
            if resolved == doc.rel:
                continue
            inbound.setdefault(resolved, set()).add(doc.rel)
            edges.append((doc.rel, resolved))

    for doc in docs:
        if is_readme(doc.rel) or is_tool_owned(doc.rel):
            continue
        if not inbound.get(doc.rel):
            issues.append(
                Issue(
                    "ORP",
                    "ERROR",
                    doc.rel,
                    "no inbound wikilink (orphan)",
                )
            )

    for src, dst in edges:
        if is_readme(dst) or is_meta(dst) or is_readme(src) or is_meta(src):
            continue
        dst_doc = next((item for item in docs if item.rel == dst), None)
        if not dst_doc:
            continue
        src_slug = slug_of(src)
        listed = {item.lower() for item in dst_doc.backlinks_section}
        if src_slug.lower() not in listed:
            issues.append(
                Issue(
                    "BL",
                    "WARN",
                    dst,
                    f"missing backlink [[{src_slug}]] from {src}",
                )
            )

    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lint a Marblo knowledge wiki.")
    parser.add_argument(
        "wiki_root",
        nargs="?",
        default=str(Path(__file__).resolve().parent.parent),
        help="Wiki subtree (default: parent of this file)",
    )
    args = parser.parse_args(argv)
    root = Path(args.wiki_root).resolve()
    if not root.is_dir():
        print(f"ERROR: wiki root is not a directory: {root}", file=sys.stderr)
        return 1
    issues = lint(root)
    errors = [item for item in issues if item.level == "ERROR"]
    warns = [item for item in issues if item.level != "ERROR"]
    for item in issues:
        print(f"[{item.level}] {item.code} {item.path}: {item.message}")
    print(f"wiki lint: {len(errors)} error(s), {len(warns)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

---
title: 위키 린트
tags: [meta/lint, status/normative]
status: active
date: 2026-08-24
links: [[CONVENTION]], [[TAXONOMY]], [[LINK-MAP]]
---

# 위키 린트

두 층이 있다. 둘 다 커밋 전에 돌린다. **린트 에러 0 ≠ 자체완결.**

## L1 규약 린트

```
python3 docs/wiki/_meta/lint_wiki.py
python3 docs/wiki/_meta/lint_wiki.py docs/wiki
```

읽기 전용. 에러면 종료코드 1, 경고(BL)는 0.

| 코드 | 심각도 | 의미 |
| --- | --- | --- |
| `FM` | ERROR | frontmatter 5필드 순서/값 |
| `TAG` | ERROR | 사전에 없는 태그 |
| `BRK` | ERROR | 깨진 `[[wikilink]]` |
| `DUP` | ERROR | 슬러그 전역 중복 (`README.md` 제외) |
| `ORP` | ERROR | 인바운드 wikilink 0 (README·도구파일 제외) |
| `SEC` | ERROR | 콘텐츠 노트에 `## Evidence` 또는 `## Backlinks` 없음 |
| `BL` | WARN | Backlinks 비대칭 |

검사하지 못하는 것: R1~R6 내용. 절이 비어 있어도 `SEC` 는 통과한다.

## L2 도구 린트

Marblo MCP `wiki_ingest` → `wiki_lint` → `wiki_query`. `root_path` 는 `docs/wiki`.

도구 소유 파일만 쓴다: `index.md` `log.md` `MEMORY.md`.

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

## L3 위키 적재 누락 감지

```
python3 docs/wiki/_meta/check_wiki_freshness.py
python3 docs/wiki/_meta/check_wiki_freshness.py origin/main...HEAD
```

읽기 전용. 전자동 요약을 만들지 않는다. 변경 세트에 `v3/docs/**/*.md` 신규 문서가 있는데 `docs/wiki/**/*.md` 변경이 없으면 실패한다.

탈출구는 결정 기록이다. 위키 감이 아니면 [WIKI-SKIP](WIKI-SKIP.md)에 아래 형식으로 사유를 남긴다.

| 원본 | 사유 |
| --- | --- |
| `v3/docs/example.md` | 일회성 배포 기록이라 재사용 규칙이 없다 |

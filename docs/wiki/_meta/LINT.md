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
python3 docs/wiki/_meta/lint_wiki.py docs/wiki --new-only-base origin/main...HEAD
```

읽기 전용. 에러면 종료코드 1, 경고(BL)는 0. `--new-only-base`는 CI 전용 — 로컬 저자는
평소처럼 인자 없이 돌리면 된다.

| 코드    | 심각도     | 의미                                                                                                                                                                                                             |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FM`    | ERROR      | frontmatter 5필드 순서/값                                                                                                                                                                                        |
| `TAG`   | ERROR      | 사전에 없는 태그                                                                                                                                                                                                 |
| `BRK`   | ERROR      | 깨진 `[[wikilink]]`                                                                                                                                                                                              |
| `DUP`   | ERROR      | 슬러그 전역 중복 (`README.md` 제외)                                                                                                                                                                              |
| `ORP`   | ERROR      | 인바운드 wikilink 0 (README·도구파일 제외)                                                                                                                                                                       |
| `SEC`   | ERROR      | 콘텐츠 노트에 `## Evidence` 또는 `## Backlinks` 없음                                                                                                                                                             |
| `KIND`  | WARN/ERROR | 종류 태그가 여럿이거나 잘못되면 항상 ERROR. 종류 태그가 아예 없으면: 로컬 실행(인자 없음)은 WARN, CI의 `--new-only-base <ref>` 실행에서 그 ref 이후 **새로 추가된** 노트만 ERROR — 기존 노트는 그대로 WARN(부채) |
| `KSEC`  | ERROR      | `kind/`별 필수 또는 금지 섹션 위반                                                                                                                                                                               |
| `TITLE` | WARN       | frontmatter `title`과 H1이 완전 중복 — title을 남기고 H1 제거                                                                                                                                                    |
| `BL`    | WARN       | Backlinks 비대칭                                                                                                                                                                                                 |

`kind/`는 [[TAXONOMY]]와 `lint_wiki.py`의 `VALID_KINDS` 두 곳에서 정확히
`knowledge`·`archive` 둘로 고정돼 있다 — 다른 이름을 쓰면 TAG 에러다. `kind/knowledge`는
`지금 무엇이 참인가`·`Evidence`·`Backlinks`를 요구하고 `한 줄 판정`·`무엇을 물었나`를
금지한다(판정문이 사실보다 앞에 오지 않게). `kind/archive`는 `Evidence`·`Backlinks`만
요구한다 — 조사 노트(질문→방법→결과→판정→다음 사람이 하는 일)는 이 종류 위에 자유
형식으로 쌓는다. 검사하지 못하는 것: R1~R6의 내용 충실도와 사실/방어 문장의 의미.

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

| 원본                 | 사유                                    |
| -------------------- | --------------------------------------- |
| `v3/docs/example.md` | 일회성 배포 기록이라 재사용 규칙이 없다 |

---
name: wiki-ingest
description: >
  마블로 공유 위키(docs/wiki) 커밋 게이트. 규약 린트 에러 0 → wiki_ingest →
  wiki_lint. root_path 는 항상 docs/wiki. 리포 루트로 돌리면 원본 문서가 위키로
  빨려들어가므로 즉시 중단한다. 사람 문서는 쓰지 않는다.
---

# /wiki-ingest

순서 규범: **L1 규약 린트 → L2 ingest → L2 wiki_lint.**

## 입력

| 항목 | 기본 |
| --- | --- |
| 위키 루트 | `docs/wiki` |
| 자체완결 grep | ON |
| 엄격 모드 | OFF (BL 경고는 실패 아님) |

## 단계

| # | 단계 | 실패 시 |
| --- | --- | --- |
| 1 | root_path 가 `docs/wiki` 인지 | 리포 루트면 **즉시 중단** |
| 2 | `python3 docs/wiki/_meta/lint_wiki.py docs/wiki` | 에러 ≥1 이면 중단 |
| 3 | R6 deferral · R1 수치 없는 한 줄 판정 grep | 경고로 보고, 사람이 판단 |
| 4 | `wiki_ingest({ root_path: "<marblo>/docs/wiki" })` | 도구 없으면 건너뛴 사실을 명시 |
| 5 | `wiki_lint({ root_path: "<marblo>/docs/wiki" })` | 고아·index 누락 보고 |
| 6 | 도구가 `index.md`/`log.md`/`MEMORY.md` 외를 바꿨는지 | 바뀌었으면 경고 |
| 7 | 요약: 문서 수 · 에러/경고 · 도구 파일 | — |

형제 프로젝트에서 호출할 때도 `root_path` 는 마블로 클론의 `docs/wiki` 다. cwd 기본값을 쓰지 마라.

## 산출

콘솔 리포트. 도구 소유 파일만 갱신. 에러 0 이어야 커밋 가능.

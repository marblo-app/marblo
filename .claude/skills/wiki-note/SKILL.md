---
name: wiki-note
description: >
  마블로 공유 위키(docs/wiki) 노트를 한 장 쓰거나 개정한다. frontmatter 5필드,
  R1~R6, Backlinks, 폴더 README, LINK-MAP 을 같은 변경에서 맞춘다. 원본 문서는
  참조만 하고 수정하지 않는다. 새 아이디어는 do-not-retry 를 먼저 검색한다.
---

# /wiki-note

루트는 항상 `docs/wiki`. 원본(`v3/docs`, `docs/lectures` 등)은 P1 — 한 글자도 고치지 않는다.

## 목적

링크를 안 따라가도 판정·핵심수치·왜·한계가 회수되는 노트 한 장.

## 입력

| 항목 | 필수 |
| --- | --- |
| 한 줄 주장 | ✅ 한 노트 = 한 주장 |
| 원본 경로 | ✅ |
| 폴더 | ⬜ 없으면 슬롯 표로 제안 |
| 판정 | ⬜ adopt / no-go / observe / undecidable |
| 개정 슬러그 | ⬜ 있으면 개정 모드 |

## 단계 (게이트를 빼지 말 것)

| # | 단계 | 게이트 |
| --- | --- | --- |
| 1 | 원본 정독 | 원본 수정 금지 |
| 2 | `_meta/do-not-retry.md` 검색 | 히트 시 사유코드·해금 조건을 제시 |
| 3 | ASCII kebab-case 슬러그, 전역 유일 | 중복이면 중단 |
| 4 | frontmatter 5필드 순서 고정, 태그는 사전만 | 없는 태그는 TAXONOMY 먼저 |
| 5 | 표준 섹션 | — |
| 6 | R1 한 줄 판정 + 수치 | 없으면 되돌아감 |
| 7 | R2 지표 + 유의성/재현단위 + 표본 | 전체 결과표 금지 |
| 8 | R3 왜 1~2줄 | "실패했다"로 끝이면 미달 |
| 9 | R4 한계 + "갈리면 원본이 옳다" | — |
| 10 | R5 코드/설정/운영 변경 여부 단어 | 무변경이면 "무변경" |
| 11 | R6 deferral 문장 grep 후 제거 | — |
| 12 | Evidence 는 상대경로 마크다운 링크 | wikilink 로 원본을 걸지 말 것 |
| 13 | Backlinks 대칭 | — |
| 14 | 폴더 README + LINK-MAP 같은 커밋 | — |
| 15 | staleness: 거짓이 된 기존 노트도 같은 커밋에서 고친다 | — |
| 16 | `/wiki-ingest` | 에러 0 없이 커밋 금지 |

## 산출

노트 1장 + README + LINK-MAP + (필요 시) 이웃 Backlinks.

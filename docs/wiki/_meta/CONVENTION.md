---
title: 마블로 위키 규약
tags: [meta/convention, status/normative]
status: active
date: 2026-08-24
links: [[TAXONOMY]], [[LINK-MAP]], [[LINT]], [[do-not-retry]]
---

# 마블로 위키 규약

규범 원본은 [docs/WIKI_system/WIKI-SYSTEM.md](../../WIKI_system/WIKI-SYSTEM.md) 다. 이 문서는 그 규범을 마블로 저장소 언어로 인스턴스화한 것이다. 갈리면 사양서가 옳다.

위키 루트는 **`docs/wiki/` 하나**다. 마케팅·강의·형제 프로젝트는 자기 위키를 만들지 않고 여기를 참조한다.

## 불변 규칙

1. **복사 + 링크만** — `docs/*.md`, `v3/docs/`, `docs/lectures/` 등 원본은 삭제·이동·편집하지 않는다. 수치가 갈리면 원본이 옳다.
2. **폴더는 저장, 그래프는 탐색** — 폴더 고민에 시간을 쓰지 않는다. 태그와 `[[슬러그]]` 로 잇는다.
3. **노트는 자체완결** — 링크를 안 따라가도 판정·핵심수치·왜·한계가 회수된다 (R1~R6).
4. **정직성 우선** — 기각을 지우지 않는다. `no-go` 와 `undecidable` 을 섞지 않는다.
5. **자동화는 아래에서 위로** — L1 린트 → L2 ingest/query → L3. 쓰기는 마커 블록 안에서만.

## 도메인 슬롯 (2026-08-24 매핑)

| 슬롯 | 폴더 | 역할 |
| --- | --- | --- |
| 00 기반 | `00-foundations` | Electron / Firestore / MCP / 식별자 축 — 나머지가 전제하는 것 |
| 10 주력 | `10-control-plane` | 지금 돌아가는 실물: 오케스트레이터, 보드, 비기너, 워크트리, 결제 |
| 20 제약 | `20-constraints` | GUI 검증 금지, 시크릿 마스킹, 축 순도, 원본 무변경 |
| 30 탐구 | `30-investigations` | 판정이 남는 시도. 하위폴더는 노트 3건 모이면 |
| 40 방법론 | `40-methodology` | 무엇을 근거로 믿나. ★1판 첫 축 |
| 50 운영 | `50-operations` | 배포·CI·인시던트 |

빈 슬롯에 노트를 미리 넣지 않는다. 1판 콘텐츠는 `40-methodology` · `20-constraints` · `_meta/do-not-retry` 뿐이다.

원장: 번호 조항 단일 원장은 없다. 포지셔닝 SSoT 는 [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) 이고 읽기 전용이다. 위키 노트가 결론의 집이다.

Evidence 위치: 원시 산출물은 `v3/docs/`, `docs/`, `docs/lectures/` 에 그대로 둔다. 노트 `## Evidence` 가 상대경로로 가리킨다.

## Frontmatter

모든 사람 문서는 이 5필드, 이 순서. 필드를 늘리지 않는다.

```yaml
---
title: 사람이 읽는 한 줄
tags: [domain/methodology, topic/observability]
status: verified
date: 2026-08-24
links: [[이웃슬러그]]
---
```

`status`: `stub` | `draft` | `active` | `verified` | `superseded`

## 링크

- 위키 내부: `[[슬러그]]` 만. 경로·확장자·파이프 별칭 금지.
- 위키 밖: 상대경로 마크다운 링크만.
- `README.md` 는 wikilink 대상이 아니다. 별칭 `[[wiki-home]]` 한 건만 LINK-MAP 에 둔다.
- `index.md` · `log.md` · `MEMORY.md` 는 도구 소유. 사람이 고치지 않는다.

## 자체완결 R1~R6

린트 에러 0 은 "규약 위반 없음"이지 "노트가 자체완결"이 아니다.

| # | 기준 |
| --- | --- |
| R1 | 한 줄 판정에 결론 + 가른 수치(또는 주장이 수치가 아니면 무엇에 대한 어떤 주장인지) |
| R2 | 판정 근거 지표 + 유의성/재현 단위 + 표본. 전체 결과표는 옮기지 않는다 |
| R3 | 왜 그 결과가 나왔나 1~2줄 |
| R4 | 표본·편의·프록시 + "수치가 갈리면 원본이 옳다" |
| R5 | 코드/설정/운영 변경 여부를 단어로. 없으면 "무변경" |
| R6 | "상세는 원본에" 류 deferral 금지 |

## MCP 도구

`root_path` 는 **항상 `docs/wiki`** 다. 리포 루트로 ingest 하면 원본 423개가 위키로 빨려들어가 P1 이 깨진다.

```
wiki_ingest({ root_path: "<marblo>/docs/wiki" })
wiki_query({ root_path: "<marblo>/docs/wiki", query: "..." })
wiki_lint({ root_path: "<marblo>/docs/wiki" })
```

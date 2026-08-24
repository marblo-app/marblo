---
title: 마블로 지식위키
tags: [meta/index, status/normative]
status: active
date: 2026-08-24
links: [[empty-query-first]], [[no-live-gui-verify]], [[do-not-retry]], [[CONVENTION]], [[TAXONOMY]], [[LINK-MAP]], [[LINT]]
---

# 마블로 지식위키

공유 위키는 **이 저장소의 `docs/wiki` 하나**다. 마케팅·강의·다른 형제 프로젝트는 위키를 따로 만들지 않고 여기를 참조한다.

## 불변 규칙 3개

1. 원본 문서는 옮기거나 복사하지 않는다. 노트가 가리키고, 갈리면 원본이 옳다.
2. 조회가 비면 대상이 아니라 조회를 먼저 의심한다 — [[empty-query-first]].
3. 새 아이디어는 [[do-not-retry]] 를 먼저 본다.

## 여기서 시작하세요

| 질문 | 가는 곳 |
| --- | --- |
| 그거 전에 해봤나? | [[do-not-retry]] |
| 쿼리/표가 비다 | [[empty-query-first]] |
| 화면으로 확인하고 싶다 | [[no-live-gui-verify]] |
| 노트를 어떻게 쓰나 | `/wiki-note` · [CONVENTION](_meta/CONVENTION.md) |
| 커밋 전에 뭐 돌리나 | `/wiki-ingest` · [LINT](_meta/LINT.md) |

## 트리

| 슬롯 | 폴더 | 1판 |
| --- | --- | --- |
| 00 기반 | [00-foundations](00-foundations/README.md) | 스텁 |
| 10 주력 | [10-control-plane](10-control-plane/README.md) | 스텁 |
| 20 제약 | [20-constraints](20-constraints/README.md) | [[no-live-gui-verify]] |
| 30 탐구 | [30-investigations](30-investigations/README.md) | 스텁 (노트 3건 전엔 하위폴더 없음) |
| 40 방법론 | [40-methodology](40-methodology/README.md) | [[empty-query-first]] ★첫 축 |
| 50 운영 | [50-operations](50-operations/README.md) | 스텁 |
| meta | [_meta](_meta/CONVENTION.md) | 규약 · 사전 · 원장 · 린트 |

## 판정 분포

| adopt | no-go | observe | undecidable |
| ---: | ---: | ---: | ---: |
| 2 | 7 | 0 | 0 |

기각이 채택보다 많은 것이 정상이다. 표가 뒤집히면 정직성 규약이 죽은 것이다.

## 다른 프로젝트에서 이 위키를 읽는 법

사장님이 마블로-마케팅·강의 등을 별도 프로젝트로 만드실 때 **위키는 여기 하나만** 둔다. 형제 프로젝트 폴더를 이 티켓이 만들지 않는다. 새 프로젝트 `AGENTS.md` 에 아래를 그대로 붙인다.

```
## 지식위키 (공유 · 마블로 저장소 하나)
위키는 마블로 클론의 `docs/wiki` 뿐이다. 이 프로젝트에 docs/wiki 를 만들지 말 것.
조회 시 MCP 도구에 root_path 를 반드시 넘긴다 (기본값 cwd 는 이 프로젝트라 위키가 비어 보인다):
  wiki_query({ root_path: "<MARBLO_CLONE>/docs/wiki", query: "..." })
  wiki_lint({  root_path: "<MARBLO_CLONE>/docs/wiki" })
  wiki_ingest({ root_path: "<MARBLO_CLONE>/docs/wiki" })
원본(v3/docs, docs/lectures 등)은 옮기거나 복사하지 말 것. 갈리면 원본이 옳다.
```

`<MARBLO_CLONE>` 만 그 머신 경로로 바꾼다. `wiki_query` 는 이미 `root_path` 를 받는다 — 참조 배선을 새로 만들지 말 것.

## 발견 경로 (왜 가이드 탭·하네스 스토어가 아닌가)

사람이 이 위키를 **찾고 시작하려면** 파일이 있는 것만으로는 부족하다. 1판 선택은 이것이다.

| 후보 | 판정 | 이유 |
| --- | --- | --- |
| **`.claude/skills/wiki-*` 4종** | ★채택 | `/tf-*` 와 같은 발견 경로. 에이전트가 `/` 로 시작한다. |
| **이 README** | ★채택 | 사람용 홈. `[[wiki-home]]`. |
| **사양서 `docs/WIKI_system/`** | ★채택 | 규범. 위키가 아니라 옆에 둔다. |
| 가이드 탭 새 절 | 기각 (후속 가능) | 가이드는 제품 사용자 온보딩 10절이다(티켓의 "6절"은 구형). 위키 작성법은 다른 청중. |
| 하네스 스킬·MCP 스토어 (`1wN4RQYqfAyNzwFQQ0aA`) | 기각 | 유저가 GitHub 레포를 설치하는 카탈로그다. 위키 스킬은 레포 로컬 공정(`tf-*` 와 동급). 이름만 겹친다. |
| 위키 탭 | 3순위 | 볼 게 생긴 뒤에. 지금 만들면 빈 화면이다. |

도구: `wiki_ingest` / `wiki_query` / `wiki_lint` 는 이미 마블로 MCP 에 있다. 새로 만들지 말고 `root_path=docs/wiki` 로 쓴다.

사양: [WIKI-SYSTEM.md](../WIKI_system/WIKI-SYSTEM.md) · [WIKI-SKills.md](../WIKI_system/WIKI-SKills.md) · [WiKI-Adoption-guide.md](../WIKI_system/WiKI-Adoption-guide.md)

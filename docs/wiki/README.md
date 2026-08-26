---
title: 마블로 지식위키
tags: [meta/index, status/normative]
status: active
date: 2026-08-26
links: [[overview]], [[architecture]], [[glossary]], [[progress]], [[marblo-bot-messaging]], [[empty-query-first]], [[verify-result-row]], [[counting-unit-first]], [[decision-sentence-first]], [[routing-label-coverage]], [[no-live-gui-verify]], [[do-not-retry]], [[CONVENTION]], [[TAXONOMY]], [[LINK-MAP]], [[LINT]], [[functions-deploy-env-and-bq-views]], [[verify-without-gui]], [[human-only-ops-backlog]]
---

# 마블로 지식위키

공유 위키는 **이 저장소의 `docs/wiki` 하나**다. 마케팅·강의·다른 형제 프로젝트는 위키를 따로 만들지 않고 여기를 참조한다.

## 불변 규칙 3개

1. 원본 문서는 옮기거나 복사하지 않는다. 노트가 가리키고, 갈리면 원본이 옳다.
2. 조회가 비면 대상이 아니라 조회를 먼저 의심한다 — [[empty-query-first]].
3. 조회가 있어도 그 행이 네가 생각한 행인지 확인한다 — [[verify-result-row]].
4. 세는 단위를 먼저 적는다 — [[counting-unit-first]].
5. 지표는 결정 문장이 있어야 남긴다 — [[decision-sentence-first]].
6. 라우팅·모델 성과는 액션축과 결과축을 분리한다 — [[routing-label-coverage]].
7. 새 아이디어는 [[do-not-retry]] 를 먼저 본다.

## 여기서 시작하세요

| 질문 | 가는 곳 |
| --- | --- |
| 마블로가 무엇인가 | [[overview]] |
| 구성 요소가 어떻게 닿나 | [[architecture]] |
| 같은 말이 다른 것을 가리키나 | [[glossary]] |
| 지금 무엇이 돌고 막혔나 | [[progress]] |
| 마블로봇 메시지는 뭔가 | [[marblo-bot-messaging]] |
| 그거 전에 해봤나? | [[do-not-retry]] |
| 쿼리/표가 비다 | [[empty-query-first]] |
| 쿼리/표에 결과가 있다 | [[verify-result-row]] |
| 비율·합계를 말해야 한다 | [[counting-unit-first]] |
| 대시보드 지표를 남길지 버릴지 판단한다 | [[decision-sentence-first]] |
| 모델·라우팅 성과를 학습셋으로 보려 한다 | [[routing-label-coverage]] |
| 화면으로 확인하고 싶다 | [[no-live-gui-verify]] · [[verify-without-gui]] |
| 배포·릴리스·CI 가 이상하다 | [[functions-deploy-env-and-bq-views]] · [[ci-empty-steps-is-billing]] · [[human-only-ops-backlog]] |
| 강의·마케팅 노트를 어디에 두나 | 아래 **어디에 두나** |
| 노트를 어떻게 쓰나 | `/wiki-note` · [CONVENTION](_meta/CONVENTION.md) |
| 커밋 전에 뭐 돌리나 | `/wiki-ingest` · [LINT](_meta/LINT.md) |

## 어디에 두나 — 강의·마케팅·개발

이 위키는 엔지니어링 전용이 **아니다.** 사장님 요청이 "마케팅이나 강의나 개발이나 다양한 용도로" 다. 6슬롯 역할(사양서 §1.2)은 그대로 두고, 1판에서 `10-control-plane` 이라고 부르던 주력 슬롯만 **이름을 다듬었다.** 그 이름이 제품 내부 지식처럼 들려 강의·마케팅이 들어갈 자리가 안 보였기 때문이다.

원본 파일(`docs/lectures/`, `marblo-web/docs/`)은 폴더가 아니다. Evidence 링크의 대상이다. **노트가 사는 슬롯은 아래다.**

| 쓰려는 것 | 슬롯 | 왜 |
| --- | --- | --- |
| 지금 제공하는 제품·커리큘럼·살아 있는 GTM | [10-offerings](10-offerings/README.md) | 주력 = 지금 운영·제공되는 실물 (§1.2). 강의 모듈의 한 줄 주장, SEO 클러스터의 한 줄 판정이 여기 |
| 한 회차가 어떻게 돌아갔나, 캠페인이 얼마가 나왔나 | [50-operations](50-operations/README.md) | 운영 = 바깥과 부딪힌 기록. 배포·CI만이 아니라 강의 운영 로그·캠페인 결과·고객 이슈 |
| 강의·마케팅·개발이 같이 전제하는 용어·포지셔닝 | [00-foundations](00-foundations/README.md) | 기반. CONTROL-PLANE 포지셔닝도 여기로 요약 |
| 가설을 검정한 시도 (강의 A/B, 카피 실험 포함) | [30-investigations](30-investigations/README.md) | 탐구. 판정이 남으면 여기, 제공 중인 실물 설명은 10 |
| "이렇게 믿기로 했다" (검증 절차, 인용 규율) | [40-methodology](40-methodology/README.md) | 방법론. 개발만이 아님 |
| 하면 안 되는 것 (제품 가드 + 인용 금지 카피) | [20-constraints](20-constraints/README.md) | 제약 |

폴더를 7개로 늘리지 않는다. 사양서 슬롯 역할은 고정이고 이름만 프로젝트 언어다. `10-control-plane` 은 그 언어가 엔지니어링에 기울어 잘못된 이름이었다.

## 트리

| 슬롯 | 폴더 | 1판 |
| --- | --- | --- |
| 00 기반 | [00-foundations](00-foundations/README.md) | [[overview]] · [[architecture]] · [[glossary]] · [[progress]] · [[telemetry-identity-axes]] |
| 10 주력 | [10-offerings](10-offerings/README.md) | [[marblo-bot-messaging]] |
| 20 제약 | [20-constraints](20-constraints/README.md) | [[no-live-gui-verify]] |
| 30 탐구 | [30-investigations](30-investigations/README.md) | [[post-spawn-telemetry-gap]] |
| 40 방법론 | [40-methodology](40-methodology/README.md) | [[empty-query-first]] · [[verify-result-row]] · [[counting-unit-first]] · [[decision-sentence-first]] · [[routing-label-coverage]] |
| 50 운영 | [50-operations](50-operations/README.md) | [[functions-deploy-env-and-bq-views]] · [[release-cut-at-build]] · [[github-app-install-after-deploy]] · [[payment-live-key-pg-env-bundle]] · [[ci-empty-steps-is-billing]] · [[verify-without-gui]] · [[human-only-ops-backlog]] |
| meta | [_meta](_meta/CONVENTION.md) | 규약 · 사전 · 원장 · 린트 |

## 판정 분포

| adopt | no-go | observe | undecidable |
| ---: | ---: | ---: | ---: |
| 5 | 7 | 0 | 0 |

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

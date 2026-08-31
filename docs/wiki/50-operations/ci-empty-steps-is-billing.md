---
title: CI job 의 steps 가 0 이면 코드가 아니라 GitHub 결제다
tags: [domain/operations, topic/ci, topic/verification, method/source-link]
status: verified
date: 2026-08-26
links: [[verify-without-gui]], [[release-cut-at-build]], [[empty-query-first]], [[human-only-ops-backlog]]
---

# CI job 의 steps 가 0 이면 코드가 아니라 GitHub 결제다

> **한 줄 판정**: ★채택 — GitHub Actions job 이 시작도 못 하고 `steps` 길이 **0** 이면 코드 회귀가 아니다. 계정 결제 실패/spending limit 이다. 2026-08-21 실측으로 Lint·Merge History 는 3~5초에 failure, 2026-08-26 에도 PR 두 개가 같은 이유로 빨갰다. 코드 판단은 로컬 테스트로 한다.

## 무엇을 물었나

PR 체크가 빨개면 방금 푸시한 커밋을 고쳐야 하는가.

## 무엇을 했나

org 이전 계획 §5 의 Actions annotation 원문과 오늘 PR 빨간불을 같은 분기로 묶었다. Billing 화면은 열지 않았다.

## 결과 (수치)

| 지표                        | 값                                               |
| --------------------------- | ------------------------------------------------ |
| 2026-08-14 이후 런          | `total_count` **787** (`created=>2026-08-14`)    |
| Lint / Merge History        | 전부 **3~5초** failure                           |
| Build & Release 최근 100    | queued 77 / failure 23 / 성공 **0**              |
| Build & Release 성공 이력   | 최근 2,200건 훑어도 **0**                        |
| 정지 기간 (2026-08-21 기준) | 최소 **5주** (2026-07-23 런에도 동일 annotation) |
| 2026-08-26                  | 같은 분기 PR **2개** 빨강                        |

재현 단위는 **Actions run 1건**. 표본은 2026-08-21 전수에 가까운 런 집계 + 오늘 PR 2개.

분기 확인:

```bash
# 최근 런. 결제 차단이면 job 이 초 단위로 failure 이고 steps 가 비다.
gh run list --repo melocream/marblo --limit 10

gh run view <run_id> --repo melocream/marblo --json jobs \
  --jq '.jobs[] | {name, conclusion, startedAt, completedAt, steps:(.steps|length)}'

# steps == 0 이고 conclusion 이 failure 이면 코드 문제로 단정하지 않는다.
# annotation 원문 키워드: "recent account payments have failed"
#   또는 "spending limit needs to be increased"
```

워크플로 파일은 루트 `.github/workflows/` 만 GitHub 이 읽는다. `v3/.github/workflows/` 는 죽은 경로다.

코드가 궁금하면 로컬:

```bash
cd v3 && npm run typecheck && npm test
cd v3/functions && npm run test:github-app   # 해당 영역 이름
cd marblo-web && npm test
```

GUI/Playwright 로 "CI 대신 화면"을 보지 않는다 ([[verify-without-gui]]).

사람만 할 수 있는 것: GitHub Settings → Billing & plans 에서 결제수단·spending limit. 에이전트는 Billing API 를 못 본다 ([[human-only-ops-backlog]]).

## 왜

결제 차단은 러너를 한 스텝도 안 붙인다. 그래서 체크는 빨강인데 로그에 테스트 실패가 없고, `steps` 가 0 이다. 그 빨강을 테스트 실패로 읽으면 없는 회귀를 고치러 간다 — [[empty-query-first]] 와 같은 "빈 결과를 대상으로 읽는" 오진이다.

## 한계 / 정직성

- 787/100/2200 숫자는 2026-08-21 스냅샷이다. 오늘 집계를 다시 안 돌렸다. 오늘 새로 확인한 것은 PR 2개의 같은 분기뿐이다.
- `steps==0` 이 아닌 진짜 테스트 실패도 있다. 로그에 npm/vitest 스택이 있으면 이 노트의 분기가 아니다.
- **수치가 갈리면 원본 §5 와 `gh run view` 실측이 옳다.**

## 실제 영향

문서만. 코드 무변경. 빨간 PR 을 보면 먼저 `steps` 길이를 센다. 0 이면 로컬 테스트로만 판단하고 Billing 은 사람 할 일로 넘긴다.

## Evidence

- [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) — §5 annotation 원문, 787/성공 0
- [.github/workflows/lint.yml](../../../.github/workflows/lint.yml) — 루트 워크플로
- [.github/workflows/build.yml](../../../.github/workflows/build.yml) — Build & Release
- [AGENTS.md](../../../AGENTS.md) — GUI 검증 금지

## Backlinks

- [[verify-without-gui]] · [[release-cut-at-build]] · [[empty-query-first]] · [[human-only-ops-backlog]] · [[functions-deploy-env-and-bq-views]]
- [[enterprise-control-plane-positioning]] — CI pass 가 성공 신호 목록에서 "없다" 인 이유가 이 노트

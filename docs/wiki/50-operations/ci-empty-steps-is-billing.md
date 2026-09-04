---
title: CI job 의 steps 가 0 이면 코드가 아니라 GitHub 결제다
tags: [domain/operations, topic/ci, topic/verification, method/source-link]
status: verified
date: 2026-09-03
links: [[verify-without-gui]], [[release-cut-at-build]], [[empty-query-first]], [[human-only-ops-backlog]], [[required-check-must-report]]
---

# CI job 의 steps 가 0 이면 코드가 아니라 GitHub 결제다

> **한 줄 판정**: ★채택(분기 진단) / ★철회(로컬 우선 결론) — `steps` 길이 **0** 이 코드 회귀가 아니라 결제 문제라는 분기 자체는 여전히 유효하다. 하지만 "코드 판단은 로컬 테스트로 한다"는 결제 차단이 CI 를 5주 정지시켰던 2026-08-21~26 시절의 우회로였다. 2026-09-03 현재 결제 차단은 해소됐고 CI 는 정상 실행되며 verify 의 `continue-on-error` 도 제거됐다 — **지금은 CI 체크가 정본이고 로컬은 사전점검일 뿐이다.**

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

로컬은 사전점검이지 판정이 아니다 — 정본은 CI:

```bash
cd v3 && npm run typecheck && npm test
cd v3/functions && npm run test:github-app   # 해당 영역 이름
cd marblo-web && npm test
```

로컬 통과를 코드 판정으로 쓰지 마라. 왜 그런지는 아래 "2026-09-03 갱신" 참고.

GUI/Playwright 로 "CI 대신 화면"을 보지 않는다 ([[verify-without-gui]]).

사람만 할 수 있는 것: GitHub Settings → Billing & plans 에서 결제수단·spending limit. 에이전트는 Billing API 를 못 본다 ([[human-only-ops-backlog]]).

## 왜

결제 차단은 러너를 한 스텝도 안 붙인다. 그래서 체크는 빨강인데 로그에 테스트 실패가 없고, `steps` 가 0 이다. 그 빨강을 테스트 실패로 읽으면 없는 회귀를 고치러 간다 — [[empty-query-first]] 와 같은 "빈 결과를 대상으로 읽는" 오진이다.

## 2026-09-03 갱신 — "로컬로 판단하라"는 틀렸다, 언제까지 맞았고 왜 바뀌었나

이 노트가 태어난 2026-08-21~26 은 결제 차단으로 `Build & Release` 성공 이력이 **0건**, 최소 5주 정지 상태였다. CI 가 죽어 있었으니 "코드 판단은 로컬로" 는 그 시절엔 유일한 우회로였고 맞는 조언이었다.

2026-09-03 오늘 그 전제가 사라졌다. PR #1384 에서 같은 날 두 번 반증됐다:

1. **로컬 통과가 CI 빨강을 못 잡았다.** `lint` 담당이 로컬 `npm run lint` exit 0 을 근거로 보고했지만 PR 의 `lint` 체크는 빨간 상태였다. 원인은 CI 의 `Lint` 워크플로가 4스텝(ESLint / 위키 규약 lint / 위키 신선도 테스트 / 위키 신선도 체크)인데 로컬 명령은 그중 ESLint 1스텝만 돈다는 것 — 로컬이 CI 의 부분집합도 아니었다.
2. **로컬 환경이 CI 환경과 달라 재현 자체가 안 됐다.** `tests/unit/rootPathScope.test.ts`·`tests/unit/projectPaths.test.ts` 의 `navigator is not defined` 3건은 CI 의 node20 에서만 난다. 이 워크트리 기본 node 는 v26 이라 로컬에서는 영원히 안 보인다 (`@vitest-environment jsdom` 관례로 해결 — ([XsHBHYHkigIePC4UAzIr](https://github.com/melocream/marblo/pull/1384))).

그리고 이 노트가 근거로 삼던 상황 자체가 바뀌었다: [XsHBHYHkigIePC4UAzIr](https://github.com/melocream/marblo/pull/1384) 에서 `verify` job 의 Test 스텝에 걸려 있던 `continue-on-error: true` 를 제거했다 — 그 전에는 테스트가 실패해도 verify 가 초록으로 위장됐다(실측: 일부러 테스트를 깨뜨려 exit 1 을 확인). 그리고 2026-09-03 관측으로는 `lint`·`verify` 모두 `steps` 가 끝까지 돌아 수 분(각 1~6분) 걸려 완주한다 — 이 노트가 잡던 "0 스텝·초단위 failure" 패턴이 아니다. 즉 결제 차단은 끝났고, 지금 CI 가 빨갛다면 그건 진짜 봐야 할 신호다.

**바뀐 결론**: `steps` 길이 0 = 결제 문제라는 분기 진단은 그대로 채택. 다만 결제 차단이 풀리고 verify 게이트가 실제로 게이트하는 지금은, "로컬로 코드 판단" 이 아니라 **CI 체크 통과가 정본**이다. 로컬은 사전점검(빠른 피드백)일 뿐 — 로컬 exit 0 을 CI 대체 증거로 보고하지 않는다.

## 2026-09-04 갱신 — 세 번째 상태가 있다: 빨강도 초록도 아닌 **부재**

이 노트는 체크가 **빨간** 경우를 두 갈래로 나눈다(`steps`==0 = 결제 / 그 외 = 진짜 실패). 2026-09-04 에 세 번째 상태가 실물로 나왔다: **체크가 목록에 아예 없는 경우.**

문서 전용 PR #1375 #1378 #1395 #1396 은 빨간 체크가 하나도 없는데 `mergeStateStatus=BLOCKED` 였다. `verify` 가 required 인데 트리거 필터에 걸려 check run 이 생성되지 않았고, 브랜치 보호는 그걸 "실패"가 아니라 "expected(아직 안 옴)" 로 영구히 기다렸다. `--admin` 조차 거부됐다. 자세한 판정과 대응은 [[required-check-must-report]].

**빨간 PR 을 읽는 순서가 이제 셋이다**: ① `steps` 길이 0 인가(→ 결제, 사람에게) → ② 체크 이름이 rollup **목록에 있는가**(→ 없으면 트리거/스킵 문제) → ③ 그다음이 진짜 실패다.

## 한계 / 정직성

- 787/100/2200 숫자는 2026-08-21 스냅샷이다. 오늘 집계를 다시 안 돌렸다. 오늘 새로 확인한 것은 PR 2개의 같은 분기뿐이다.
- `steps==0` 이 아닌 진짜 테스트 실패도 있다. 로그에 npm/vitest 스택이 있으면 이 노트의 분기가 아니다.
- **수치가 갈리면 원본 §5 와 `gh run view` 실측이 옳다.**

## 실제 영향

문서만. 코드 무변경. 빨간 PR 을 보면 먼저 `steps` 길이를 센다. 0 이면 결제 문제로 사람에게 넘긴다. 0 이 아니면(=job 이 끝까지 돌았으면) **CI 체크 결과가 정본**이다 — 로컬 exit 0 을 근거로 CI 빨강을 무시하지 않는다.

## Evidence

- [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) — §5 annotation 원문, 787/성공 0
- [.github/workflows/lint.yml](../../../.github/workflows/lint.yml) — 루트 워크플로, 스텝-레벨 ESLint 게이팅 (PR #1399)
- [.github/workflows/build.yml](../../../.github/workflows/build.yml) — Build & Release, `continue-on-error` 제거 (PR #1384), 스텝-레벨 docs-only 단락 (PR #1399)
- [AGENTS.md](../../../AGENTS.md) — GUI 검증 금지
- PR #1384 (https://github.com/melocream/marblo/pull/1384) — 로컬 lint exit 0 vs CI lint 빨강, node20 전용 `navigator` 3건 재현 불가 사례

## Backlinks

- [[verify-without-gui]] · [[release-cut-at-build]] · [[empty-query-first]] · [[human-only-ops-backlog]] · [[functions-deploy-env-and-bq-views]]
- [[required-check-must-report]] — 이 노트가 못 잡던 세 번째 상태(체크 부재)
- [[enterprise-control-plane-positioning]] — CI pass 가 성공 신호 목록에서 "없다" 인 이유가 이 노트

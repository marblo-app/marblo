---
title: kind 미분류 47장 판정표 — 아카이브/고쳐쓰기/유지, 이동은 하지 않는다
tags: [meta/ledger, status/living]
status: active
date: 2026-09-06
links: [[CONVENTION]], [[LINT]], [[TAXONOMY]]
---

# kind 미분류 47장 판정표

티켓 `d8tUu9oXxZNrnaM6ZEmQ`의 (가)에 대한 산출물이다. **이 노트는 판정만 한다 — 아무 파일도
옮기거나 고치지 않았다.** 사장님 승인 후 실제 이동·개정은 별도 커밋으로 나눠서 한다(한
번에 다 하면 다른 PR과 충돌한다 — 오늘 파일 하나 옮긴 것이 PR 3개를 깼다).

## 방법과 신뢰도 — 정직하게 남긴다

`python3 docs/wiki/_meta/lint_wiki.py docs/wiki`의 `[WARN] KIND` 47건 전체에 대해:

1. frontmatter `title`·`status`를 전수로 읽었다.
2. `grep "^##"`로 헤딩 구조를 전수로 확인했다 — 45/47이 `/wiki-note` 스킬의 고정 템플릿
   그대로(`## 무엇을 물었나` → `무엇을 했나` → `결과` → `왜` → `한계/정직성`) 쓰여 있다.
3. 애매한 8장(00-foundations 6장 + 10-offerings 1장 + 50-operations 1장)은 본문을 열어
   실제로 색인/참조형인지 확인했다.
4. 나머지는 **제목·상태·헤딩 구조까지만** 보고 판정했다 — 본문 문장 단위 재검증은 아니다.
   ★특히 "고쳐쓰기" 판정은 "이 노트가 재구성이 필요하다"는 1차 소견이지, 재작성 내용까지
   확정한 것은 아니다. 실제 재작성 시 원저자·도메인 지식이 있는 사람이 다시 검토해야 한다.

## 판정 기준

- **아카이브**: 헤딩 구조가 이미 조사형이고, 주제 자체도 특정 시점의 조사·배포·실험
  기록이다(폴더 목적과 일치). `kind/archive` 태그만 추가하면 된다 — 재작성 불필요.
- **고쳐쓰기**: 주제는 "지금도 참인 사실/규칙"인데 형식이 판정 우선 조사형이다. 사장님이
  지목한 패턴("제목이 KPI 타겟인데 맨 위에 이상한 게 붙고")과 같은 종류 — `kind/knowledge`로
  다시 짜야 한다(첫 섹션을 `## 지금 무엇이 참인가`로, 조사 과정은 Evidence로 축약).
- **유지(확인 필요)**: 색인·레퍼런스·백로그·로드맵처럼 한 노트=한 주장 모델에 안 맞는
  다중 항목 문서다. `kind/knowledge`도 `kind/archive`도 억지로 씌우면 판정을 왜곡한다.
  ★이건 새 발견이다 — 현재 태그 사전은 kind를 2종만 인정하는데, 이 8장은 어느 쪽도
  아니다. 이 티켓 범위 밖의 별도 결정(3번째 kind 신설 여부)이 필요해서 "확인 못 함"으로
  남긴다.

## 요약

| 판정                                |   건수 |
| ----------------------------------- | -----: |
| 아카이브 (재태깅만)                 |      4 |
| 고쳐쓰기 (재구성 필요)              |     32 |
| 유지 (확인 필요 — 2종 kind 모델 밖) |     11 |
| **합계**                            | **47** |

## 아카이브 — kind/archive 재태깅만 (구조 이미 조사형, 주제도 시점 기록)

| 파일                                                                        | 근거                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `30-investigations/shared-project-retention-confounded-with-internality.md` | 폴더 목적(판정이 남는 시도)과 일치, 헤딩 이미 조사형                               |
| `30-investigations/sole-persistent-user-is-not-external.md`                 | 위와 동일                                                                          |
| `30-investigations/web-tab-destination-debugging.md`                        | 위와 동일                                                                          |
| `15-b2b/b2b-shipped-2026-09-01.md`                                          | "2026-09-01 착지분" — 시점 배포 기록, archive 정의(조사 당시의 근거)와 정확히 일치 |

## 고쳐쓰기 — kind/knowledge로 재구성 (현재 참인 규칙/사실인데 판정 우선 조사형으로 쓰임)

★대표 사례: `00-foundations/2026-kpi-targets-pressure-test.md` — 제목이 이미 결론
("KPI 목표는 서로 모순되고 수익 변수가 한 칸도 없다")인데 H1 바로 아래 `> **한 줄 판정**: ★기각(그대로는) — …`으로 시작한다. 사장님이 지목한 "제목이 KPI 타겟인데 맨
위에 이상한 게 붙는" 패턴과 정확히 같다.

| 파일                                                                       | 근거                                                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `00-foundations/2026-kpi-targets-pressure-test.md`                         | 위 대표 사례                                                                                                   |
| `00-foundations/electron-power-switches-are-layer-scoped.md`               | 단일 기술 사실(verified), 조사형 템플릿 불필요                                                                 |
| `00-foundations/firestore-lease-actor-and-server-time.md`                  | 단일 기술 사실(verified)                                                                                       |
| `00-foundations/telemetry-identity-axes.md`                                | 단일 기술 사실(verified) — "userId는 표마다 다른 사람이다"                                                     |
| `10-offerings/jpy-anchors-to-competitors-not-krw.md`                       | 단일 가격 규칙(verified)                                                                                       |
| `15-b2b/b2b-team-label-layer.md`                                           | 단일 설계 사실(verified)                                                                                       |
| `15-b2b/b2b-web-first-onboarding.md`                                       | 단일 설계 결정(verified)                                                                                       |
| `15-b2b/b2b-metrics-and-screens.md`                                        | 지속 운영 원칙(verified) — 시점 기록이 아니라 지금도 적용되는 규율                                             |
| `20-constraints/in-app-link-routing.md`                                    | 지속 제약(verified) — `browser-session-approval-boundary`(모범 사례)와 같은 폴더·같은 성격                     |
| `20-constraints/no-live-gui-verify.md`                                     | 지속 제약(verified)                                                                                            |
| `20-constraints/notification-needs-a-recipient.md`                         | 지속 제약(verified)                                                                                            |
| `40-methodology/artifact-scope-boundary.md`                                | 방법론 원칙(verified) — 40 폴더 17장 전부 동일 사유: "지금도 지켜야 하는 규칙"이지 "그때의 조사 기록"이 아니다 |
| `40-methodology/async-lifetime-must-match-test-boundary.md`                | 〃                                                                                                             |
| `40-methodology/binary-resolved-cant-split-same-price-frontier-pairs.md`   | 〃                                                                                                             |
| `40-methodology/condition-must-ride-with-the-score.md`                     | 〃                                                                                                             |
| `40-methodology/control-must-differ-on-the-tested-axis.md`                 | 〃                                                                                                             |
| `40-methodology/count-callers-before-closing-a-gate.md`                    | 〃                                                                                                             |
| `40-methodology/counting-unit-first.md`                                    | 〃                                                                                                             |
| `40-methodology/decision-sentence-first.md`                                | 〃                                                                                                             |
| `40-methodology/do-not-silently-drop-missing-join-targets.md`              | 〃                                                                                                             |
| `40-methodology/empty-query-first.md`                                      | 〃                                                                                                             |
| `40-methodology/name-the-actor-not-just-the-resource.md`                   | 〃                                                                                                             |
| `40-methodology/routing-label-coverage.md`                                 | 〃                                                                                                             |
| `40-methodology/same-assumption-repeats-across-layers.md`                  | 〃                                                                                                             |
| `40-methodology/staleness-meter-must-not-be-driven-by-what-it-measures.md` | 〃                                                                                                             |
| `40-methodology/verify-result-row.md`                                      | 〃                                                                                                             |
| `40-methodology/wiki-write-at-merge.md`                                    | 〃                                                                                                             |
| `40-methodology/wiring-proven-on-screen.md`                                | 〃                                                                                                             |
| `50-operations/functions-deploy-env-and-bq-views.md`                       | 지속 운영 규칙(verified)                                                                                       |
| `50-operations/github-app-install-after-deploy.md`                         | 지속 운영 규칙(verified)                                                                                       |
| `50-operations/paddle-support-check-before-pg-screening.md`                | 지속 운영 규칙(verified)                                                                                       |
| `50-operations/payment-live-key-pg-env-bundle.md`                          | 지속 운영 규칙(verified)                                                                                       |

## 유지 (확인 필요) — 색인·레퍼런스·백로그·로드맵, 2종 kind 모델 밖

| 파일                                                     | 근거                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-foundations/overview.md`                             | 다중 항목 개요(색인) — 본문 확인함                                                                                                                              |
| `00-foundations/architecture.md`                         | 다중 항목 아키텍처 개요 — 본문 확인함                                                                                                                           |
| `00-foundations/glossary.md`                             | 용어집, 태생적으로 다항목 — 본문 확인함                                                                                                                         |
| `00-foundations/progress.md`                             | "보드가 정본, 여기는 큰 축만" — 자기 자신을 포인터/색인으로 선언 — 본문 확인함                                                                                  |
| `00-foundations/telemetry-data-model-map.md`             | 제목부터 "지도" — 다항목 참조표 — 본문 확인함                                                                                                                   |
| `00-foundations/enterprise-control-plane-positioning.md` | 포지셔닝 정본, 5개 하위주제 묶음 — 본문 확인함                                                                                                                  |
| `10-offerings/marblo-bot-messaging.md`                   | "메시징 단일 소스", 다항목(핵심 메시지 후보/대조표/용어 사전), status: draft — 본문 확인함                                                                      |
| `15-b2b/b2b-roadmap-phase-0-5.md`                        | 로드맵 — 시점이 아니라 계속 갱신되는 상태 추적 문서                                                                                                             |
| `50-operations/closed-loop-rehearsal-runbook.md`         | 절차/런북 — LINT.md가 예전에 언급했던 `kind/runbook`이 실제로는 taxonomy에 없다(문서 드리프트, 이번에 LINT.md에서 정정함). 사실·조사 어느 쪽도 아니라 판정 보류 |
| `50-operations/human-only-ops-backlog.md`                | 살아있는 백로그 목록 — 단일 주장이 아니라 계속 바뀌는 항목 리스트                                                                                               |
| `50-operations/payment-routes-live-gated-absent.md`      | "결제 정본" — 경로 상태를 계속 갱신하는 참조 원장                                                                                                               |

## 다음 사람이 하는 일

1. 사장님 승인 후, **고쳐쓰기 32장을 한 번에 손대지 않는다.** 폴더 단위(예: `40-methodology`
   17장)로 나누고, 매번 `[[browser-session-approval-boundary]]`를 본보기로 "지금 무엇이
   참인가"부터 시작해 재작성한다.
2. 아카이브 4장은 `kind/archive` 태그 + 필요한 `## Evidence`/`## Backlinks` 존재만 확인하고
   커밋 — 재작성 없음.
3. 유지 11장은 별도 티켓으로 올려 "2종 kind 모델에 3번째(`kind/reference`류)가 필요한가"를
   먼저 결정한다. 이 티켓은 그 결정을 하지 않는다 — 필수 필드/종류를 늘리지 말라는 규율과
   충돌하므로 사장님 판단으로 남긴다.

## Evidence

- 47건 재현 명령: `python3 docs/wiki/_meta/lint_wiki.py docs/wiki | grep '\[WARN\] KIND'`
- 45/47 헤딩 구조 재현 명령: `grep -L "^## 무엇을 물었나" <파일들>` (2건 예외: `10-offerings/marblo-bot-messaging.md`, `50-operations/payment-routes-live-gated-absent.md`)
- [wiki-note 스킬 — 이번 커밋에서 4a(kind 선택) 단계 추가](../../../.claude/skills/wiki-note/SKILL.md)

## Backlinks

- [[README]]

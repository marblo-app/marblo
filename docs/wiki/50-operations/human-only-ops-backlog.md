---
title: 운영 보드에서 사람만 할 수 있는 일
tags: [domain/operations, topic/deploy, topic/payments, topic/github, method/source-link]
status: active
date: 2026-08-27
links: [[github-app-install-after-deploy]], [[release-cut-at-build]], [[payment-live-key-pg-env-bundle]], [[ci-empty-steps-is-billing]], [[verify-without-gui]], [[functions-deploy-env-and-bq-views]], [[no-live-gui-verify]]
---

# 운영 보드에서 사람만 할 수 있는 일

> **한 줄 판정**: ★채택 — 이 목록에는 에이전트가 대신 못 하는 일만 둔다. 2026-08-27 기준 **남은 6건**. 코드로 끝난 것(카카오페이 배선, Paddle 해외 라우팅, 로그인 전 익명 flush, 어드민 광고 탭)은 표에서 뺐고, **Team·Team Plus 의 KRW·USD 가격은 2026-08-27 확정**돼 4번이 JPY 잔여분으로 좁혀졌다.

## 무엇을 물었나

보드에 쌓인 일 중 다음 세션의 에이전트가 집어가면 안 되는 것은 무엇인가.

## 무엇을 했나

오늘 런북에서 막힌 지점을 "사람 전용"으로만 걸렀다. 코드로 끝난 행은 지우고, 콘솔·서명·가격·실화면만 남긴다.

## 결과 (수치)

오늘 코드로 끝나 표에서 뺀 것 (다시 집지 말 것):

| 끝난 것 | 왜 뺐나 |
| --- | --- |
| 로그인 전 익명 텔레메트리 flush | 경로가 열렸다. 다만 **새 앱**에만 나간다 — 컷은 아래 1번 |
| 카카오페이 단건·정기 **배선** | 코드 채널키 맵이 붙었다. 라이브 키 투입은 포트원 승인(5번)에 묶인다 |
| Paddle **배선** (미국·일본 라우팅) | 비 KRW 체크아웃이 Paddle 로 간다. 셀러 **신청**은 6번 |
| 오케 첫 인사 로케일 | 메인 프로세스 변경. 창을 띄워 확인하지 않는다. 재시작은 사람 세션 |
| Team·Team Plus **KRW·USD 가격 확정** | 2026-08-27 확정돼 `pricing.ts` 에 있다 (Team ₩29,000·$25 /인, Team Plus ₩290,000·$245 팀당·5석 포함). 규칙과 근거는 [[jpy-anchors-to-competitors-not-krw]] |

남은 사람 전용:

| # | 할 일 | 왜 사람이어야 하는가 | 관련 런북 |
| --- | --- | --- | --- |
| 1 | `v3.0.36` **릴리스 컷** + 서명·공증·피드 공개 | 오늘 연 익명 텔레메트리가 **새 앱에서만** 나간다. Apple 공증·코드서명은 사장님 맥. 미리 컷된 `release/v3.0.36` 은 main 보다 **123커밋** 뒤 | [[release-cut-at-build]] |
| 2 | GitHub App **등록** (콘솔에서 App 생성, 권한 칸, Setup URL) | GitHub 개발자 설정은 오너 계정 세션이다. 등록값 문서를 위키에 복사하지 않는다 | [[github-app-install-after-deploy]] |
| 3 | **어드민 화면 직접 확인** | 사업 분석이 **6탭**(획득·광고·활성화·리텐션·수익·운영). 에이전트 GUI 검증 금지 | [[verify-without-gui]] · [[no-live-gui-verify]] |
| 4 | **Team · Team Plus 의 JPY 가격 결정** (KRW·USD 는 확정) | 요금 숫자는 제품 판단이다. 에이전트가 기본값을 뒤집지 않는다. 코드에서 두 플랜의 JPY 와 전 플랜 JPY 연간이 `null` 이고 화면은 `価格未定` 로 그린다 | [[jpy-anchors-to-competitors-not-krw]] |
| 5 | **포트원 승인 대기** 후 라이브 전환 실행 | 카드사·포트원 콘솔 승인은 사람 계약. 승인 뒤 실거래 키와 `PORTONE_PG_ENV` 를 한 묶음으로 | [[payment-live-key-pg-env-bundle]] |
| 6 | **Paddle 신청** | 셀러 계정·콘솔 신청은 사람이다. 코드 라우팅(en/ja → Paddle)은 이미 있다 | [[payment-live-key-pg-env-bundle]] |

보조 1건 (표의 6에 안 섞음): GitHub **Billing & plans** 결제수단/spending limit. CI `steps==0` 빨강은 이 화면이 풀리기 전에는 코드로 안 고쳐진다 ([[ci-empty-steps-is-billing]]).

표본: 남은 사람 전용 **n=6** (+ Billing 1). 유의성 검정이 아니라 **권한 경계 목록**이다.

에이전트가 해도 되는 것 (여기 안 씀): 런북 개정, 함수 코드, 단위 테스트, provision 스크립트 dry-run, `wiki_lint`. 라이브 `.env` 값 투입·콘솔 클릭·창을 띄우는 확인은 여기 있는 행이다.

## 왜

세션이 바뀌면 보드는 "열린 티켓"과 "사람만 할 수 있는 티켓"을 구분하지 못한다. 끝난 배선을 다시 집으면 이미 있는 채널키를 재발급하려 하고, 사람 전용을 집으면 시크릿을 열거나 창을 띄운다.

## 한계 / 정직성

- 이 표는 2026-08-27 스냅샷이다. 완료·추가를 반영하지 않으면 거짓 할 일이 된다. status 는 `active`.
- Team/Team Plus 가격의 숫자 후보는 여기 적지 않는다. 결정 주체만 적는다. 확정된 값과 그 규칙은 [[jpy-anchors-to-competitors-not-krw]] 에 있다.
- **수치가 갈리면 보드의 열린 사람 작업과 각 런북 원본이 옳다.**

## 실제 영향

문서만. 코드 무변경. 다음 세션의 운영 에이전트는 이 6행을 집지 않고, 집어야 하면 오케스트레이터에 사람 일정으로 넘긴다.

## Evidence

- [v3/docs/github-app-registration-values-2026-08-21.md](../../../v3/docs/github-app-registration-values-2026-08-21.md) — 등록은 사람, 값은 복사 금지
- [v3/docs/electron_updater_runbook.md](../../../v3/docs/electron_updater_runbook.md) — 릴리스 피드 공개
- [v3/docs/signing_runbook.md](../../../v3/docs/signing_runbook.md) — 공증은 사람 맥
- [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts) — KRW=PortOne, 비 KRW=Paddle
- [marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx](../../../marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx) — 분석 6탭
- [AGENTS.md](../../../AGENTS.md) — GUI 검증 금지
- [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) — Billing 은 사장님

## Backlinks

- [[github-app-install-after-deploy]] · [[release-cut-at-build]] · [[payment-live-key-pg-env-bundle]] · [[ci-empty-steps-is-billing]] · [[verify-without-gui]] · [[functions-deploy-env-and-bq-views]] · [[no-live-gui-verify]] · [[paddle-support-check-before-pg-screening]] · [[jpy-anchors-to-competitors-not-krw]]

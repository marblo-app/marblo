---
title: 50 운영 — 바깥과 부딪힌 기록
tags: [domain/operations, meta/index]
status: active
date: 2026-09-05
links: [[CONVENTION]], [[payment-routes-live-gated-absent]], [[paddle-support-check-before-pg-screening]], [[functions-deploy-env-and-bq-views]], [[release-cut-at-build]], [[github-app-install-after-deploy]], [[payment-live-key-pg-env-bundle]], [[ci-empty-steps-is-billing]], [[required-check-must-report]], [[verify-without-gui]], [[human-only-ops-backlog]], [[no-live-gui-verify]], [[closed-loop-how-it-works]], [[reach-user-not-merged]], [[closed-loop-rehearsal-runbook]]
---

# 50-operations

사양서 §1.2 의 **운영**: 바깥세계와 부딪힌 기록. 배포·CI만이 아니다.

| 들어가는 것                                  | 안 들어가는 것                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| 배포, CI, 인시던트                           | 제품·강의·마케팅 **그 자체** → [10-offerings](../10-offerings/README.md) |
| 강의 **한 회차**의 운영 로그 (어디서 막혔나) | 커리큘럼의 한 줄 주장 → 10                                               |
| 캠페인 **결과** (CAC, 유입, 기각된 채널)     | 살아 있는 GTM 전략 → 10                                                  |
| 고객 이슈, 공지                              |                                                                          |

## 폐루프 묶음 (2026-09-05)

처음에는 [[closed-loop-how-it-works]] 한 장을 읽는다. 아래 조사 기록은 현재 지식의 근거이며 `archive/`에 보존한다.

| 순서 | 노트                              | 무엇을 답하나                                      |
| ---- | --------------------------------- | -------------------------------------------------- |
| 1    | [[closed-loop-how-it-works]]      | ★현재 지식. 한 바퀴, 자동 구간, 멈춤 조건과 확인법 |
| 2    | [[closed-loop-rehearsal-runbook]] | 직접 돌려보는 절차                                 |
| 근거 | `archive/`의 네 조사 노트         | 9단계·가드·실패 원인·관측 공백의 조사 기록         |

★**폴더가 아니라 묶음인 이유**: 사양서 §1.3 이 `30-` 외의 하위폴더를 금지하고, §1.2 가 슬롯 역할을 고정한다. 폐루프는 슬롯 축이 아니라 주제 축(`topic/agents`)이다. 판단 근거 전문은 관문 노트의 "이 노트가 왜 새 폴더가 아니라 50-operations 에 있나" 절에 있다.

## 런북 (2026-08-31)

오늘 실제로 밟은 순서 함정이다. 추상 설명이 아니라 명령·경로가 노트 안에 있다.

| 노트                                         | 한 줄                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| [[functions-deploy-env-and-bq-views]]        | 분석 변경은 함수 배포 + BigQuery 뷰 재생성이 한 세트다                                 |
| [[release-cut-at-build]]                     | 릴리스 브랜치는 빌드 직전에 컷한다. 미리 컷하면 낡는다                                 |
| [[github-app-install-after-deploy]]          | GitHub App 은 등록 → 키 → 함수 배포 → 그다음 설치                                      |
| [[payment-routes-live-gated-absent]]         | ★결제 정본 — 무엇이 살아있고, 무엇이 **어떤 스위치로** 잠겼고, 무엇이 아예 없나        |
| [[payment-live-key-pg-env-bundle]]           | 포트원 실거래 키와 `PORTONE_PG_ENV` 를 한 묶음으로 바꾼다                              |
| [[paddle-support-check-before-pg-screening]] | 새 결제수단·새 나라는 국내 PG 심사 전에 Paddle 지원부터 본다                           |
| [[ci-empty-steps-is-billing]]                | job `steps` 가 0 이면 코드가 아니라 GitHub 결제 차단                                   |
| [[required-check-must-report]]               | required check 는 스킵하면 초록이 아니라 영구 미충족. 비용은 스텝-레벨 `if:` 로 깎는다 |
| [[verify-without-gui]]                       | 창 없이 검증. functions 는 node:test, marblo-web 은 `npm test`                         |
| [[human-only-ops-backlog]]                   | 사람만 남은 일 6건 (릴리스 컷·GitHub App·어드민 확인·가격·포트원 승인·Paddle 신청)     |

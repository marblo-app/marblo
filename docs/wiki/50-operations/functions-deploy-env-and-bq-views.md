---
title: 분석 변경은 함수 배포와 BigQuery 뷰 재생성이 한 세트다
tags: [domain/operations, topic/deploy, topic/bigquery, topic/observability, method/source-link]
status: verified
date: 2026-08-26
links: [[empty-query-first]], [[verify-without-gui]], [[ci-empty-steps-is-billing]], [[human-only-ops-backlog]], [[telemetry-data-model-map]]
---

# 분석 변경은 함수 배포와 BigQuery 뷰 재생성이 한 세트다

> **한 줄 판정**: ★채택 — Cloud Functions 코드 머지·배포만으로는 분석 화면이 안 바뀐다. 2026-08-26 에 뷰를 재생성하기 전까지 "머지했는데 화면은 안 바뀌는" 상태였다. 배포 단위는 **코드 + `v3/functions/.env.<projectId>` 가드 + 해당 뷰 provision** 세 조각이다.

## 무엇을 물었나

분석 SQL/콜러블을 고친 뒤, 함수만 배포하면 어드민 화면이 새 정의를 읽는가.

## 무엇을 했나

오늘 밟은 배포 경로와 가드 원문을 읽었다. 시크릿 값은 열지 않았다. 키 이름·파일 경로·명령만 남긴다.

## 결과 (수치)

| 지표 | 값 |
| --- | --- |
| env 단일소스 | `v3/functions/.env.<projectId>` (gitignore, 워크트리에 없음) |
| predeploy 단계 | **2** — `check:deploy-env` 다음 `build` ([v3/firebase.json](../../../v3/firebase.json)) |
| 필수키 | **3** — `ADMIN_UID`, `ANALYTICS_ID_SALT`, `PERSON_AXIS_EFFECTIVE_FROM` |
| 분석 화면이 코드 배포만으로 안 바뀐 사건 | 2026-08-26 **1회** (뷰 재생성 전) |
| 통합 뷰 알갱이 | 설치 1행 (`v_install_unified`) |

재현 단위는 **배포 1회 + provision 1회**. 표본은 오늘 운영 사고 1건 + 가드 원문.

배포는 **메인 체크아웃**에서만 한다. 가드가 워크트리 경로를 명시적으로 거절한다.

```bash
# 프로젝트 id 확인 (값 출력 금지 — id 만)
# 기본 프로젝트는 v3/.firebaserc 의 projects.default

# 1) env 가드. 값은 인쇄하지 않는다. 필수키 이름만 OK 로그에 나온다.
cd v3/functions
node scripts/check-deploy-env.mjs --project marblo-2253d
# 또는: npm run check:deploy-env -- --project marblo-2253d

# 2) 함수 배포. predeploy 가 위 가드 + tsc 를 먼저 돌린다.
cd v3
firebase deploy --only functions --project marblo-2253d
# package.json 별칭: cd v3/functions && npm run deploy
```

분석 변경이면 같은 세션에서 뷰를 재생성한다. dry-run 기본, `--apply` 가 실제 생성, `--replace-views` 가 본문 교체다.

```bash
cd v3/functions
npm run test:install-unified
npm run provision:install-unified
npm run provision:install-unified -- --apply
npm run provision:install-unified -- --apply --replace-views

# 사람 축·팀 사용량 뷰를 건드렸으면 각각:
npm run provision:person-axis
npm run provision:person-axis -- --apply
npm run provision:team-usage -- --apply
```

가드가 막는 것: `~/.marblo/worktrees/<project>/<task>` 에서 함수 배포. 그 경로에는 `.env.<projectId>` 가 없다.

## 왜

콜러블은 뷰 이름을 읽는다. 뷰 DDL 은 코드 배포와 같이 안 나간다. 뷰가 없으면 콜러블이 `state:"unavailable"` 로 접히거나, 옛 정의가 남아 화면이 잠잠하다. 빈 화면을 "유입이 없다"로 읽으면 [[empty-query-first]] 와 같은 오진이다.

필수키 3개는 조용한 열화를 막으려고 predeploy 에서 막는다. `PERSON_AXIS_EFFECTIVE_FROM` 형식이 `YYYY-MM-DD` 가 아니면 배포는 지나가도 사람 축 게이트가 닫힌 채로 남는다 — 그래서 가드가 형식까지 본다. 값은 출력하지 않는다.

## 한계 / 정직성

- 오늘 사고는 운영 관측 1회다. 모든 분석 콜러블이 뷰 의존인 것은 아니다.
- `GITHUB_APP_*` 4키는 필수 목록에 **없다**. 미설정은 "기능이 아직 꺼짐"이지 배포 실패가 아니다 ([[github-app-install-after-deploy]]).
- 데이터셋 `marblo_identity` 를 provision 스크립트가 만들지 않는다. 여기서 만들면 기본 ACL 로 링크표 격리가 풀린다.
- **수치가 갈리면 원본이 옳다.**

## 실제 영향

문서만. 코드·설정 무변경. 다음 분석 배포는 함수 배포 직후 해당 `provision:* -- --apply` 를 같은 세션에서 돌린다. 화면 확인은 [[verify-without-gui]] · [[no-live-gui-verify]].

## Evidence

- [v3/functions/scripts/check-deploy-env.mjs](../../../v3/functions/scripts/check-deploy-env.mjs) — 필수키 3개, `.env.<projectId>` 경로, 값 미출력
- [v3/firebase.json](../../../v3/firebase.json) — predeploy `check:deploy-env` → `build`
- [v3/functions/package.json](../../../v3/functions/package.json) — `check:deploy-env`, `deploy`, `provision:*`, `test:*`
- [v3/functions/scripts/provision-install-unified.ts](../../../v3/functions/scripts/provision-install-unified.ts) — dry-run / `--apply` / `--replace-views`
- [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) — §7-4 명령
- [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) — `INSTALL_UNIFIED_PROVISION_HINT`

## Backlinks

- [[empty-query-first]] · [[verify-without-gui]] · [[ci-empty-steps-is-billing]] · [[human-only-ops-backlog]] · [[github-app-install-after-deploy]] · [[payment-live-key-pg-env-bundle]] · [[no-live-gui-verify]]
- [[telemetry-data-model-map]] — 뷰끼리 게이트가 갈린 실측(결제 뷰 닫힘·사람 뷰 열림)

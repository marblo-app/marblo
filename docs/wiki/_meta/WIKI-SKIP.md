---
title: 위키 스킵 결정 대장
tags: [meta/skip, status/living]
status: active
date: 2026-08-25
links: [[LINT]], [[CONVENTION]], [[routing-label-coverage]], [[decision-sentence-first]], [[no-live-gui-verify]], [[telemetry-identity-axes]], [[empty-query-first]], [[verify-result-row]], [[counting-unit-first]], [[do-not-retry]]
---

# 위키 스킵 결정 대장

두 종류의 결정을 기록한다.

1. `v3/docs/**/*.md` 신규 문서가 생겼지만 위키 노트를 만들지 않기로 한 결정.
2. 위키 노트가 근거로 링크한 저장소 파일이 바뀌었지만 **그 노트의 서술은
   그대로 유효하다**는 판정(`check_wiki_freshness.py` 의 stale evidence 게이트).

사유 없는 스킵은 금지다. 이 파일의 값은 "안 넣는다"도 결정으로 남기는 데 있다.

★2번 행은 **경로 단위로 영구적**이다 — 한 번 적으면 그 파일의 이후 변경도
전부 면제된다. 그러니 사유는 "이번 변경이 무해했다"가 아니라 "이 파일의
변경은 그 노트의 낡음을 뜻하지 않는다"라는 **파일의 성질**로 적어야 한다.

| 원본 | 사유 |
| --- | --- |
| `marblo-web/messages/ko.json` | 웹 전 기능이 공유하는 로케일 문구 사전이다 — 이 파일이 바뀌었다는 것이 곧 이 파일을 인용한 위키 노트(JPY 가격 앵커·봇 메시징)의 서술이 낡았다는 뜻은 아니다. 그 노트들이 근거로 삼는 것은 특정 문구 **키**이므로, 그 키를 건드리는 변경은 노트 본문 대조에서 잡는다. |
| `marblo-web/messages/ja.json` | 위와 같다 — 로케일 세 벌이 한 덩어리로 움직이므로 ko 와 같은 판정을 받는다. |
| `v3/electron/main.ts` | 사용하지 않는 child-process 함수와 타입 전용 import만 제거했으며 Electron 시작·GitHub/Drive 동작과 위키의 운영 서술은 변하지 않았다. |
| `v3/functions/src/ga4Bridge.ts` | BigQuery용 제어문자 제거 정규식의 ESLint 주석 위치와 설명만 조정했으며 GA4 필드 정제 동작과 위키의 텔레메트리 서술은 변하지 않았다. |
| `v3/functions/src/index.ts` | 재할당되지 않는 webhook ID 지역변수만 `const`로 바꿨으며 webhook provisioning 동작과 위키의 함수·운영 서술은 변하지 않았다. |
| `v3/functions/package.json` | 감사 F2 에서 `test:membership` 스크립트 **한 줄만** 추가했다. [[functions-deploy-env-and-bq-views]] 가 이 파일에서 근거로 삼는 것은 `check:deploy-env`·`deploy`·`provision:*` 세 갈래이고, 그 노트의 수치(env 단일소스 1 · predeploy 단계 2 · 필수키 3 · 뷰 provision 명령)는 하나도 안 변했다. 이 노트가 문서화하는 배포 짝은 **함수 + BigQuery 뷰**인데 F2 의 짝은 **함수 + rules** 라 다른 짝이다 — 같은 노트에 넣으면 두 짝이 섞인다. 테스트 러너 갈래 쪽 변화는 [[verify-without-gui]] 를 같은 커밋에서 갱신해 흡수했다. |
| `v3/functions/src/installAttribution.ts` | BigQuery용 제어문자 제거 정규식의 ESLint 주석 위치와 설명만 조정했으며 설치 귀속 필드 정제 동작과 위키의 귀속 서술은 변하지 않았다. |
| `v3/electron/mcp-server/tools.ts` | MCP 툴 **등록부**다 — 수십 개 도구의 핸들러가 한 파일에 모여 있어 거의 모든 MCP 작업이 이 파일을 스친다. 이 파일을 인용한 위키 노트가 근거로 삼는 것은 파일 전체가 아니라 `recordMergeWikiDecisionPrompt` 처럼 **특정 심볼**이므로(로케일 사전 `ko.json` 과 같은 성질), 이 파일이 바뀌었다는 것이 곧 그 노트의 서술이 낡았다는 뜻은 아니다. 그 심볼을 건드리는 변경은 노트 본문 대조에서 잡는다. |
| `v3/docs/ADMIN-BETA-SEGMENT-ANALYTICS.md` | 분석·결제·귀속 원본이다. 단위/행 검증 규칙은 위키화했고 원시 수치·금액은 원본에 둔다. |
| `v3/docs/AGENT-SPLITVIEW-DESIGN.md` | 제품/화면/기능 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/BEGINNER-MODE-DESIGN.md` | 제품/화면/기능 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/BETA-INCENTIVE-MODEL-V2.md` | 모델·라우팅 설계/조사 문서다. 재사용 규칙은 [[routing-label-coverage]]에 통합했고 세부 수치는 원본에 둔다. |
| `v3/docs/BUGREPORT_mcp_dist-mcp_asar_path.md` | 운영 런북/인수인계/릴리스 기록이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/CODE-QUICK-ACTIONS.md` | 운영 런북/인수인계/릴리스 기록이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/COMMUNICATION-ARCHITECTURE.md` | 일회성 조사·기록 문서다. 현재 위키에 넣을 재사용 규칙이 없다. |
| `v3/docs/CONTROL-PLANE.md` | 제품 포지셔닝 SSoT다. 위키는 요약·링크만 하고 원본을 복제하지 않는다. |
| `v3/docs/COST-AXIS-RECONCILIATION-2026-08-08.md` | 분석·결제·귀속 원본이다. 단위/행 검증 규칙은 위키화했고 원시 수치·금액은 원본에 둔다. |
| `v3/docs/ENG-REVIEW-2026-07-12.md` | 일회성 리뷰 기록이다. 현재 위키에 넣을 재사용 규칙이 없다. |
| `v3/docs/FIREBASE_SETUP.md` | 설정 런북이다. 시크릿·환경값 원문 복제를 피하고 절차 원본으로 둔다. |
| `v3/docs/FIRST-RUN-BOOT-LIVE-VERIFICATION.md` | 라이브 검증 기록이다. 위키 규칙은 [[no-live-gui-verify]]로 이미 분리했다. |
| `v3/docs/GOOGLE_DRIVE_CONNECTOR.md` | 커넥터 설계 원본이다. 구현 맥락이 강해 위키 노트로 복제하지 않는다. |
| `v3/docs/GOOGLE_LOGIN_PACKAGED.md` | 패키징·로그인 검증 기록이다. 재사용 규칙보다 상태 스냅샷 성격이 강하다. |
| `v3/docs/HANDOFF_mcp_dist-mcp_asar_rebuild.md` | 인수인계 기록이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/INTELLIGENT-ROUTING-PLAN.md` | 모델·라우팅 설계 문서다. 재사용 규칙은 [[routing-label-coverage]]에 통합했고 세부 설계는 원본에 둔다. |
| `v3/docs/L2-ledger-read-scope-live-verification.md` | 라이브 검증 기록이다. 위키에 수치를 고정하지 않는다. |
| `v3/docs/LOCAL-MODEL-PLAN.md` | 모델·라우팅 설계 문서다. 세부 벤더·가격 판단은 시점 의존이라 원본에 둔다. |
| `v3/docs/MARKETING_CONTACTS.md` | 연락처/마케팅 운영 자료다. 위키에 개인정보·연락처를 복제하지 않는다. |
| `v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md` | 제품 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/MISSIONS-DEFERRED-COST-AWARE-DESIGN.md` | 비용 인식 설계 원본이다. 단위 규칙은 위키화했고 상세 설계는 원본에 둔다. |
| `v3/docs/MISSIONS-PROGRESS.md` | 진행 기록이다. 특정 시점 상태라 위키 규칙으로 복제하지 않는다. |
| `v3/docs/MISSIONS-SPEC.md` | 제품 사양 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/MODEL-COMPARISON-SEED.md` | 모델 비교 시드다. 수치·단가는 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/ORCHESTRATOR-SWITCH-HANDOFF-DESIGN.md` | 인수인계 설계다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md` | 가격·비용 사양 원본이다. 금액·정책은 시점 의존이라 원본에 둔다. |
| `v3/docs/QA-CLEANROOM-FIRST-RUN.md` | QA 기록이다. 라이브/클린룸 절차는 원본에 둔다. |
| `v3/docs/QA-CLEANROOM-MACBOOKAIR-RUNBOOK.md` | QA 런북이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/QUICK-LANES-SPEC.md` | 제품 사양 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/RATE-LIMIT-CAPTURE.md` | 계측 캡처 설계다. 특정 구현 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/RELEASE-3.0.17-NOTES.md` | 릴리스 노트다. 시점 기록이라 위키 규칙으로 승격하지 않는다. |
| `v3/docs/SENTRY-RUNBOOK.md` | 운영 런북이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/SETTINGS-AUDIT-2026-08.md` | 감사 스냅샷이다. 재사용 규칙보다 특정 시점 상태가 중심이다. |
| `v3/docs/SKILL-DELIVERY-RUNBOOK.md` | 운영 런북이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/SPAWN-MODEL-ALLOCATION-V2.md` | 모델 할당 설계다. 재사용 규칙은 [[routing-label-coverage]]에 통합했고 세부 수치는 원본에 둔다. |
| `v3/docs/SYNC-AND-REBUILD.md` | 운영 런북이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/TELEGRAM-CHANNEL-STABILITY.md` | 채널 안정성 기록이다. 특정 시점 운영 기록이라 위키 노트로 복제하지 않는다. |
| `v3/docs/V3-OVERVIEW.md` | 제품 개요 원본이다. 위키는 홈에서 링크·분류만 한다. |
| `v3/docs/VENDOR-EXPANSION-SURVEY.md` | 벤더 조사다. 외부 조건·가격이 바뀌므로 위키에는 안정 규칙만 남긴다. |
| `v3/docs/VENDOR-GLM-ZAI.md` | 벤더 조사다. 시점 의존 판단이라 원본에 둔다. |
| `v3/docs/VENDOR-MINIMAX.md` | 벤더 조사다. 시점 의존 판단이라 원본에 둔다. |
| `v3/docs/VENDOR-MODEL-USAGE-GUIDE.md` | 모델 사용 가이드다. 운영 절차 원본으로 유지한다. |
| `v3/docs/WORKTREE-PLAN-01-manager.md` | 워크트리 구현 계획이다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/WORKTREE-SPEC.md` | 워크트리 사양 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/activation-friction-diagnosis-2026-08-07.md` | 활성화 분석 원본이다. 단위/행 검증 규칙은 위키화했고 수치는 원본에 둔다. |
| `v3/docs/activation-metric-repair-2026-08-24.md` | 활성화 지표 수리 원본이다. 단위 규칙은 위키화했고 상세 수치는 원본에 둔다. |
| `v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md` | [[decision-sentence-first]]의 Evidence 원본이다. 전문 복사 없이 규칙만 링크한다. |
| `v3/docs/admin-analytics-replan-2026-08-24.md` | [[decision-sentence-first]]의 Evidence 원본이다. 낡은 `3.1%` 경고는 위키에 정정했고 세부 계획은 원본에 둔다. |
| `v3/docs/agent-stall-signal-2026-08-22.md` | 장애 조사 기록이다. 특정 시점 상태라 위키 노트로 복제하지 않는다. |
| `v3/docs/analytics-identity-account-axis-hold-2026-08-21.md` | 식별자 분석 원본이다. 축 규칙은 [[telemetry-identity-axes]]에 통합했고 세부 수치는 원본에 둔다. |
| `v3/docs/api-bundle-activation-feasibility-2026-08-25.md` | 결제·활성화 검토 원본이다. 사업 판단과 수치가 시점 의존이라 원본에 둔다. |
| `v3/docs/api-reseller-onramp-feasibility-2026-08-09.md` | 결제·약관 검토 원본이다. 금액·약관은 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/assistant-tab-design-2026-08-24.md` | 화면 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/attribution-bridge-break-2026-08-21.md` | 귀속 분석 원본이다. 조회/축 규칙은 위키화했고 세부 수치는 원본에 둔다. |
| `v3/docs/audit-dashboard-plan-2026-08-25.md` | 대시보드 설계 원본이다. 지표 선별 규칙은 [[decision-sentence-first]]에 통합했다. |
| `v3/docs/benchmark/README.md` | 벤치 인덱스다. 결과 수치는 시점 의존이라 위키 규칙으로 승격하지 않는다. |
| `v3/docs/benchmark/generated-report.md` | 생성 벤치 보고서다. 스냅샷이라 위키에 복제하지 않는다. |
| `v3/docs/benchmark/swebench-deepseek-v4-flash-2026-08-21.md` | 벤치 결과다. 모델별 수치는 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/benchmark/swebench-deepseek-v4-pro-2026-08-21.md` | 벤치 결과다. 모델별 수치는 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/benchmark/swebench-our-measured.md` | 벤치 결과다. 모델별 수치는 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/benchmark/swebench-solar-pro4-2026-08-20.md` | 벤치 결과다. 모델별 수치는 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/boot-prefix-diet-2026-08-10.md` | 부팅 프롬프트 최적화 기록이다. 특정 시점 튜닝이라 위키 노트로 복제하지 않는다. |
| `v3/docs/bot-traffic-fingerprint-2026-08-24.md` | 봇 판별 조사다. 판정 기준이 변할 수 있어 원본에 둔다. |
| `v3/docs/bq-ml-training-data-audit-2026-08-08.md` | 학습 데이터 감사 원본이다. 라벨 커버리지 규칙은 [[routing-label-coverage]]에 통합했다. |
| `v3/docs/browser-tab-manual-check-2026-09-03/LINKS.md` | 티켓 `RJVpiYc3e0apo3MZJ89M` 의 일회성 수동 QA 픽스처다. 특정 커밋 시점(`8552a6f5`) 라우팅 코드의 예측/실측 대조표라 재사용 규칙이 없고, 고쳐지면 곧 낡는다. |
| `v3/docs/browser-tab-manual-check-2026-09-03/sample-doc.md` | 위 QA 픽스처의 링크 타깃용 더미 문서다. 내용 없음. |
| `v3/docs/chart-data-integrity-2026-08-25.md` | [[decision-sentence-first]]의 Evidence 원본이다. 전문 복사 없이 규칙만 링크한다. |
| `v3/docs/cli-install-failure-diagnosis-2026-08-25.md` | 설치 실패 진단 원본이다. 수치·환경은 원본에 둔다. |
| `v3/docs/cloud-hosted-feasibility-2026-08-08.md` | 가능성 검토 원본이다. 사업·비용 판단이 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/ci-verify-test-determinism.md` | 특정 CI 실행의 실패 분류·수정 기록이다. 일반 운영 규칙은 이미 `verify-without-gui`에 있으므로 실행 증거 전문은 원본에 둔다. |
| `v3/docs/code_signing_setup.md` | 서명 설정 런북이다. 시크릿·환경값 원문 복제를 피하고 절차 원본으로 둔다. |
| `v3/docs/deepseek-namespace-mcp-live-probe-2026-08-21.md` | 벤더 라이브 프로브다. 시점 의존 판단이라 원본에 둔다. |
| `v3/docs/design-tokens-and-failure-vocabulary-2026-08-22.md` | 디자인/어휘 감사 원본이다. 구현 맥락이 강해 위키 노트로 복제하지 않는다. |
| `v3/docs/dispatch-browse-skill-audit-2026-08-24.md` | 스킬 감사 기록이다. 특정 시점 상태라 위키 노트로 복제하지 않는다. |
| `v3/docs/ecosystem-registry-design.md` | 생태계 레지스트리 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/ecosystem-star-strategy.md` | 전략 조사 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/electron_updater_runbook.md` | 업데이트 운영 런북이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/enterprise-ax-client-dashboard-design-2026-08-24.md` | 화면 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/enterprise-org-dashboard-screen-design-2026-08-24.md` | 화면 설계 원본이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/env-swap-minimax-fallback-deepdive-2026-08-07.md` | 벤더 env-swap 조사다. 세부 벤더 상태는 시점 의존이라 원본에 둔다. |
| `v3/docs/external-feedback-improvement-roadmap-2026-08-10.md` | 개선 로드맵 원본이다. 특정 시점 계획이라 위키 노트로 복제하지 않는다. |
| `v3/docs/free-slm-tier-feasibility-2026-08-09.md` | 모델/가격 검토 원본이다. 수치·벤더 조건은 시점 의존이라 원본에 둔다. |
| `v3/docs/ga4-country-funnel-attribution-2026-08-10.md` | 귀속 분석 원본이다. 단위/조회 규칙은 위키화했고 세부 수치는 원본에 둔다. |
| `v3/docs/ga4-ecommerce-unified-2026-08-24.md` | [[verify-result-row]]의 Evidence 원본이다. 결제 행 성격 규칙만 위키화했다. |
| `v3/docs/ga4-region-bridge-2026-08-21.md` | [[empty-query-first]]의 Evidence 원본이다. 리전 조회 규칙만 위키화했다. |
| `v3/docs/github-app-installation-inheritance-design-2026-08-21.md` | GitHub App 설계 원본이다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/github-app-registration-values-2026-08-21.md` | 등록값 기록이다. 설정값 복제를 피하고 원본에 둔다. |
| `v3/docs/github-org-migration-plan.md` | 마이그레이션 계획 원본이다. 특정 실행 계획이라 위키 노트로 복제하지 않는다. |
| `v3/docs/install-attribution-ga-key-join-2026-08-24.md` | 귀속 조인 원본이다. 축 규칙은 위키화했고 세부 쿼리는 원본에 둔다. |
| `v3/docs/install-attribution-utm-rate.md` | [[empty-query-first]]와 [[do-not-retry]]의 Evidence 원본이다. 전문 복사 없이 링크한다. |
| `v3/docs/install-unified-view-2026-08-24.md` | [[counting-unit-first]]와 [[verify-result-row]]의 Evidence 원본이다. 세부 스키마는 원본에 둔다. |
| `v3/docs/live-orchestration-moat-review-2026-08-23.md` | [[routing-label-coverage]]의 Evidence 원본이다. 전략 판단 전문은 복제하지 않는다. |
| `v3/docs/marblo-swe-benchmark-feasibility-2026-08-09.md` | 벤치 가능성 검토다. 수치·벤더 상태가 시점 의존이라 위키에 고정하지 않는다. |
| `v3/docs/merge-history-webhook-diagnosis-2026-09-03.md` | 특정 시크릿 장애의 일회성 진단·런북 기록이다. URL/함수명 같은 시점 의존 값 중심이라 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/onramp-l0-parity-audit-2026-08-09.md` | 온램프 감사 원본이다. 결제·비용 수치는 원본에 둔다. |
| `v3/docs/onramp-l2-credit-tier-design-2026-08-09.md` | 크레딧 티어 설계 원본이다. 가격·정책 판단은 시점 의존이라 원본에 둔다. |
| `v3/docs/onramp-l2-margin-fx-pg-buffer-2026-08-09.md` | 마진·환율·PG 버퍼 원본이다. 금액·비율은 위키에 복제하지 않는다. |
| `v3/docs/onramp-l2-proxy-cache-poc-2026-08-09.md` | PoC 설계 원본이다. 특정 구현 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/onramp-ladder-design-2026-08-09.md` | 온램프 사다리 설계 원본이다. 가격·결제 세부는 시점 의존이라 원본에 둔다. |
| `v3/docs/onramp-p0-env-key-audit.md` | env 키 감사 원본이다. 시크릿·환경값 원문 복제를 피하고 원본에 둔다. |
| `v3/docs/orca-onboarding-competitive-analysis-2026-08-08.md` | 경쟁 분석 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/org-access-and-login-flow-2026-08-24.md` | 조직 접근/로그인 설계 원본이다. 구현 맥락이 강해 위키 노트로 복제하지 않는다. |
| `v3/docs/org-identity-model-2026-08-24.md` | 조직 식별 모델 설계다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/own-model-finetune-serving-roadmap-2026-08-09.md` | 모델 학습/서빙 로드맵이다. 시점 의존 계획이라 원본에 둔다. |
| `v3/docs/payment-failure-scenarios-audit-2026-08-07.md` | 결제 실패 시나리오 감사다. 세부 케이스는 원본에 둔다. |
| `v3/docs/perf-fleet-grid.md` | 성능 그리드 기록이다. 특정 시점 표라 위키에 고정하지 않는다. |
| `v3/docs/person-axis-activation-2026-08-21.md` | 사람 축 활성화 원본이다. 축 규칙은 [[telemetry-identity-axes]]에 통합했고 수치는 원본에 둔다. |
| `v3/docs/person-axis-implementation-2026-08-21.md` | 구현 기록이다. 특정 코드 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/person-axis-user-key-design-2026-08-21.md` | 사용자 키 설계다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/post-spawn-telemetry-gap-2026-08-25.md` | [[post-spawn-telemetry-gap]]와 [[telemetry-identity-axes]]의 Evidence 원본이다. 전문 복사 없이 링크한다. |
| `v3/docs/pseudonym-retro-measurement-2026-08-21.md` | [[do-not-retry]]의 Evidence 원본이다. 원시 식별자 관련 세부는 원본에 둔다. |
| `v3/docs/qa-fleet-grid.md` | QA 그리드 기록이다. 특정 시점 표라 위키에 고정하지 않는다. |
| `v3/docs/research/INDEX.md` | 연구 인덱스다. 위키 인덱스와 역할이 다르므로 복제하지 않는다. |
| `v3/docs/research/README.md` | 연구 폴더 안내다. 위키 홈과 역할이 다르므로 복제하지 않는다. |
| `v3/docs/research/bigquery-ml-readiness.md` | BQ ML 준비도 조사다. 시점 의존 판단이라 원본에 둔다. |
| `v3/docs/research/marblo-gtm-strategy-vs-orca-2026-07-18.md` | 전략 조사 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/research/marblo-strategy-development-roadmap-moat-to-4axes-2026-07-18.md` | 전략 로드맵 원본이다. 특정 시점 계획이라 위키 노트로 복제하지 않는다. |
| `v3/docs/research/marblo-strategy-revalidation-orchestration-moat-2026-07-18.md` | 전략 재검증 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/research/marblo-vs-orca-final-ceo-strategy-review-2026-07-17.md` | CEO 전략 리뷰 원본이다. 전문 판단을 위키로 복제하지 않는다. |
| `v3/docs/research/marblo-vs-orca-strategy-review-2026-07-17.md` | 전략 리뷰 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/research/orca-vs-marblo-review.md` | 경쟁 리뷰 원본이다. 시점 의존 조사라 원본에 둔다. |
| `v3/docs/research/orca-worktree-ux-benchmark.md` | UX 벤치 기록이다. 스냅샷이라 위키에 고정하지 않는다. |
| `v3/docs/research/routing-slm-data-collection.md` | 라우팅 데이터 수집 연구다. 라벨 규칙은 [[routing-label-coverage]]에 통합했다. |
| `v3/docs/research/slm-router-summary.md` | 라우터 연구 요약이다. 시점 의존 조사라 원본에 둔다. |
| `v3/docs/routing-label-instrumentation.md` | 라우팅 라벨 계측 설계다. 재사용 규칙은 [[routing-label-coverage]]에 통합했다. |
| `v3/docs/routing-slm-dataset-design-2026-08-09.md` | 라우팅 데이터셋 설계다. 재사용 규칙은 [[routing-label-coverage]]에 통합했고 세부 갭은 원본에 둔다. |
| `v3/docs/routing/README.md` | 라우팅 문서 인덱스다. 위키에는 규칙 노트만 둔다. |
| `v3/docs/routing/label-capture-audit-2026-08-10.md` | [[routing-label-coverage]]의 Evidence 원본이다. 전문 복사 없이 규칙만 링크한다. |
| `v3/docs/routing/shadow-serving-stub.md` | [[routing-label-coverage]]의 Evidence 원본이다. 세부 배포·쿼리는 원본에 둔다. |
| `v3/docs/signing_runbook.md` | 서명 운영 런북이다. 절차 원본으로 유지하고 위키 노트로 복제하지 않는다. |
| `v3/docs/spawn-autoselect-architecture.md` | 자동 모델 선택 설계다. 재사용 규칙은 [[routing-label-coverage]]에 통합했다. |
| `v3/docs/spawn-autoselect-findings.md` | 자동 모델 선택 발견 기록이다. 시점 의존 결과라 원본에 둔다. |
| `v3/docs/specs/2026-05-28-orch-live-awareness-design.md` | 오래된 설계 사양이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/specs/2026-06-06-autonomy-dial-exception-inbox-design.md` | 오래된 설계 사양이다. 구현 맥락이 강해 위키에는 범용 규칙이 생길 때만 승격한다. |
| `v3/docs/store-builtin-vs-default-install.md` | 스토어 설치 정책 검토다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/store-mcp-candidates.md` | 스토어 후보 목록이다. 시점 의존 목록이라 위키에 고정하지 않는다. |
| `v3/docs/store-rating.md` | 스토어 평점 설계다. 특정 기능 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/strategy-ceo-review-local-vs-cloud-2026-08-08.md` | 전략 리뷰 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/strategy-roundtable-local-vs-cloud-2026-08-08.md` | 전략 라운드테이블 원본이다. 포지셔닝 근거로만 두고 위키에는 안정 규칙만 별도 추출한다. |
| `v3/docs/superpowers/plans/2026-06-06-mission-kanban-badge.md` | 오래된 기능 계획이다. 특정 UI 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/task-outcomes-outcome-mode-schema.md` | 스키마 기록이다. 라벨 규칙은 [[routing-label-coverage]]에 통합했고 세부 스키마는 원본에 둔다. |
| `v3/docs/taskid-bridge-recovery-measurement-2026-08-26.md` | 특정 시점의 복구 가능성 실측이다. 축·조인 방법론은 [[telemetry-identity-axes]]와 [[verify-result-row]]에 이미 있다. |
| `v3/docs/telemetry-build-profiles.md` | 텔레메트리 빌드 프로파일 원본이다. 폐기된 모델 포함이라 위키에 단독 사실로 승격하지 않는다. |
| `v3/docs/tf-slash_reference.md` | 명령 레퍼런스다. 위키 운영 규칙과 역할이 달라 복제하지 않는다. |
| `v3/docs/token-efficiency-levers-2026-08-09.md` | 토큰 효율화 기록이다. 특정 시점 튜닝이라 위키 노트로 복제하지 않는다. |
| `v3/docs/utm-live-verification-2026-08-24.md` | 라이브 검증 기록이다. 세부 관측값은 원본에 둔다. |
| `v3/docs/utm-tagging-convention-2026-08-24.md` | UTM 규약 원본이다. 광고 운영 상세라 위키에는 귀속 방법론만 둔다. |
| `v3/docs/ux-beginner-discipline-audit-2026-08-22.md` | UX 감사 기록이다. 특정 시점 화면 판단이라 위키 노트로 복제하지 않는다. |
| `v3/docs/watchdog-antigravity-stale-miss-rca.md` | RCA 기록이다. 특정 장애 맥락이라 위키 노트로 복제하지 않는다. |
| `v3/docs/web-app-join-attribution-design-2026-08-09.md` | [[do-not-retry]]의 Evidence 원본이다. 귀속 기각 사례만 위키 원장에 남긴다. |

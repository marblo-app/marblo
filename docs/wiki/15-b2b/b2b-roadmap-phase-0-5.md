---
title: B2B 로드맵 — Phase 0~5는 무엇을 열고 지금 어디에 있는가
tags: [domain/b2b, topic/roadmap, topic/organizations, verdict/adopt]
status: verified
date: 2026-09-01
links: [[b2b-team-label-layer]], [[b2b-web-first-onboarding]], [[b2b-metrics-and-screens]], [[enterprise-control-plane-positioning]], [[telemetry-data-model-map]]
---

# B2B 로드맵 — Phase 0~5는 무엇을 열고 지금 어디에 있는가

> **한 줄 판정**: ★채택 — 순서는 Phase 0 게이트 → 1 조직 뼈대 → 2 조직 롤업과 3 사용자 드릴다운 병렬 → 4 성공률 사람 축 → 5 요구 있을 때만 슬러그다. 2026-09-01 기준 Phase 0·1·2 와 4a 각인이 배포됐고, 남은 것은 Phase 3(사용자 드릴다운)과 5(슬러그, 요구 있을 때만)다. 조직 인스턴스는 여전히 0건이다 — **기능 배포 상태와 고객 데이터 생성 상태를 갈라 읽어야 한다.**

## 무엇을 물었나

조직 URL과 분석을 한 번에 만들지 않고, 각 배포가 무엇을 보여 주며 어떤 전제를 추가하는가.

## 결과

| 단계 | 판정·작업 | 이 단계에서 보이는 것 |
| --- | --- | --- |
| 0 게이트 | 방침·프로비전·단일 발효일. **완료**: `TEAM_USAGE_EFFECTIVE_FROM=2026-09-07`이 실제 배포됨 | 기존 `/team`의 사용량·모델 믹스·활동 인원. 코드 추가 없음 |
| 1 조직 뼈대 | `organizations`·`org_members`·결합표·이력, `/org`·`/org/me`·`/org/<id>`와 조직 읽기/결합 쓰기 | 조직 URL과 결합 프로젝트 목록 |
| 2 조직 롤업 | 기존 사용량 뷰를 결합 프로젝트 집합으로 감싸고 `byProject[]`·`restricted`를 유지 | 조직 총계·프로젝트별·일별 |
| 3 사용자 드릴다운 | `byMember × model × actor_kind`, 역할 forward-only 각인 | 사용자별 모델·실행자와 활동/병렬도 |
| 4 성공률 사람 축 | `task_outcomes.userKey`를 forward-only 각인, 사람 축 뷰와 별도 콜러블 | T0 이후 모델별 성공률·소요·재시도; n≥35 뒤에만 비율 |
| 5 슬러그 | 검증 도메인 고객이 요청할 때만, id URL의 302 별칭 | 사람이 읽는 조직 URL |

**현황을 `0`으로 접지 않는다.** 2026-09-01 오케 실측에서 `organizations`·`org_members`·`org_teams`·`org_projects`·`orgInvitations`는 모두 **0건**이다. 즉 고객 조직은 아직 없다. ★2026-09-01 저녁에 Phase 1 화면·`createOrganization` 콜러블·초대 이관이 배포돼 **만들 수 있는 상태**가 됐지만, 아직 아무도 만들지 않았다. 스키마·룰·콜러블·화면의 존재를 고객 인스턴스의 존재로 읽으면 안 된다.

## 왜

0 없이 1~3을 만들면 사용량이 닫힌 화면 위에 조직 UI만 얹는다. 1 없이 2를 만들면 프로젝트를 조직으로 묶을 키가 없고, 3은 0만 있으면 독립적으로 진행할 수 있다. 4는 새 데이터의 시간 경계가 있으므로 화면보다 각인을 먼저 배포해 T0를 앞당길 수 있다. 슬러그는 id 정체성을 대체하지 않는 고객 요구 기반 편의 기능이다.

## 한계 / 정직성

- Phase 0의 배포 사실과 0건 현황은 2026-09-01 실측 스냅샷이다. 원본 설계의 당시 테스트 발효일과 혼동하지 않는다.
- Phase 4 이전의 성공률 사람 축은 익명 데이터에 소급 각인하지 않는다.
- 수치·세부 구현이 갈리면 원본 설계문서와 그 시점 실측이 옳다.

## 실제 영향

코드·설정 변경 0. 다음 구현 티켓은 1의 인스턴스 생성과 안전한 결합표부터 시작한다.

## Evidence

- [docs/org-analytics-b2b-design-2026-08-31.md](../../org-analytics-b2b-design-2026-08-31.md) — §8 Phase 0~5와 선후관계.
- [docs/org-analytics-metrics-and-screens-2026-08-31.md](../../org-analytics-metrics-and-screens-2026-08-31.md) — 각 단계에서 켜지는 지표.
- [docs/org-team-layer-design-2026-08-31.md](../../org-team-layer-design-2026-08-31.md) — Phase 1·2의 팀 라벨 델타.

## Backlinks

- [[b2b-team-label-layer]] — Phase 1·2에만 더해지는 분석 그룹핑.
- [[b2b-web-first-onboarding]] — 첫 고객을 받는 Phase 1의 앞면.
- [[b2b-metrics-and-screens]] — 단계별 화면과 표본 문턱.
- [[enterprise-control-plane-positioning]] — 로드맵이 완성하려는 control-plane 사슬.
- [[telemetry-data-model-map]] — 사람 축을 소급하지 않는 이유.
- [[b2b-shipped-2026-09-01]] — 2026-09-01 착지분과 함정
- [docs/org-onboarding-as-built-2026-09-01.md](../../org-onboarding-as-built-2026-09-01.md) — 2026-09-01 코드·Cloud Functions·Firestore 건수 대조(as-built)

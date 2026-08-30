# B2B 팀 분석 화면 — 무엇이 살아 있나 (판정, 2026-08-30)

티켓 `4pzSMjDOocbCjQxjfxx7` · 역할 backend · 판정 시각 2026-08-30 (BQ·Cloud Functions 실측은 `john.kim` ADC REST)

> **한 줄 판정**: 기획만 한 게 아니다 — **팀 사용량(멤버·프로젝트·모델·일별) 화면과 서버, 감사(원장) 탭은 구현돼 배포돼 있다.** 그러나 지금 열면 사용량 탭은 **`disabled` 사유 문장 하나**만 보인다(게이트 env 미설정 + BQ 뷰 미프로비저닝). 감사 탭은 권한이 있으면 **실데이터**가 보인다. **성공/실패 지표는 없었고**, 이번에 계정 축(티켓 원장 `FAILED`)으로 한 칸 붙였다. `task_outcomes` 기반 성공률은 **축 가드가 막는 조인**이라 붙이지 않았다. **조직(org) 축은 코드에만 있고 화면·컬렉션에는 없다.**

## 1. 기능별 살아있음 판정표

| 기능(사장님 질문 축) | 화면(`marblo-web /[locale]/team`) | 서버(`v3/functions`) | 데이터 | ★지금 열면 보이는 것 |
| --- | --- | --- | --- | --- |
| 원장(감사) 로그 분석 | ✅ `TeamAuditView.tsx` (감사 탭: 사건 피드·주의 티켓·에이전트 워크로드·미션) | ✅ `getTeamProjectAudit` (`index.ts:16085~`, 순수 로직 `teamAudit.ts`) | ✅ Firestore 프로젝트 원장(`project_event_ledger`) | **역할 있으면 데이터**. 없으면 `no_project`/`no_role`/`no_events` 사유. ★게이트 밖(금액 칸 없음 — 설계 규칙) |
| 팀별·멤버별 사용량 | ✅ `TeamUsageView.tsx` `ByMemberRow` | ✅ `getTeamUsageSummary` (`index.ts:17410~`, `teamUsage.ts`) | ❌ BQ `v_team_usage_daily` **없음**(INFORMATION_SCHEMA 실측) | **`disabled` 사유 문장만** (아래 §3) |
| 프로젝트별 | ✅ `ByProjectRow` | ✅ 동일 콜러블 | ❌ 동일 | 동일 |
| 에이전트·모델별 비용 | ✅ `ByModelRow`(비용·토큰) · `ByActorKindRow`(오케/워커 축) | ✅ 동일 · 오케 축은 `orchestrator_not_collected` 상태로 분리 | ❌ 동일 · 오케 축은 **미수집**(설계 규칙 2) | 동일 |
| 본인(self) 사용량 | ✅ 같은 화면, self 스코프 | ✅ 게이트 밖, `cost_logs` 직접 질의 | ✅ `cost_logs` (기록 있음) | **동작** — 일반 멤버는 자기 것만 |
| ★성공/실패 | ❌ → ✅ **이번 PR** 감사 탭 "실패 티켓" 타일 | ✅ `summary.tasksByStatus`(`teamAudit.ts:308`) 가 이미 있었음 — 웹 계약이 안 받고 있었다 | ✅ Firestore `tasks` 상태 | 역할 있으면 `FAILED` 건수 · 결측이면 '모름'(0 아님) |
| ★성공/실패(모델별 성공률, `task_outcomes`) | ❌ | ❌ (팀 콜러블은 익명 축을 **읽지 못한다** — 소스 스캔 가드) | ✅ 1,792행 · 판정 1,662 · 성공 1,563 · 최근 30일 1,295 · 프로젝트 21 · 설치 7 | **없음 — §2** |
| 조직 > 팀 > 멤버 계층 | ❌ 화면에 org 없음(`grep org` 0건) | ⚠️ `orgIdentity.ts` 순수 판정 로직만 | ❌ org 컬렉션 없음(`organization.ts` 주석: 트리거 미충족) | **프로젝트 > 멤버** 2단만 보인다 — §5 |

## 2. 갭 1 — 성공/실패 지표 판정

**붙일 수 있는 것(붙였다):** 계정 축 **티켓 상태**. 서버 `getTeamProjectAudit` 봉투의 `summary.tasksByStatus` 는 `projectAudit.ts:689` 가 `TASK_STATUSES` 전부를 0 으로 초기화해 세고 있었고, 웹 계약 `teamAuditContract.ts` 가 `tasksDone` 까지만 받았다. 이번 PR:
- `teamAuditContract.ts` `summary.tasksFailed = num(tasksByStatus.FAILED)` — 결측은 `null`(모름), `FAILED: 0` 은 실제 0.
- `TeamAuditView.tsx` 요약 타일 "실패 티켓"(>0 이면 alert 톤). ko/en/ja 문구.
- 테스트 6건(계약 4 · 뷰 2×3로케일). ★감사 탭에 **금액 칸을 만들지 않았고** '청구액' 단어도 없다.

**붙일 수 없는 것(붙이지 않았다):** `task_outcomes.success`(모델별·역할별 성공률).
1. `task_outcomes` 는 **익명(설치) 축**이다 — `userId` 는 설치 clientId, **`userKey` 각인 컬럼이 없다**(스키마 실측: `userId,taskId,projectId,…,success,…,outcomeMode`). 사람 축 각인(08-29 13:14:19Z~)은 `events` 에만 됐다.
2. `taskId`/`projectId` 는 **HMAC 가명**이고 `cost_logs` 는 원시 id 를 갖는다(`index.ts:537`). 즉 웨어하우스 안에서는 조인 키 자체가 안 맞는다 — **설계된 분리**다.
3. 설령 사람 축을 거쳐도, 팀 콜러블 `teamUsage.ts` 에 `task_outcomes`·`v_person_*` 이름이 **등장하는 것 자체**를 `tests/unit/team-usage-axis-guard.test.ts` 가 실패로 잡는다(18/18 pass 확인). `assertAxisPurity` 우회 없음.

**열려면(별건 티켓):** (a) `logTaskOutcome` 에 `events` 와 같은 forward-only `userKey` 각인(경계 이후만, 소급 없음) → (b) 사람 축 뷰에 `success` 집계 → (c) **팀 사용량 콜러블이 아닌 별도 콜러블·별도 탭**("모델별 결과(사람 축, 08-29 이후)") 으로 라벨 달아 노출. 사람 축은 지금 링크된 사람 2명뿐이라 당장 값이 거의 없다.

## 3. 갭 2 — 게이트 현재 상태

| 층 | 실측 | 결과 |
| --- | --- | --- |
| Cloud Functions env (`getTeamUsageSummary`, 08-29 13:12:59Z 배포, ACTIVE) | `TEAM_USAGE_EFFECTIVE_FROM` **없음** (`PERSON_AXIS_EFFECTIVE_FROM`·`EVENTS_PERSON_STAMP_FROM` 은 있음) | 팀 스코프 = `state: "disabled"` + `gate_unset` 사유. **질의 자체를 안 한다**(`index.ts` "게이트: 닫혔으면 질의 자체를 하지 않는다") |
| BQ `marblo_telemetry` | `v_team_usage_daily`·`v_team_usage_unattributed` **없음** (`cost_logs`·`task_outcomes` 는 있음) | env 를 넣어도 다음 상태는 `not_provisioned`("적재 전") — `0` 으로 그리지 않는다 |
| 화면 | `TeamUsageView.tsx:644` `state === "disabled"` → 사유 문장만 | 오너가 보는 문장: "팀 사용량 열람이 아직 열려 있지 않습니다. … 안내 개정과 사전 통지 뒤에 열립니다. 본인 사용량은 지금도 볼 수 있습니다." |

**열려면, 순서대로 셋:** ① 처리방침 개정 + 사전 통지(설계 §5.1 — 팀 오너가 멤버 사용량을 보는 것은 고지된 목적이 아니다) → ② `cd v3/functions && npm run provision:team-usage -- --apply` (뷰 2개, `assertAxisPurity` 통과 필요) → ③ 배포 env `TEAM_USAGE_EFFECTIVE_FROM=<발효일 YYYY-MM-DD>`. 권한은 이미 준비돼 있다(owner/admin 만 팀 분해, member 는 self 로 강등 — `canSeeTeamBreakdown`). ★①이 선행이라 **지금 닫혀 있는 것은 버그가 아니라 설계된 기본 상태**다.

## 4. 갭 3 — 설계 문서 정정(같은 PR)

- `docs/team-usage-overview-design-2026-08-21.md` 상태 줄: "설계 doc (구현 없음)" → **구현됨 + 게이트 닫힘·뷰 적재 전** 으로.
- `docs/analytics-dashboard-plan.md`: 상단에 2026-08-30 정정 블록 — ① 1차 텔레메트리는 **기본 ON**(`firstPartyGate.ts`, 정당한 이익, 07-17 승인) ② **Sentry 설치됨**(`@sentry/electron ^7.15.0`, `sentry-main.ts`, 동의·DSN 게이트) ③ 그 사이 생긴 팀 화면·어드민 콜러블·사람 축. 본문은 07-12 실측으로 남겼다.

## 5. 갭 4 — 조직 계층 판정

- 코드: `v3/src/types/organization.ts`(Firestore 모양) · `functions/src/orgIdentity.ts`(이름 제안/가입 판정 순수 로직) — **둘 다 컬렉션을 만들지 않는다**(파일 주석이 명시: 트리거 = "고객사가 프로젝트 2개를 한 화면에서 본다 / 좌석 계약 서명", PR-11 룰 확장에 걸림).
- 화면: `marblo-web` 전체에서 org 참조 0건(JSON-LD `Organization` 만 있음). `/team` 은 **프로젝트(들) > 멤버** 2단이고, 프로젝트 여러 개는 "내 권한 집합 전체" 로 합산될 뿐 조직이라는 상위 노드가 없다.
- 판정: **조직 > 팀 > 멤버 는 화면에 없다.** 설계(`enterprise-org-dashboard-screen-design-2026-08-24.md`)는 있으나 실사용 조직이 0 이라 트리거 미충족. 별건.

## 6. 빈 상태 검증

- 실사용 팀이 사실상 없다(외부 4명, 다중 멤버 프로젝트 1개·2인). 기본 화면 = `disabled` 문장(사용량) / `no_project`·`no_events`(감사).
- 기존 테스트가 이미 고정: `TeamUsageView.test.tsx`(disabled 는 숫자 0개 · empty · not_provisioned 별문구), `TeamAuditView.test.tsx`("빈 피드는 0 이 아니라 빈 상태", "요약 결측은 '모름'"), `normalizeTeamAudit(undefined)` 가 던지지 않음. 이번 추가 타일도 결측 → '모름' 테스트 포함.
- 결과: marblo-web team 디렉토리 207 테스트 중 **206 pass · 1 fail** — 실패 1건(`teamCopy.test.ts` "인벤토리 사본이 서버 원본과 어긋나지 않는다")은 **main(a606d958)에서도 동일 실패**하는 기존 건이며 이 변경과 무관(SERVER_INVENTORY 갱신 별건).
- `marblo-web tsc --noEmit` 0 · `eslint team/` 0 · `v3 tsc --noEmit` 0 · `team-usage-axis-guard` 18/18.

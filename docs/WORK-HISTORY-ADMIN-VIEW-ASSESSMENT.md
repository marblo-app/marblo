# 완료이력 — 관리자용 상세 뷰 필요성 판단 (티켓 k1RYUDCc)

**결론: 웹 admin 에 "완료이력 세그먼트" 를 새로 만들지 않는다.** 제안된 4개 축
(기간·모델·성공률·비용) 중 3.5개는 #643 이 이미 깔아 놓았고, 나머지 하나는 기존
섹션에 차트 1개를 더하는 문제다. 데스크톱 완료이력 탭은 이번 PR 의 필터 강화로
충분하다. 두 화면은 **경쟁 관계가 아니라 다른 질문에 답한다.**

---

## 1. 두 화면이 답하는 질문이 다르다

|             | 데스크톱 완료이력 탭                               | 웹 admin AnalyticsPanel                           |
| ----------- | -------------------------------------------------- | ------------------------------------------------- |
| 데이터 출처 | Firestore `tasks` + `activities` + `merge_history` | BigQuery `task_outcomes` / `cost_logs` / `events` |
| 스코프      | **내 프로젝트 1개**, 식별된 실제 티켓              | **전 유저 익명 집계**(clientId), 운영자 제외      |
| 단위        | 티켓 1건 — 제목·문제/접근/변경/검증·PR·diff        | 모델·역할·일자 버킷의 수치                        |
| 답하는 질문 | "이 티켓 뭐였지, 뭘 바꿨지, PR 어디 있지"          | "어느 모델이 어느 역할에서 잘 되나, 얼마 썼나"    |
| 실시간성    | Firestore 구독 = 즉시                              | BQ 적재 지연 + 옵트인 표본                        |

완료이력 탭의 값은 **provenance**(문제/접근/변경/검증 + diff + PR)에 있다. 이건
BigQuery 에 안 올라간다 — `task_outcomes` 는 라벨(성공/시간/비용/재시도)만 싣는다.
반대로 admin 의 값은 **cross-user 집계**에 있고, 이건 데스크톱이 볼 수 없다.
한쪽을 다른 쪽에 복제하면 둘 다 반쪽이 된다.

## 2. 제안된 축은 이미 admin 에 있다

`marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` 실측:

| 제안 축       | 현재 상태 | 어디                                                                                                            |
| ------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| **기간**      | ✅ 있음   | `RangeControl` 7/30/90 (`RANGE_PRESETS`, L1015) — 패널 전역                                                     |
| **성공률**    | ✅ 있음   | "태스크 성공률" StatCard(`u.tasks.successRate`, 성공/전체) + "모델 × 역할 성공률·효율" 테이블(`ModelRoleTable`) |
| **모델**      | ✅ 있음   | 모델별 비용 · 일별 모델별 비용(StackedBar) · 하네스→하위모델 분해 · 모델별 Outcome(재작업 포함)                 |
| **비용**      | ✅ 있음   | `costByModel` / `costByDay` / `costByDayModel` + 모델×역할 평균비용·비용대비효율                                |
| 평균 완료시간 | ✅ 있음   | "평균 완료시간" StatCard + `ModelRoleTable.avgDurationMs`                                                       |
| 드릴다운      | ✅ 있음   | `segment:model` / `segment:role` / `cost:day` `DrilldownModal`                                                  |

즉 티켓이 그린 "완료이력 세그먼트(기간·모델·성공률·비용)" 는 **이미 있는 것을 한
번 더 그리는 일**이다. 새 섹션을 만들면 같은 `task_outcomes` 를 두 군데서 다르게
집계하는 위험(수치 불일치)만 늘어난다.

## 3. 진짜 빈 칸은 하나뿐 — 일별 완료 추이

admin 에 **없는** 것: `task_outcomes` 의 **일별 완료 건수 시계열**.
지금 일별 추이는 `activeByDay`(DAU)와 `spawnsByDay`(스폰)뿐이라 "스폰은 늘었는데
완료는 늘었나" 를 화면에서 못 본다. 성공률은 기간 전체 스칼라 1개라 추세가 안 보인다.

- 크기: `v3/functions/src/index.ts` 의 `getAdminUsageSummary` 에 쿼리 1개
  (`SELECT DATE(completedAt) d, COUNT(*), COUNTIF(success) FROM task_outcomes
WHERE … GROUP BY d`) + 웹에 `TwoLineChart`(이미 있는 컴포넌트) 1개.
- **★단, 지금 붙이면 빈 차트가 나올 가능성이 높다.** 같은 화면의
  `ThinLabelNotice` 가 명시하듯 `task_outcomes` 는 success 상수·비용 0 라벨 결함
  때문에 3.0.17 이후 축적분부터만 해석 가능하다. 데이터가 찰 때까지는 축을 하나
  더 여는 것 자체가 "데이터 있는 축만" 원칙 위반이다.
- **판단: 별도 후속 티켓으로 보류.** 축적 상태를 먼저 확인(`task_outcomes` 행수 ·
  distinct completedAt 일수)하고, 유의미하면 그때 위 1쿼리+1차트로 끝낸다.
  지금 이 티켓에서 구현하지 않는다.

## 4. 데스크톱 탭에서 하지 않은 것과 그 이유

- **모델 필터 ✗** — Task 문서에 모델 축이 **없다**. `Task` 는 role·claimedBy·
  costTotal 만 갖고, 모델은 완료 시점에 `agents/{claimedBy}` 스냅샷을 읽어
  `task_outcomes`(BQ) 로만 나간다(`services/taskOutcomeReporter.ts` L119-126).
  agent doc 은 cleanup 으로 사라지므로 **과거 완료 태스크의 모델은 렌더러에서
  재구성 불가**. 추정으로 채우면 날조가 된다 → 넣지 않았다.
  (모델별로 보고 싶으면 그 축이 실제로 존재하는 곳 = admin 의 모델×역할 테이블.)
- **비용 컬럼 ✗** — `task.costTotal` 은 존재하지만 rollup 이 붙기 전 태스크에는
  없어(optional) 대부분 "—" 로 뜬다. 값이 있는 티켓만 골라 보여주면 합계가
  거짓말이 되므로, 비용은 축적이 확인된 뒤 별도로 다룬다.
- **날짜범위 직접입력 ✗** — 7/30/전체 프리셋으로 요청을 충족하고, 사용량 탭과
  같은 컨트롤(`components/common/PeriodSelector`)을 **공유**한다. 커스텀 범위를
  한쪽에만 넣으면 두 화면이 갈라진다. 필요해지면 공용 컴포넌트에 한 번 넣는다.

## 5. 요약 권고

1. **이번 PR**: 데스크톱 완료이력 탭 = 기간(7/30/전체) + 역할 + 검색 필터. ✅ 구현
2. **admin 완료이력 세그먼트**: 만들지 않는다 (중복).
3. **후속 후보(보류)**: admin "제품 사용·활성" 섹션에 _일별 완료/성공 추이_ 라인
   1개 — `task_outcomes` 축적이 확인된 뒤에.

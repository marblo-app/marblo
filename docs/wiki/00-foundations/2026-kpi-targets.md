---
title: 2026 KPI 목표 — 가입자가 아니라 Qualified → Activated → Retained
tags: [domain/foundations, topic/observability, topic/identity, verdict/adopt]
status: verified
date: 2026-08-29
links: [[telemetry-identity-axes]], [[overview]], [[glossary]]
---

# 2026 KPI 목표 — 가입자가 아니라 Qualified → Activated → Retained

> **한 줄 판정**: ★채택 — 2026년 목표는 **가입자 수가 아니다.** 실제로 쓰는 개발자를 `Qualified → Activated → Retained` 세 단계로 세고, 그중 **D30 ≥ 20%** 가 가장 중요한 단일 숫자다(사장님 2026-08-29 지시). ★그리고 **광고 최적화 KPI 도 Beta Signup 이 아니라 Activated 로 잡는다** — 신청을 늘리는 광고와 쓰게 만드는 광고는 다른 광고다. 정의가 확정되면서 **9개 중 4개는 지금 잰다** — 다만 리텐션은 아직 **설치 축으로만** 나오고 3개는 텔레메트리에 아예 없다(아래 §측정 가능성). 목표를 세우는 것과 잴 수 있는 것은 별개다.

## 무엇을 물었나

1. 베타 종료와 Seed 를 판단할 숫자는 무엇인가. 가입자 수로는 왜 안 되나.
2. 그 숫자들을 **지금 잴 수 있나.**

## 목표 (사장님 확정, 2026-08-29)

| 지표                    | 정의                                                |    2026 목표 |
| ----------------------- | --------------------------------------------------- | -----------: |
| **Qualified Beta**      | 베타를 신청하고 **우리가 승인한** 사람              |          500 |
| **Activated**           | **실제로 Task 스폰을 시작한** 사람                  |          200 |
| **D14 Retention**       | 14일 후 다시 **실제 Task 수행**                     |       ≥ 25 % |
| **D30 Retention**       | 30일 후에도 실제 사용                               | ★ **≥ 20 %** |
| **D30 Users**           | D30 을 넘긴 실제 인원                               |      30 ~ 40 |
| **Power Users**         | 주 3일+ **또는** 주 10 Task+                        |         20 + |
| **Design Partners**     | 기업/팀                                             |        3 ~ 5 |
| **Paid PoC**            | 돈 받고 실증                                        |        1 ~ 2 |
| **Monthly Agent Tasks** | 실사용 Task                                         |       10 K + |

### 오늘의 출발점 (2026-08-29 실측)

| 지표                | 현재                | 목표    | 배수         |
| ------------------- | ------------------- | ------- | ------------ |
| Qualified Beta      | 신청 73 · **승인 8** | 500     | **62배**     |
| Activated           | **7** (설치 축)      | 200     | **28배**     |
| Monthly Agent Tasks | **1,212**           | 10 K +  | **8배**      |

★신청 73건 중 62건이 아직 미처리다(`status` 없음). **승인은 우리가 하는 일이므로 이 칸은 광고 없이도 오늘 올릴 수 있다** — 62건을 처리하면 승인이 70이 된다.

### 광고 퍼널 목표 (같은 날 확정)

```
Instagram / YouTube / X → 「AI 빌더 되기」 콘텐츠 → AI Builder Guide
  → Marblo Beta → Beginner Mode(자동 CLI 설치/Login)
  → 첫 Project → 첫 Agent Task = ★ACTIVATED → 3 Tasks 완료
```

| 구간               |          목표 |
| ------------------ | ------------: |
| 광고 CTR           |       1.5 % + |
| Landing → Beta     |     10 ~ 20 % |
| Beta → 설치        |        60 % + |
| 설치 → 첫 Project  |        60 % + |
| Project → 3 Tasks  |        50 % + |
| Signup → Activated |   30 ~ 40 % + |
| **Activated CPA**  | ₩3 ~ 5만 이하 |

★**ACTIVATED 정의는 위 표와 같은 하나여야 한다.** KPI 화면과 광고 퍼널이 서로 다른 ACTIVATED 를 쓰면 둘 다 못 믿는다.

## ★측정 가능성 — 지금 잴 수 있는 것과 없는 것

2026-08-29 프로덕션 BQ 실측. **이 절이 이 노트의 핵심이다** — 목표만 적고 측정 갭을 안 적으면 다음 사람이 "숫자가 왜 안 나오지" 로 하루를 쓴다.

| 지표                | 지금 재나             | 근거                                                 |
| ------------------- | --------------------- | ---------------------------------------------------- |
| Monthly Agent Tasks | ✅ 잰다               | `task_outcomes` — 최근 30일 **1,212건**(성공 1,064)  |
| D7/D14/D30          | ⚠️ **설치 축으로만**  | 사람 축 분모가 1 이라 비율을 못 그린다               |
| Activated           | ✅ 잰다               | 첫 Task 스폰 = `task_outcomes` 첫 행 — 이미 계측된다 |
| Power Users         | ⚠️ 재료는 있음        | `analytics_user_daily` 의 `day`·`tasks_completed`    |
| Qualified Beta      | ✅ 잰다               | `betatester50_waitlist` — 신청 73 · **승인 8**       |
| Paying Users        | ✅ 잰다               | Firestore `subscriptions`                            |
| Design Partners     | ❌ 못 잰다            | 계약 사실 — 텔레메트리에 없다. 수동 입력             |
| Paid PoC            | ❌ 못 잰다            | 같음                                                 |
| 광고 CTR·비용·CPA   | ❌ 못 잰다            | Instagram/YouTube/X 쪽 데이터. 비용 입력 경로가 없다 |

### ★가장 큰 갭 — 사람을 못 센다

지표가 전부 **사람 수**인데 계측은 대부분 **설치 축**이다.

| 축                                         | 값                          |
| ------------------------------------------ | --------------------------- |
| 설치(`analytics_user_daily.install_key`)   | 44개 (그중 Task 한 설치 7)  |
| 계정(`analytics_account_profile`)          | 34개                        |
| **사람 축 링크**(`analytics_user_install`) | ★ **5행 / 사람 4 / 설치 4** |
| `v_person_since_link` 실사용               | 사람 2 · Task 한 사람 **1** |

즉 **사람 축 커버리지가 44개 설치 중 3개**다. 사람 축으로 D30 을 그리면 분모가 1 이다.

★**가명키 체계 자체는 이미 완성돼 있다**(PR #1081, `personAxis.ts`) — `us_` + HMAC-SHA256(salt, uid) 24hex. 솔트는 Node 안에서만 계산하고 BQ SQL 에는 원시 uid 도 솔트도 나가지 않는다. 이벤트에 컬럼을 만들지 않고 **링크표 하나 + 뷰 두 벌**로 조회 소급한다. **없는 것은 식별자가 아니라 링크다.**

그 구조가 좋은 소식을 하나 준다 — 소급이 저장이 아니라 조회이므로 **링크 한 행이 생기면 그 사람의 과거가 통째로 따라온다.** 복구 비용이 "과거 이벤트 32만 건 수정"이 아니라 "링크 만들기"다.

### 참고 — 오늘의 설치 축 숫자 (목표와 비교하지 말 것)

| 지표 | 설치 축 현재 |
| ---- | ------------ |
| D7   | 43 % (3/7)   |
| D14  | 57 % (4/7)   |
| D30  | 50 % (3/6)   |

★**이 숫자로 "D30 20% 달성"이라고 읽으면 안 된다.** 분모가 6이고 대부분 내부 도그푸드다. D14(57%)가 D7(43%)보다 높은 역전이 그 증거다 — 리텐션은 단조 감소해야 한다. 분모가 한 자릿수면 곡선이 의미를 갖지 못한다. **아직 아무것도 모른다**가 정직한 답이다.

## 왜

**가입자 수는 우리가 팔려는 것을 재지 않는다.** 마블로는 설치하고 CLI 를 연결하고 프로젝트를 열고 에이전트를 돌려야 비로소 값을 준다. 그 앞에서 멈춘 사람은 제품을 본 적이 없다 — 세면 자기기만이다. 그래서 `Qualified → Activated → Retained` 로 단계를 나눈다.

**D30 이 왜 단일 최중요인가.** 개발 도구는 한 번 써보는 것과 도구로 삼는 것 사이가 멀다. 30일 뒤에도 Task 를 돌린다는 것은 **워크플로에 들어갔다**는 뜻이고, 그것만이 Seed 에서 팔 수 있는 사실이다. D7 은 호기심으로도 나온다.

**광고를 Activated 로 평가하는 이유도 같다.** 신청 수를 최적화하면 신청만 잘하는 트래픽이 온다. 우리가 사야 할 것은 신청이 아니라 **쓰기 시작한 사람**이고, 그래서 CPA 의 분모도 Activated 다.

## 한계 / 정직성

- ★**9개 중 4개만 지금 잰다.** 위 §측정 가능성이 그 목록이다. 목표를 세운 것과 계기판이 있는 것은 다르다.
- ★**"D30 50%" 같은 숫자를 성과로 인용하지 마라.** 분모가 6이다. 비율을 쓸 때는 **항상 분모를 함께** 적는다.
- ★**Activated 기준이 낮아졌다**(2026-08-29 사장님 확정). 이전 초안은 "3 Task 이상"이었으나 **첫 스폰**으로 앞당겼다. 같은 이름이 다른 것을 뜻하게 됐으므로, 이 날짜 이전에 계산된 Activated 숫자와 비교하지 마라.
- 설치 축 숫자에는 **운영자 제외가 구조적으로 불가능**하다(`is_admin` 이 계정 축에만 있고 두 축은 조인이 막혀 있다). 그래서 설치 축 지표는 도그푸드 쪽으로 **낙관 편향**이다.
- 목표치의 출처는 사장님 판단이다. 시장 조사나 벤치마크로 유도한 값이 아니다 — 근거를 물으면 그렇게 답해야 한다.
- 광고 퍼널 목표(CTR 1.5% 등)는 **집행 전 가설**이다. 실측으로 갱신될 값이다.

## 실제 영향

**코드 무변경. 문서만.** 이 노트가 고정하는 것은 넷이다.

1. 우리가 세는 것은 가입자가 아니라 `Qualified → Activated → Retained` 다.
2. **D30 ≥ 20%** 가 단일 최중요 숫자다.
3. 광고는 **Activated** 로 평가한다. Signup 으로 최적화하지 않는다.
4. ★**ACTIVATED 정의는 하나다** — KPI 화면과 광고 퍼널이 같은 상수에서 파생한다.

진행 중인 후속: KPI 화면(`6jeXDBQ1xoH0FoXwjqAL`) · 광고 퍼널(`O5JPlh4FSiCsNpZ4E9VJ`) · 사람 축 커버리지 조사(`jGUu096QviVsooCWslwv`) · 이벤트 축 전환 설계(`VZ0K2FIeASLrWy9bwvN1`).

## Evidence

- 목표 원문 — 사장님 지시 2026-08-29 (KPI 표 · 광고 퍼널 · 확정 목표 세트)
- [v3/functions/src/personAxis.ts](../../../v3/functions/src/personAxis.ts) — `us_` 가명키, 게이트, 링크표 스키마
- `v3/docs/person-axis-user-key-design-2026-08-21.md` — 설계 정본 (PR #1081)
- BQ 실측 2026-08-29 — `marblo_telemetry.task_outcomes`(최근 30일 1,212건) · `analytics_user_daily`(install_key 44) · `analytics_account_profile`(34행) · `marblo_identity.analytics_user_install`(5행) · `v_person_since_link`(사람 2)
- [v3/functions/src/index.ts](../../../v3/functions/src/index.ts) — `getAdminKpiCockpit`(11330) · `getAdminOnboardingFunnel`(10145)

## Backlinks

- [[telemetry-identity-axes]] · [[overview]] · [[glossary]]

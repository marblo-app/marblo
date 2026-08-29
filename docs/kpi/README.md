# KPI — 2026 목표와 그 근거

마블로가 2026년에 **무엇을 세는지**, 그 목표가 **어디서 나왔는지**, 그리고 **지금 값은 어디서 보는지**를 한 화면에 모은 입구다.

이 폴더는 문서를 **옮겨 오지 않는다.** 각 문서는 자기 자리에 그대로 있고, 여기는 길만 안내한다. 이유는 아래 [§왜 옮기지 않았나](#왜-옮기지-않았나)에 있다.

---

## 여기서 시작하세요

| 무엇을 알고 싶나 | 가는 곳 |
| --- | --- |
| 2026 목표 숫자와 그 정의 — **정본** | [2026 KPI 목표](../wiki/00-foundations/2026-kpi-targets.md) |
| 그 목표들이 서로 맞나 — CEO 압박검증 | [2026 KPI 목표 압박검증](../wiki/00-foundations/2026-kpi-targets-pressure-test.md) |
| **지금 실시간 값** | 어드민 → 분석 → `⓪ KPI` 탭 |
| 왜 "사람 수"를 못 세나 — 축 문제 | [텔레메트리 식별 축](../wiki/00-foundations/telemetry-identity-axes.md) |
| 3개년 매출·요금제·마케팅 계획 | [3개년 사업계획](../MVP/business-plan-3year.md) |
| 가격·도메인·일정·결제·SKU 단일진실원 | [v3.1 런칭 마스터플랜](../MVP/v3.1_런칭_마스터플랜.md) |

---

## 역할 분담 — 문서와 화면이 다른 숫자를 말하지 않으려면

같은 지표를 문서도 적고 화면도 그린다. 둘 다 "현재값"을 말하기 시작하면 반드시 갈린다. 그래서 역할을 나눈다.

| 무엇 | 누가 맡나 | 왜 |
| --- | --- | --- |
| **목표·정의·근거·한계** | 문서 (위키) | 판단의 근거는 버전이 남아야 한다 |
| **실시간 현재값** | 화면 (어드민 `⓪ KPI` 탭) | 값은 매일 바뀐다. 문서에 박으면 다음 달에 거짓말이 된다 |
| **계산 규칙** | 코드 (`buildBetaScorecard`) | 정의가 두 벌이면 두 수가 조용히 갈라진다 |

★**이 README 는 현재값을 말하지 않는다.** 아래 §스냅샷은 날짜가 박힌 **고정 기록**이지 현재값이 아니다.

---

## 지표 11개 — 무엇이 어디에 사는가

목표치는 아래에 **한 번 더 적혀 있다.** ★정본은 [2026 KPI 목표](../wiki/00-foundations/2026-kpi-targets.md)이고, 갈리면 그쪽이 옳다. 목표를 바꿀 때 고칠 곳은 [§목표를 바꾸려면](#목표를-바꾸려면--고칠-곳-3군데)에 있다.

| 지표 | 정의 (요약) | 2026 목표 | 지금 재나 |
| --- | --- | ---: | --- |
| Qualified Beta | 신청하고 우리가 승인한 사람 | 500 | ⚠️ 축 미확정 (아래 ★) |
| Activated | 실제로 Task 스폰을 시작한 사람 | 200 | ✅ |
| D7 Retention | 7일 후 재사용 | *(목표 없음)* | ⚠️ 설치 축으로만 |
| D14 Retention | 14일 후 다시 실제 Task | ≥ 25 % | ⚠️ 설치 축으로만 |
| **D30 Retention** | 30일 후에도 실제 사용 — ★단일 최중요 | **≥ 20 %** | ⚠️ 설치 축으로만 |
| D30 Users | D30 을 넘긴 실제 인원 | 30 ~ 40 | ⚠️ 설치 축으로만 |
| Power Users | 주 3일+ **또는** 주 10 Task+ | 20 + | ⚠️ 재료만 있음 |
| Monthly Agent Tasks | 실사용 Task | 10 K + | ✅ |
| Paying Users | 유료 구독자 | *(목표 없음)* | ✅ |
| Design Partners | 기업/팀 | 3 ~ 5 | ❌ 수동 입력 |
| Paid PoC | 돈 받고 실증 | 1 ~ 2 | ❌ 수동 입력 |

목표 9개 · 화면 11칸. 차이는 **D7 Retention** 과 **Paying Users** 로, 화면은 그리지만 목표치가 없다. 목표를 붙이면 12번째 KPI 가 되므로 일부러 비워 둔 자리다.

★**"지금 잰다"가 "믿을 수 있다"는 뜻은 아니다.** 리텐션 4칸은 사람 축이 아니라 **설치 축**으로만 나오고, 분모가 한 자릿수라 비율이 의미를 갖지 못한다. 왜 그런지는 정본 문서의 §측정 가능성과 [텔레메트리 식별 축](../wiki/00-foundations/telemetry-identity-axes.md)에 있다.

---

## 2026-08-29 스냅샷 — 베타 접근 퍼널

★**이 절은 2026-08-29 에 고정된 기록이다.** 오늘 값이 궁금하면 어드민 `⓪ KPI` 탭을 보라. 이 숫자는 갱신하지 않는다.

| 단계 | 값 | 어느 필드에서 오나 |
| --- | ---: | --- |
| 신청 | 73 | `getAdminBusinessSummary.waitlist.total` |
| 선정 | 65 | `getAdminBusinessSummary.founders.total` |
| 접근권 부여 | 34 | `getAdminBusinessSummary.betaAccess.grantTotal` |
| 유효 (만료 전) | 8 | `getAdminBusinessSummary.betaAccess.grantActive` |
| 외부 지속사용자 | 1 | 사람 축 — Task 를 한 사람 |
| 최근 30일 Task | 1,212 | `marblo_telemetry.task_outcomes` |

### ★미해결 — "Qualified Beta = 500" 의 분자가 어느 칸인가

위 네 칸 중 **무엇이 Qualified Beta 인지 아직 확정되지 않았다.** 정의는 "신청하고 우리가 승인한 사람"인데, 지금 문서와 화면이 서로 다른 칸을 읽고 있다.

| 어디 | 읽는 칸 | 목표 500 대비 |
| --- | --- | ---: |
| 정본 문서 (2026-08-29 판) | 8 | 62 배 |
| 어드민 `⓪ KPI` 화면 | 접근권 = 34 | 15 배 |
| 정의를 글자대로 읽으면 | 선정 = 65 | 7.7 배 |

★**여기서 한쪽을 골라 적지 않는다.** 고르면 세 번째 출처가 생기고, 그게 정확히 이 README 가 막으려는 실패다. 확정되면 정본 문서와 화면을 **같은 칸으로** 맞추는 별건 작업이 필요하다 — 62 배와 7.7 배는 긴급도가 전혀 다르게 읽힌다.

---

## 목표를 바꾸려면 — 고칠 곳 3군데

목표치는 문서와 코드에 **각각** 들어 있다. 한 곳만 고치면 화면과 문서가 갈린다.

1. [`docs/wiki/00-foundations/2026-kpi-targets.md`](../wiki/00-foundations/2026-kpi-targets.md) — 목표 표 (**정본. 여기부터 고친다**)
2. `v3/functions/src/adminAnalytics.ts` — `buildBetaScorecard` 의 `targetMin` / `targetMax`
3. `v3/functions/src/adminAnalytics.test.ts` — 목표치 단언 (여기가 빨개지면 1·2 가 갈린 것이다)

그리고 이 README 의 지표 표도 같이 본다. 정본은 언제나 1번이다.

---

## 왜 옮기지 않았나

사장님 요구는 "KPI 문서를 한 곳에서 보는 것"이었다. 그것은 입구 하나로 충분하고, 실제로 옮기면 잃는 것이 있다.

- **위키 노트 둘**(목표·압박검증)은 다른 노트 8개가 `[[...]]` 로 가리키고 있고, `docs/wiki/` 밖으로 나가면 그 링크가 전부 깨진다. 더 큰 손실은 KPI 문서만 위키의 린트·백링크·판정 흐름을 안 타게 되는 것이다.
- **3개년 사업계획**은 KPI 문서가 아니다. 352 줄 중 KPI 절은 약 10% 고 나머지는 요금제·월별 매출·인플루언서·채널 전략·특허다. 게다가 그 문서는 스스로 [마스터플랜](../MVP/v3.1_런칭_마스터플랜.md)을 가격 단일진실원으로 선언하며 같은 폴더를 가리킨다 — 떼어내면 그 짝이 갈라진다.

물리적으로 옮기는 편이 낫다고 판단되면 그건 별건 작업이고, 그때는 위키 백링크 정리까지 함께 끝내야 한다.

---

## 부록: 근거

- 목표치 정본 — `docs/wiki/00-foundations/2026-kpi-targets.md` (PR #1300)
- 압박검증 — `docs/wiki/00-foundations/2026-kpi-targets-pressure-test.md` (PR #1302)
- 화면 — `⓪ KPI` 탭, `marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` (PR #1301)
- 목표치 코드 — `v3/functions/src/adminAnalytics.ts` `buildBetaScorecard`
- Qualified Beta 값 출처 — `v3/functions/src/adminAnalytics.test.ts` 의 `getAdminBusinessSummary.betaAccess.grantTotal` 단언
- 퍼널 필드 — `v3/functions/src/index.ts` `getAdminBusinessSummary` 응답 (`waitlist` · `founders` · `betaAccess`)
- 위키 규약 — [`docs/wiki/_meta/CONVENTION.md`](../wiki/_meta/CONVENTION.md)

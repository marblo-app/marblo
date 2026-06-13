# Marblo — Pricing Sync + AI Cost Safety Spec

**Status:** Draft for implementation
**Target:** v3.x Phase 1-3 (6월 런칭 동반 작업)
**Owner:** marblo product
**Spec date:** 2026-05-13
**관련 의사결정 기록:** `~/.gstack/projects/melocream-TaskForce.AI/ceo-plans/2026-05-11-supervisor-v1-5-launch-hook.md` (D13~D19)

---

## 1. 한 줄 요약

마블로 6월 런칭에 맞춰 (1) **v3 데스크탑 코드와 marblo-web 랜딩의 가격/플랜 동기화**, (2) **Mission 자율 진행이 만드는 LLM 비용 폭주 위험 완화 안전망**, (3) **"플로우 에디터 → Mission 진화" 마케팅 서사** 정합화를 한 번에 처리한다.

## 2. 배경

CEO 리뷰 (D13~D19) 결과 발견된 3개 영역의 정합성 깨짐:

1. **v3 코드의 `SubscriptionPlan` enum**과 **marblo-web 랜딩의 plan 구조**가 완전히 다름. 출시 시 결제 흐름 자체 실패 가능.
2. **Mission 자율 진행** (`MISSIONS-SPEC.md` 참조) 가 신규 비용 위험 벡터 도입. BYOK라서 마블로 직접 손해는 없지만 사용자 신뢰 손상 위험.
3. marblo-web 마케팅이 **"플로우 에디터"를 핵심 셀링 포인트로 약속**하는데 product는 Mission 탭으로 진화하기로 결정 (`MISSIONS-SPEC.md` §1). 마케팅-product 모순.

## 3. CEO 결정 사슬 (요약)

| ID  | 결정                                               | 핵심                                                           |
| --- | -------------------------------------------------- | -------------------------------------------------------------- |
| D13 | 다음 토픽 = 가격 / Pricing                         | 매출 시작점, 다른 결정에 영향                                  |
| D14 | 정합성 점검 진행                                   | "구현 완료"와 "CEO 리뷰 필요"는 다른 영역                      |
| D15 | marblo-web 코드 확인                               | 가격은 marblo-web 코드에 정의됨                                |
| D16 | Mission = "플로우 에디터의 진화" 서사              | 마케팅과 product 모순 해소                                     |
| D17 | 다음 토픽 = AI cost / runaway 안전                 | Mission 자율 진행 신규 위험                                    |
| D18 | 안전망 범위 결정 보류                              | D19 전략으로 재정의됨                                          |
| D19 | **정액제 권장 + M1 + 사용량 기반 사용자 경고/cap** | Claude Max 등 정액제 사용 시 무제한, BYOK 사용량 기반은 안전망 |

## 4. 가격 정합성 — 현재 상태 진단

### 4.1 v3 코드 (`v3/src/types/payment.ts:40-43, 220-258`)

```ts
export enum SubscriptionPlan {
  FREE = "free",
  BASIC = "basic", // ← marblo-web에 없음
  PRO = "pro",
  ENTERPRISE = "enterprise",
}

// PAYMENT_PLANS:
//   FREE:        0원,  "월 100건 처리"
//   BASIC:    9,900원, "월 1,000건 처리"
//   PRO:     29,900원, "무제한 처리"           ← 가격 다름
//   ENTERPRISE: 99,900원, "전용 인스턴스"      ← 가격 다름
```

### 4.2 marblo-web 코드 (`marblo-web/src/components/PricingSection.tsx:12-19`, `marblo-web/messages/ko.json`)

```ts
const plans = ["free", "pro", "team", "team_plus", "enterprise"] as const;
const MONTHLY_PRICES: Record<Plan, number> = {
  free: 0,
  pro: 19000,
  team: 29000,
  team_plus: 290000, // per-team floor (5 seats incl.)
  enterprise: 0, // "Contact us"
};
```

Features (ko.json):

- Free: 프로젝트 1개, 에이전트 2개, 칸반, 터미널+에디터, MCP
- Pro: 무제한 프로젝트, 무제한 에이전트, 플로우 에디터, **자연어 오케스트레이터**, 우선 지원
- Team: 인당 과금 (`/인/월`)
- Team Plus: ...
- Enterprise: Contact

### 4.3 비동기화 정리

| 항목      | v3                        | marblo-web                         |
| --------- | ------------------------- | ---------------------------------- |
| Tier 이름 | FREE/BASIC/PRO/ENTERPRISE | free/pro/team/team_plus/enterprise |
| Tier 개수 | 4                         | 5                                  |
| BASIC     | 9,900원 존재              | 없음                               |
| Team 모델 | 없음                      | 인당 과금 명확                     |
| Team Plus | 없음                      | 290,000원/팀(5시트)                |
| Pro 가격  | 29,900원                  | 19,000원                           |

→ **v3 백엔드/앱 정렬 완료 (2026-06-08)**: enum free/pro/team/team_plus/enterprise · 가격 19,000/29,000/290,000 · 연간 ×10.

## 5. 후속 액션 (구현 ticket 단위)

받는 에이전트는 이 6개 액션을 **TaskForce MCP `create_tasks_bulk`로 ticket 생성**한 후 진행할 것.

### A1. v3 ↔ marblo-web 가격 sync 🔴 P0

**파일:** `v3/src/types/payment.ts`

```ts
// AFTER (목표 상태)
export enum SubscriptionPlan {
  FREE = "free",
  PRO = "pro",
  TEAM = "team",
  TEAM_PLUS = "team_plus",
  ENTERPRISE = "enterprise",
}

export const PAYMENT_PLANS: Record<SubscriptionPlan, PlanFeatures> = {
  [SubscriptionPlan.FREE]: {
    name: "Free",
    price_monthly: 0,
    price_yearly: 0,
    features: [
      "프로젝트 1개",
      "에이전트 2개",
      "칸반 보드",
      "터미널 + 코드 에디터",
      "MCP 연동",
    ],
  },
  [SubscriptionPlan.PRO]: {
    name: "Pro",
    price_monthly: 19000,
    price_yearly: 19000 * 10, // 190,000 (2개월 무료)
    features: [
      "무제한 프로젝트",
      "무제한 에이전트 (BYOK — API key 사용자 부담, 정액제 권장)",
      "Mission Templates (5종)",
      "자연어 Mission Launch",
      "우선 기술 지원",
      "모든 Free 기능 포함",
    ],
    recommended: true,
  },
  [SubscriptionPlan.TEAM]: {
    name: "Team",
    price_monthly: 29000, // 인당
    price_yearly: 29000 * 10,
    features: [
      "Pro 전체 + 팀 협업",
      "팀원 추가 (인당 과금)",
      "공유 워크스페이스",
      "팀 활동 대시보드",
    ],
  },
  [SubscriptionPlan.TEAM_PLUS]: {
    name: "Team Plus",
    price_monthly: 290000, // per-team floor (5 seats)
    price_yearly: 290000 * 10,
    features: ["Team 전체 + ...(마블로 웹과 동기화)"],
  },
  [SubscriptionPlan.ENTERPRISE]: {
    name: "Enterprise",
    price_monthly: 0, // Contact
    price_yearly: 0,
    features: [
      "전용 인스턴스",
      "온프레미스",
      "SSO",
      "감사 로그",
      "SLA",
      "전담 지원",
    ],
  },
};
```

**연관 파일 점검:**

- `v3/src/services/paymentClient.ts` — `BASIC` 참조 제거, 새 enum 사용
- `v3/src/types/subscription.ts` — plan 필드 타입 검증
- `v3/src/services/billingService.ts` — Paddle/Toss 통합 시 plan ID 매핑 확인
- 기존 데이터베이스의 `subscription.plan = 'basic'` 레코드 마이그레이션 정책 결정 (실 사용자 있을 경우)

### A2. 마케팅 텍스트 재포지셔닝 🔴 P0

> **Scope 확장 (2026-05-19 D32, Sprint A 동기화)**: 본 ticket은 원래 "플로우 에디터 → Mission Templates" 마케팅 재포지셔닝만 다뤘으나, CEO 결정 D32(평생 50% 할인 SKU 폐기 → 강의 50% + Pro 6개월 무료) + D32a(인프런 → marblo-web 자체 직판) + D36(KO locale 표기 "베타 얼리버드 50") 반영을 위해 i18n 키 갱신 범위 확장. Foundation 50 promo bar / `/foundation50` 페이지 i18n 키는 이미 TaskForce 38fa5a75 / 35879709 (5/19 클로즈)에서 처리 완료.

**파일:** `marblo-web/messages/{ko,ja,en}.json`

**ko.json 변경:**

- `features.flow.title` — `"플로우 에디터"` → `"Mission Templates"` (또는 `"Mission Templates (구 플로우 에디터)"` 진화 명시)
- `features.flow.description` — Mission 진화 서사 추가: "기존 플로우 에디터가 Mission으로 진화. 5개 프리셋(Quick Fix, Polish, Feature, Full Feature, Research)으로 즉시 시작."
- `features.flow.detail` — 5개 Mission Template 라인업 명시
- `pricing.pro.features` — `"자연어 오케스트레이터"` → `"자연어 Mission Launch"`
- (선택) `pricing.pro.features`에 한 줄 추가: `"BYOK 기반 — 정액제 모델 권장 (Claude Max 등)"`
- **확장 (D32)**: 랜딩 페이지 hero·pricing 섹션에 `"평생 50% 할인"` 또는 동등 표현 잔여 있으면 제거. 케이스 스터디 권한 문구는 `"Foundation 50: 강의 50% + Pro 6개월 무료 (KO: 베타 얼리버드 50)"`로 재작성.
- **확장 (D32a)**: 강의 구매 CTA가 인프런 외부 링크면 `/lectures/[slug]` 자체 페이지(Cloudflare Stream 호스팅 wire, P0-18) 또는 `/checkout`로 교체.

**ja.json, en.json** 동일 패턴 적용. 번역 검수 필요. `Foundation 50` 표기는 EN/JA에서 그대로 유지 (D36).

**lectures 페이지:** "AI 매니저는 어떻게 작동하는가" 챕터에 "단순 플로우 자동화 → Mission supervisor 진화" 서사 한 단락 추가.

**연관 ticket**: 마스터플랜 §2.4 + §5 Track A + §8 P0-18/P0-19 + docs/p0_status.md 동기화는 Sprint A에서 완료 (TaskForce f65bb1a1). 이 A2는 marblo-web 코드/i18n 작업만 남음.

### A3. Pro features BYOK + 정액제 권장 명시 🔴 P0

**파일:** `marblo-web/messages/{ko,ja,en}.json` + `marblo-web/src/app/[locale]/pricing/page.tsx` (있다면)

Pro plan features에 아래 항목 추가 (또는 작은 글씨 caption으로):

```
ko: "BYOK 기반 — Anthropic/OpenAI/Google API key 직접 연결.
     정액제 권장: Claude Max ($100/월) + Claude Code = 무제한 사용 가능"
en: "BYOK (Bring Your Own Key) — connect Anthropic/OpenAI/Google API keys directly.
     Subscription plans recommended: Claude Max ($100/mo) + Claude Code = unlimited usage"
ja: (번역)
```

**마케팅 hook 강화 (랜딩 별도 섹션 권고):**

> "Pro 19,000원 + Claude Max $100 = 군단 운영 무제한"
> "Cursor $20에 에이전트 1명. 마블로 + Claude Max로 5명 동시 운용."

### A4. M1 Abort 메커니즘 구현 🔴 P0

**파일:**

- `v3/src/components/missions/MissionAbortButton.tsx` (신규) — 빨간 "Stop All Missions" 버튼
- `v3/src/App.tsx` 또는 글로벌 layout — 키보드 단축키 (`Cmd+Shift+.`)
- `v3/electron/mission-engine/index.ts` — `abortAll()` 메서드
  - 진행 중인 모든 mission의 status → `abandoned`
  - 연결된 agent PTY 세션 정지 (`agent-manager.ts:kill_agent` 활용)
  - orchestrator PTY에 abort 신호 주입 (`[SYSTEM] All missions aborted by user`)
  - 진행 중인 `run_skill` 호출 cancel

**UX:**

- Mission Detail 페이지 + 글로벌 header 양쪽에 abort 진입점
- 확인 dialog (방어): "정말 모든 mission을 중지할까요? 진행 중인 작업은 손실됩니다."
- 단축키 누르면 dialog 없이 즉시 (긴급 상황 가정)

### A5. API key 종류 감지 + 조건부 M2/M3 🔴 P0

**파일:**

- `v3/src/components/onboarding/ApiKeySetup.tsx` (신규 또는 기존 onboarding 확장)
- `v3/electron/agent-config.ts` — API key 종류 메타데이터 저장
- `v3/electron/mission-engine/cost-policy.ts` (신규)

**감지 로직:**

옵션 a (단순): 사용자에게 직접 묻기

```
[Onboarding step]
"Anthropic API key를 어떻게 사용하시나요?"
  ◯ Claude Max 구독 (사용량 무제한, 추천)
  ◯ 사용량 기반 API key (Anthropic 콘솔에서 발급)
  ◯ 모름 / 둘 다 가능
```

옵션 b (자동, v3.1): Anthropic API의 light call로 plan 정보 추출 시도. 실패 시 옵션 a로 fallback.

**조건부 메커니즘:**

```ts
// v3/electron/mission-engine/cost-policy.ts
export interface CostPolicy {
  mode: "subscription" | "usage-based";
  tokenCapPerMission?: number; // mode='usage-based'일 때만
  showCostPreview: boolean;
}

export function getCostPolicy(
  userSubscription: SubscriptionPlan,
  apiKeyMode: "subscription" | "usage-based"
): CostPolicy {
  if (apiKeyMode === "subscription") {
    return { mode: "subscription", showCostPreview: false };
  }
  const cap = {
    [SubscriptionPlan.FREE]: 50_000,
    [SubscriptionPlan.PRO]: 200_000,
    [SubscriptionPlan.TEAM]: 500_000,
    [SubscriptionPlan.TEAM_PLUS]: 1_000_000,
    [SubscriptionPlan.ENTERPRISE]: 5_000_000,
  }[userSubscription];
  return {
    mode: "usage-based",
    tokenCapPerMission: cap,
    showCostPreview: true,
  };
}
```

**M3 cost preview UI** (`MissionLaunchDialog.tsx`에 통합):

- 정액제: `"정액제 모드 — 추가 비용 없음"` 배지 표시
- 사용량 기반: `"예상 비용: $3-15 (Full Feature 기준, 정확도는 ±50%)"`

**M2 token cap enforcement** (`mission-engine/step-executor.ts`):

- 각 step 시작 전 누적 token 합계 확인
- cap 초과 → mission status=abandoned, contextLog에 "Token cap exceeded ({used}/{cap})" 기록
- 사용자에게 알림 + 다시 시작 가이드

### A6. 정액제 모델별 정책 검증 🟡 P1 (research ticket)

**작업:** 다음 사실을 web으로 정확 검증 (web search / 공식 문서 fetch)

| 모델   | 검증 대상                                                                                 |
| ------ | ----------------------------------------------------------------------------------------- |
| Claude | Claude Max 5x ($100) / 20x ($200)이 Claude Code 사용을 무제한 포함하는가? 주간/월간 한도? |
| OpenAI | OpenAI Pro ($200)가 Codex CLI를 사용량 한도 없이 포함하는가? ChatGPT Plus ($20)는 어떻게? |
| Gemini | Google One AI Premium ($19.99)이 Gemini CLI 무제한인가, 무료 한도만 포함?                 |

**산출물:** `v3/docs/MODEL-SUBSCRIPTION-POLICIES.md` (또는 marblo-web/messages에 정확 정보 반영). 정책이 바뀔 수 있으므로 last-verified 날짜 명기.

**중요:** 마케팅에 부정확 정보 노출 시 클레임 위험. A2/A3 적용 전 이 검증 선행 권고.

### A7. Orchestrator skill 룰 추가 🟡 P1

**파일:** `v3/skills/orchestrator_agent.md`

기존 4개 룰에 신규 5번 룰 추가:

```markdown
### 5. 비용 정책 룰 (NEW in v3.x)

- 사용자 첫 설정 시 `agent-config`의 API key 모드 확인
  - `mode === 'subscription'`: cap/preview 적용 안 함. Mission 자율 진행 자유
  - `mode === 'usage-based'`: Mission 단위 token cap 적용 (plan별 다름)
- 정액제 권장 메시지 표시 (사용량 기반 사용자에게 첫 Mission Launch 시):
  - "Claude Code는 Claude Max 구독에 무제한 포함됩니다. 사용량 기반 청구가 부담스러우시면 검토하세요."
- Orchestrator 자신은 Claude Code (Claude Max 권장) 전제. 사용자 API key 종류와 별개로 마블로가 권장 모델 안내.
- Mission 도중 token cap 도달 → mission status=abandoned, 사용자에게 알림. 자동 retry 금지 (cap 우회 방지).
```

## 6. 검증 케이스

다른 에이전트가 구현 후 반드시 확인:

- [ ] **A1 sync:** v3 코드 PAYMENT_PLANS와 marblo-web MONTHLY_PRICES + ko.json features가 100% 일치 (자동 비교 script 추가 권고)
- [ ] **A1 마이그레이션:** 기존 `subscription.plan = 'basic'` 레코드가 있다면 처리 정책 명확 (예: `pro`로 자동 업그레이드 + 안내 이메일)
- [ ] **A2 마케팅:** ko/ja/en 모두 "Flow 에디터" 표현 사라짐 or Mission으로 진화 명시
- [ ] **A3 BYOK:** Pro 결제 흐름에서 사용자가 "API key 어디 넣어요?"라는 질문을 안 함 (UI에서 명시되어야 함)
- [ ] **A4 Abort:** Cmd+Shift+. 키 1초 안에 모든 mission 정지. 진행 중 agent의 PTY 즉시 kill
- [ ] **A4 Abort UX:** Mission Detail에 항상 visible한 abort 버튼. 글로벌 header에도 진입점
- [ ] **A5 정액제 사용자:** Full Feature Mission 실행 시 cost preview 표시 안 됨, cap 무시
- [ ] **A5 사용량 사용자:** Free plan 사용자가 큰 Mission 시작 시 cap (50K) 도달하면 자동 abort + 안내
- [ ] **A5 onboarding:** 신규 사용자가 첫 진입 시 API key 모드 선택 단계 거침
- [ ] **A7 orchestrator:** 정액제 권장 메시지가 사용량 기반 사용자에게만 표시
- [ ] **A7 cap:** 사용량 기반 사용자가 cap 도달했을 때 orchestrator가 자동 retry 안 함

## 7. 우선순위 + 단계

| 단계               | 시기          | 포함                                                                |
| ------------------ | ------------- | ------------------------------------------------------------------- |
| **Phase 0 (즉시)** | 1-2일         | A1 (가격 sync) — 결제 흐름 정상화 필수                              |
| **Phase 1**        | 5월 말        | A2 (마케팅) + A3 (BYOK 명시) + A4 (Abort) — 출시 준비               |
| **Phase 2**        | 6월 중순      | A5 (조건부 M2/M3) + A6 (정액제 검증) — 안전망 완성                  |
| **Phase 3**        | 6월 말 (런칭) | A7 (orchestrator 룰) — Mission spec(`MISSIONS-SPEC.md`)과 동기 출시 |

**`MISSIONS-SPEC.md`와의 관계:**

- A4 (Abort) — Mission Engine 구현 (`MISSIONS-SPEC.md` §7) 직후 의존
- A5 (cost policy) — `run_skill` MCP 도구 (`MISSIONS-SPEC.md` §8) 위에서 작동
- A7 (orchestrator 룰) — Mission skill 룰과 동시 작성

→ Mission spec을 받은 에이전트와 이 spec을 받은 에이전트가 같으면 효율적. 다르면 Phase 동기 조율 필요.

## 8. 미결 사항 (구현 시점 결정)

| ID  | 결정 사항                                                                                              | 영향                           |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| D22 | 기존 `subscription.plan = 'basic'` 실 사용자 처리 — 자동 Pro 업그레이드? 그대로 freeze?                | 마이그레이션 비용, 사용자 통신 |
| D23 | Token cap 정확 값 — Free 50K/Pro 200K가 적절한가? 실 데이터 (Mission 평균 토큰) 측정 후 조정           | 사용자 불만 vs 신뢰성          |
| D24 | M3 cost preview 정확도 표시 방법 — 단일 값 ($10) vs 범위 ($3-15) vs 단순 카테고리 (Light/Medium/Heavy) | 사용자 신뢰                    |
| D25 | API key 모드 감지 — 사용자 직접 선택만 (옵션 a) vs Anthropic API 자동 호출 (옵션 b)                    | 정확성 vs 구현 비용            |
| D26 | `enterprise` plan 가격 미정 — "Contact us"만 표시? 견적 폼 별도?                                       | Enterprise 영업 흐름           |

## 9. 부록 A — 강의 메시지 hook

**압도적 ROI 메시지 (랜딩 hero 또는 lectures 페이지):**

- "Cursor $20 = 에이전트 1명"
- "마블로 Pro 19,000원 + Claude Max $100 = 에이전트 5명 동시 + 무제한 사용"
- → 가격대비 약 5-10배 가치

**Claude Max 권장 — 계산 예시:**

- Claude Max 5x ($100/월) = 약 14만 원
- 마블로 Pro = 19,000원
- 합계: 약 16만 원/월
- 비교: Cursor Team ($40/명/월 × 3명) = $120 = 약 16만 원
- → 같은 비용으로 **혼자서 팀처럼** (랜딩 hero 메시지와 정합)

## 10. 부록 B — NOT in scope

- **마블로 호스트 LLM** — BYOK 일관성 유지. 호스트 LLM 옵션은 v3.1에서 enterprise tier로 검토.
- **API key 잔액/사용량 자동 모니터링** — Anthropic Admin API 연동은 v3.1+
- **팀별 cost dashboard** — Team plan 사용자의 팀 단위 비용 추적은 v3.1
- **사용량 기반 plan** (예: per Mission 과금) — 현재는 구독 모델만. 사용량 모델은 v3.2+
- **연간 결제 할인 차등화** — 현재 일률 ×10(2개월 무료). Tier별 차등은 v3.1+

## 11. 다음 단계 (받는 에이전트에게)

1. 이 spec 정독 (`MISSIONS-SPEC.md`도 함께 — A4/A5/A7이 의존)
2. TaskForce MCP `create_tasks_bulk`로 A1~A7 ticket 7개 생성
3. 각 ticket의 `complexity` / `tags` / 의존성 (`depends_on`) 명확히
4. Phase 0 (A1) 즉시 착수 — 결제 흐름이 깨진 상태로 출시 X
5. Phase 1~3는 `MISSIONS-SPEC.md`와 동기 조율
6. 구현 중 D22~D26 결정 사항 만나면 사용자에게 AskUserQuestion으로 확인

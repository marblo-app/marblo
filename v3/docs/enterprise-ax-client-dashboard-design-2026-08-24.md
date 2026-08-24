# 기업 AX — 고객사가 보는 감사·비용 대시보드 설계

작성 2026-08-24 · 티켓 `12S93hQxd4LhBmzsh36n` · **설계 문서 하나. 구현 없음.**
포지셔닝 정본 [`v3/docs/CONTROL-PLANE.md`] 의 §3-① provenance 번들을 **상업화**하는 문서다. 피벗이 아니다.

---

## 0. 한 문단 요약 — 이 문서가 뒤집는 것

사장님 구상은 "마블로웹 아래에 클라이언트별 하위 대시보드를 **만들까**" 였다.
**전수 조사 결과 그 화면은 이미 있다.** `marblo-web/src/app/[locale]/team/` 이 사용량 탭과 감사 탭을
갖춘 고객용 대시보드이고, 서버는 `getTeamUsageSummary`(1,811줄) · `getTeamProjectAudit`(1,415줄)
콜러블 두 개다. 행 수준 테넌트 격리·4역할 RBAC·초대·크로스테넌트 권한상승 차단도 1,081줄짜리
`firestore.rules` 에 이미 굳어 있다.

그래서 이 문서의 결론은 "무엇을 지을까" 가 아니라 **"이미 지은 것을 기업 화면으로 승격시키는 데
무엇이 빠졌나"** 다. 빠진 것은 넷이고, 그중 셋은 싸고 하나는 진짜 비싸다.

| # | 빠진 것 | 비용 | 되돌리기 |
| --- | --- | --- | --- |
| ① | 조직(org) 축 — 프로젝트 **위**의 그룹, 좌석 과금 | 큼 | **어렵다 ★** |
| ② | 오케스트레이터 지출 미수집(지출의 29%) + 추정치 라벨 | 중 | 쉽다 |
| ③ | 데스크톱 렌더러의 `params` 원문 덤프 1곳 | 작음 | 쉽다 |
| ④ | 원장 보존기간·삭제권 — 문장도 배선도 없다 | 중 | **어렵다 ★** |

★순서 결론: **①을 먼저 짓지 않는다.** 오케 의견에 동의하되 근거가 다르다 — "상상의 고객을 위해
비싼 걸 짓는다" 가 아니라, **비싼 것의 대부분이 이미 지어져 있어서 최소판이 싸다.**

---

## 1. 가치 제안 — 한 줄

> **마블로는 "누가 무엇을 시켰고 얼마가 들었는지" 를 증명한다.**
> 대시보드는 그 증명서를 읽는 창이지, 제품이 아니다.

기업이 돈을 내는 이유는 화면이 예뻐서가 아니다. AI 에이전트가 사내 저장소를 고치기 시작하면
감사팀·보안팀·재무팀이 동시에 같은 질문을 한다 — **"이거 누가 시켰고 얼마 썼어?"** 오늘 대부분의
AI 코딩 도구는 이 질문에 답할 원장이 없다. 마블로는 **불변 감사 원장(`audit_logs` + 해시 체인 +
머클 체크포인트)** 을 이미 갖고 있다. 이건 뒤늦게 붙일 수 없는 자산이다 — 원장은 소급 생성이
불가능하고, 오늘부터 쌓기 시작한 회사가 2년 뒤 우리를 따라잡을 수 없다.

CONTROL-PLANE.md 와의 연결:

| CONTROL-PLANE.md | 이 문서 |
| --- | --- |
| §2.2 moat = provenance 감사추적 | 그 추적을 **고객사에게 판다** |
| §3-① 작업당 provenance 번들 | 번들을 조직 단위로 접어 보여준다 |
| §5.3 "trust 가 control plane 의 통화" | 기업 계약이 그 통화의 **환금 창구** |
| §8.2 61–90일 유료화 ($50–100/월 팀) | 기업은 다른 가격대 — 좌석이 아니라 **증명**에 값이 붙는다 |

즉 이 구상은 새 방향이 아니라 **§2.2 가 말한 해자를 처음으로 청구서로 바꾸는 일**이다.

---

## 2. 어드민 화면과 무엇이 다른가 (티켓 `X2piUBsQT6yPV4BHeBRP` 와의 경계)

두 화면은 데이터 소스가 겹치지만 **축이 다르고, 섞으면 다시는 못 푼다.**
이 경계는 이미 코드에 못박혀 있다 — `teamAudit.ts` 헤더:

> `requireAdmin`(단일 `ADMIN_UID` 대조 = 마블로 사장님 축)을 재사용하지 않는다. 팀 오너는
> **다른 축**이고, 한번 섞으면 "이 사람이 왜 이걸 보나" 를 두 번 다시 풀 수 없다.

| | 어드민(`/admin`, `X2piUBsQT6yPV4BHeBRP`) | **고객 대시보드(`/team`, 이 티켓)** |
| --- | --- | --- |
| 보는 사람 | 우리(마블로 운영자) | 고객사 조직 관리자 |
| 권한 축 | `isPlatformAdmin()` / `ADMIN_UID` | `isProjectOwner` / `isAdminOrOwner` / `isProjectMember` |
| 스코프 | **전 테넌트 횡단** | **자기 테넌트 안** — 남의 존재조차 모른다 |
| 질문 | "우리 사업이 되고 있나" (설치·리텐션·CAC·결제) | "우리 조직이 무엇을 시켰고 얼마 썼나" |
| 데이터 | 익명축(`analytics_*`, GA4) 중심 | **계정축**(`cost_logs`, `audit_logs`) 중심 |
| 판정 위치 | `functions/src/adminAnalytics.ts` · `betaSegments.ts` | `functions/src/teamUsage.ts` · `teamAudit.ts` |

★**두 화면이 같은 컴포넌트를 공유하면 안 된다.** `/admin/ProjectAuditPanel.tsx` 는 플랫폼 admin
게이트 뒤에 있어서 안전한 것이지, 컴포넌트 자체가 안전한 게 아니다. 고객 화면이 이걸 재사용하면
게이트만 다르고 노출 필드는 같아진다.

중복 티켓 확인:
- `FFrgruR7qUYANYvL9ETt`(GitHub App 자동상속) — **인바운드 연동**. 이 문서는 소비 화면. 겹치지 않는다.
  단 GitHub App 이 `merge/deploy` 이벤트를 원장에 넣으면 이 대시보드의 `kind: "deploy"` 칸이 채워진다 → **의존이 아니라 보강**.
- `Xxqyj8TSLA4OFFlS0A0S`(마블로비서 탭) — 데스크톱 앱 안. 이건 웹. 겹치지 않는다.

---

## 3. 현황 전수 — 있는 것 / 없는 것 (파일·함수 근거)

### 3.1 ★이미 있는 것 (추측 아님)

| 자산 | 근거 | 상태 |
| --- | --- | --- |
| 불변 감사 원장 | `electron/mcp-server/ledger.ts` `LedgerEvent` (432줄) | ✅ 가동 |
| 해시 체인 | `ledger-chain.ts` `computeEventHash`/`ChainFields` | ✅ 가동 |
| 머클 체크포인트 | `electron/ledger-checkpointer.ts` + `ledger_checkpoints` 컬렉션 | ✅ 가동 |
| 유실 가시성 tombstone | `ledger-spool.ts:577,837` (`projectId=""` 마커) | ✅ 가동 |
| 원장 read 테넌트 게이트 | `firestore.rules:89` `canReadLedgerDoc()` | ✅ 가동 |
| 프로젝트 스코프 공통 게이트 | `firestore.rules:108` `canReadProjectScopedDoc()` (티켓 `Ciriq5ASEvAlA8TnKxhW`) | ✅ 가동 |
| 4역할 RBAC | `v3/src/types/invitation.ts` `ROLE_PERMISSIONS` (owner/admin/member/viewer) | ✅ 가동 |
| 초대 + self-join | `firestore.rules` `hasValidPendingInvite`/`isInvitedSelfJoin` · `invitations` 컬렉션 | ✅ 가동 |
| 권한상승 차단(필드 allowlist) | `firestore.rules` `projectMemberWritableFields()` (티켓 `wWl44fSBwmQ4vRylmHsF`) | ✅ 가동 |
| 권한상승 차단(docId 결속) | `firestore.rules:762` `memberRoleDocIdMatches` | ✅ 가동 |
| **고객용 대시보드 라우트** | `marblo-web/src/app/[locale]/team/` (page/[projectId]/TeamOverviewClient) | ✅ 배포됨 |
| **사용량 탭 서버** | `functions/src/teamUsage.ts` (1,811줄) + `getTeamUsageSummary` | ✅ 배포됨 · **게이트 닫힘** |
| **감사 탭 서버** | `functions/src/teamAudit.ts` (1,415줄) + `getTeamProjectAudit` | ✅ 배포됨 |
| 화면 전용 가명 공간 | `analyticsPseudonym.ts` kind `teamMember` (`tm_`) | ✅ 가동 |
| 비용 정본 축 판정 | `v3/docs/COST-AXIS-RECONCILIATION-2026-08-08.md` §3 | ✅ 문서화 |
| 원장 조회 인덱스 6종 | `firestore.indexes.json` — `(projectId, actorUid, toolName, createdAt)` 등 | ✅ 배포됨 |

**즉 "클라이언트별 하위 대시보드" 의 v0 는 이미 살아 있다.** 사용량 탭만 `TEAM_USAGE_EFFECTIVE_FROM`
게이트가 닫혀 있어(어느 배포 설정에도 이 키가 없다) 사유 문장 하나만 그려진다.

### 3.2 ★진짜 없는 것

| 없는 것 | 전수 근거 |
| --- | --- |
| **조직(org) 축** | `orgId`/`tenantId`/`organizationId` 전수 grep = **6건, 전부 `marblo-web/src/lib/schema.ts` 의 SEO JSON-LD `ORG_ID`**. 도메인 개념 0건. |
| **조직 단위 과금** | `v3/src/types/subscription.ts` `Subscription.userId` — 개인 uid 축. `PlanType` 에 `"enterprise"` 문자열은 있으나 좌석·조직 원장이 없다. |
| **원장 보존기간** | `firestore.indexes.json` 에 TTL 정책 0건. `privacyContent.tsx:157` 이 보존기간을 고지하는 항목은 비식별지표/사용량비용/학습데이터/Sentry/GA4 다섯이고 **`audit_logs` 는 그 목록에 없다.** |
| **삭제권 이행 배선** | 코드 전수에 `deleteAccount`/erasure 경로 0건. `privacyContent.tsx:166` = "team@marblo.app 으로 요청" **수동 메일 처리**. |
| **SSO / SCIM** | 없음. Firebase Auth 소셜·이메일만. |
| **오케스트레이터 지출 수집** | `teamUsage.ts:356` `orchestratorAxis.state = "not_collected"` — 2026-06-22 이후 한 행도 안 잡힌다. 2026-06 실측 전체 지출의 **29%**. |
| **`kind:"deploy"` 이벤트 생산자** | `LedgerEventKind` 에 자리는 있으나 머지/배포가 `gh` CLI(앱 밖) — CONTROL-PLANE.md §4 가 이미 식별한 갭. |
| **실행 맥락 env 주입** | `ledger.ts:338` `LEDGER_ENV` 3키(`MARBLO_AGENT_MODEL`/`_TIER`/`_INSTRUCTION_HASH`) — **읽는 쪽만 있고 주입 쪽이 없다.** 전수 grep 결과 생산자 0건 → `model`/`tier`/`instructionHash` 가 항상 null. |

---

## 4. ★질문 ① — 테넌트 축이 번지는 범위 (전수)

### 4.1 먼저: 오늘의 테넌트는 `projectId` 다

브리핑의 "테넌트 축이 없다" 는 **절반만 맞다.** 없는 것은 *조직*이고, **테넌트 경계 자체는 이미
`projectId` 로 그어져 있으며 이미 공격 표면 검토까지 끝났다.** 이건 이 구상의 비용 추정을 통째로
바꾸는 사실이다.

```
오늘:   users ──┬── projects ──── tasks / audit_logs / cost_logs / merge_history …
                └── memberRoles(projectId_userId) · invitations(projectId_email)
        격리 = firestore.rules 의 isProjectMember(projectId)  ← 1,081줄이 이걸 강제

기업이 원하는 것:
        organizations ──┬── projects ── (이하 동일)
                        ├── members(역할)
                        └── subscription(좌석)
```

### 4.2 org 축이 번지는 곳 — 전수

| 층 | 무엇이 바뀌나 | 난이도 | 되돌리기 |
| --- | --- | --- | --- |
| **데이터 모델** | `organizations/{orgId}` 신설 · `projects.orgId` 추가 · `orgMembers/{orgId}_{uid}` | 중 | **★어렵다 — 백필과 동시에 룰이 갈린다** |
| **Firestore 룰** | `isProjectMember` 를 `isProjectMember ∪ isOrgMember` 로 넓힘. ★넓히는 순간 **12개 컬렉션의 read 게이트가 동시에 바뀐다**(`tasks`/`activities`/`agents`/`audit_logs`/`cost_logs`/`merge_history`/`telemetry_events`/`missions`/`flows`/`chatMessages`/`workChains`/`taskComments`) | 큼 | **★어렵다 — 잘못 넓히면 크로스테넌트, 좁히면 기존 사용자 락아웃** |
| **BQ 뷰** | `cost_logs` 에 `orgId` 컬럼이 없다. 조인 경로 = `cost_logs.projectId → Firestore projects.orgId`. **BQ 안에서 완결 안 된다** → 매핑표를 BQ 로 내리거나(신규 적재) 함수가 Firestore 에서 읽어 필터(오늘 방식) | 중 | 쉽다(뷰는 재생성 가능) |
| **웹 라우트** | `/team` → `/org/[orgId]` 또는 `/team?org=`. ★`team/page.tsx` 는 **프로젝트 선택을 화면이 안 한다**(서버가 uid 로 권한집합 도출) — 같은 규약을 org 로 확장하면 라우트 변경 없이도 가능 | 작음 | 쉽다 |
| **초대** | 오늘 초대는 `{projectId}_{email}` 결정적 id. org 초대는 `{orgId}_{email}` 새 규약 + "org 가입 시 어느 프로젝트에 자동 참여하나" 정책 필요 | 중 | 중간 |
| **과금** | `Subscription.userId` → `orgId` + 좌석 수. ★**PG 3사(paddle/toss/portone) 전부 개인 결제 흐름**. 좌석 증감 프로레이션·인보이스·PO 발행은 전혀 없다 | **큼** | **★어렵다 — 결제 원장은 소급 재구성 불가** |
| **감사 뷰** | `teamAudit.scopeForRole` 에 `org_admin` 역할 추가. ★org admin 이 **가입 전 프로젝트 이력**까지 보는가? 이건 제품 결정이지 기술 결정이 아니다 | 중 | 중간 |
| **가명 공간** | `teamMember`(`tm_`) 가명은 프로젝트 축 전용. org 축 화면이 프로젝트를 넘나들면 **같은 사람이 프로젝트마다 다른 가명**이 된다 → org 스코프 가명 kind 신설 필요(`analyticsPseudonym.ts` 목록에 추가) | 작음 | 중간 |

### 4.3 ★되돌리기 어려운 결정 셋 (여기서만 신중하면 된다)

1. **`orgId` 를 `projectId` 위에 두는가, 옆에 두는가.**
   위(소유)면 프로젝트는 항상 org 에 속하고 개인 사용자도 "1인 org" 가 된다 — 룰이 단순해지지만
   **기존 전 사용자 백필**이 필요하다. 옆(선택)이면 `orgId` 가 nullable 이고 룰이 두 갈래로 영원히
   갈린다. **권고: 위. 단 org 를 만드는 시점에.** 오늘 백필하면 3명을 위해 1,081줄을 흔든다.

2. **좌석 과금인가 사용량 과금인가.**
   좌석은 우리 원장이 답할 수 없다 — `teamUsage.ts:3` 이 이미 못박았다: *"좌석(seat) 개념이 코드에
   존재하지 않아 '누구 몫으로 청구되나' 를 답할 원장이 없다."* 사용량 과금은 원장이 이미 답한다.
   **권고: 기업은 사용량+플랫폼 정액. 우리 데이터가 실제로 증명할 수 있는 축이 그쪽이다.**

3. **org admin 의 열람 범위.**
   `teamAudit.ts` 가 그은 선(*"공유 산출물에 일어난 사건은 보여준다. 그 사람이 무슨 명령을 쳤는지는
   안 보여준다"*)을 org 축에서도 유지하는가. **권고: 유지.** 기업 고객이 "전부 보여달라" 고 해도
   그 선을 파는 순간 우리는 감시 도구가 되고, 그건 §5.3 의 trust 통화를 태우는 일이다. 대신
   **고객사 스스로가 자기 직원에게 고지·동의를 받는 구조**로 넘긴다(§7.4).

---

## 5. ★질문 ② — "클라이언트별 비용" 을 어떻게 계산하나

### 5.1 먼저 브리핑 정정 — 조인은 필요 없다

브리핑: *"cost_logs 는 clientId, task_outcomes 는 userId 라 조인이 안 되고 taskId 만 다리다."*

**두 곳이 틀렸다.**

1. **방향이 반대다.** `index.ts:7405` `const userId = context.auth.uid` → `cost_logs.userId` =
   **Firebase 계정 uid**. `index.ts:7615` `userId: d.clientId || "anon"` → `task_outcomes.userId` =
   **익명 설치 clientId**. 실측 교집합 0행(`COST-AXIS-RECONCILIATION` §1 — 그 문서는 당시 행번호
   6625/6832 로 인용했고 파일이 이동했다. 2026-08-24 재확인한 행번호가 위 값이다).
2. **`taskId` 다리는 지금 일부러 끊겨 있고, 동시에 필요도 없다.**
   끊긴 이유: `analyticsPseudonym.ts`(티켓 `U5OPOKf0D3I2TSRP8yUq`)가 익명축의 `taskId`/`agentId`/
   `projectId` 를 **HMAC 가명**으로 적는다. 솔트는 BQ 에 없다. 이건 배포된 처리방침
   (`privacyContent.tsx:127` "두 기록이 공유하는 조인 키는 없습니다")의 근거라 **되살리면 안 된다.**
   필요 없는 이유: **`cost_logs` 는 계정축이라 `projectId`·`userId`·`taskId` 를 원시값으로 갖고 있다.**
   클라이언트별 비용은 계정축 안에서 완결된다.

### 5.2 정본 계산식 (이미 판정돼 있다)

`COST-AXIS-RECONCILIATION-2026-08-08.md` §3 정본 판정:

> **태스크 원가의 정본 축은 `cost_logs` 를 `taskId` 로 SUM 한 값이다** (D1·D2 중복제거 뷰 적용).

조직별로 접으면:

```sql
-- 클라이언트(=조직)별 비용. 오늘은 orgId 가 없으므로 projectId 집합으로 대신한다.
WITH clean AS ( /* COST-AXIS-RECONCILIATION §3 의 정본 중복제거 뷰 (l1/l2, rn1=1 AND rn2=1) */ )
SELECT projectId,
       COUNT(DISTINCT taskId)                       AS tasks,
       ROUND(SUM(totalCost), 2)                     AS est_cost_usd,
       ROUND(SUM(IF(taskId IS NULL, totalCost, 0)),2) AS unattributed_usd  -- ★따로 보여준다
FROM clean
WHERE projectId IN UNNEST(@projectIdsOfOrg)          -- Firestore projects.orgId 에서 도출
  AND timestamp BETWEEN @from AND @to
GROUP BY projectId;
```

### 5.3 브리핑의 "오늘은 계산 불가" 판정을 정정한다

| 브리핑 주장 | 실측 |
| --- | --- |
| "15초 폴 델타지 턴이 아니다" | **맞다.** 그러나 턴 단위일 필요가 없다 — 청구 단위는 태스크·기간이지 턴이 아니다. |
| "중복 때문에 못 쓴다" | **수리됐다.** D2(세션파일 재읽기)는 `cost-tracker.ts` 워터마크 영속화(`~/.marblo/cost-watermarks.json`)로 원인 수리 + 회귀 테스트(`tests/unit/cost-tracker-watermark.test.ts`). D1(팬아웃)은 2026-06-18 소멸 + 방어 가드. |
| "그래서 계산 불가" | **가능하다.** 실측: `taskId` 가 붙은 행의 중복 초과율 **0.0%**, 765 태스크 중 중복제거로 값이 바뀐 태스크 **0개**, `task_outcomes` 와 96.5% 가 소수점까지 일치. |

**결론: 오늘 계산 가능하다.** 단 아래 셋을 화면이 반드시 말해야 한다.

### 5.4 ★화면이 반드시 말해야 하는 단서 셋

이건 장식이 아니라 **기업에 보여주는 숫자의 법적 성격**을 정하는 문장들이다.

1. **"청구액이 아니라 사용량 환산 추정치(list price)" 라고 라벨한다.**
   근거: `~/.marblo/subscription-plans.json` 이 없으면 `findPricing` 이 per-token 경로를 탄다.
   우리는 구독으로 돌리므로 이 숫자는 실제 현금이 아니라 **"API 로 똑같이 돌렸다면" 의 기회비용**이다.
   ★`teamUsage.ts:197–217` 에 이미 이 어휘가 있다 — `cost_estimated_usage` / `cost_not_billing` 노트 코드와
   라벨 *'사용량 환산 비용(추정)'*. **새 낱말을 만들지 말고 이걸 쓴다.**

2. **캐시 단가는 파생 근사다.** `computeIncrementalCost` 가 cache-read = 0.1×input,
   cache-write = 1.25×input(Anthropic 비율)로 근사한다. 캐시 리드가 토큰의 90%+ 이므로
   **비용의 대부분이 이 근사 위에 선다.** 벤더별 실단가를 쓰면 값이 움직인다.

3. **★오케스트레이터 지출이 안 잡힌다 — `0` 이 아니라 `미수집`으로 그린다.**
   `teamUsage.ts:14–26` 이 이 구분을 명령한다: *"오케 칸을 `0` 으로 그리면 오너가 '오케는 공짜' 로
   읽는다. 2026-06 실측으로는 전체 지출의 **29%** 였고, 2026-06-22 이후로 한 행도 안 잡힌다."*
   ★**기업 화면에서 지출의 29%가 비는 것은 출시 차단 사유다.** 이게 §9 의 PR-3 이다.

### 5.5 실측치로 바꾸려면 (선택지 셋, 비용순)

| 안 | 무엇 | 비용 | 얻는 것 |
| --- | --- | --- | --- |
| A. 추정치 유지 + 라벨 | 오늘 그대로 + §5.4 문장 셋 | **0** | 정직한 추정치. 대부분의 기업이 여기서 만족한다(원가 비교 목적) |
| B. 플랜 단가 주입 | `subscription-plans.json` 을 고객사 구독 정보로 채움 | 소 | "우리 계약 단가 기준" 환산 |
| C. **BYOK 실청구 대조** | 고객사 벤더 키의 실제 usage API 를 당겨 대조 | 중~대 | **실측치.** 단 벤더별 API·지연·권한이 전부 다름 |

**권고: A 로 출시하고, C 를 유료 상위 기능으로 남긴다.** "추정치인데 왜 돈 내냐" 는 반론에는
답이 있다 — 기업이 사는 것은 **금액의 정확도가 아니라 귀속(누구의·어느 티켓의 지출인가)** 이고,
귀속은 이미 실측이다(taskId 초과율 0.0%).

---

## 6. ★질문 ③ — `params` 비노출 규율을 고객사 화면에서 어떻게 지키나

### 6.1 서버 경계에서는 이미 지켜지고 있다 — 기계가 강제한다

`v3/src/types/audit.ts` 의 경고(*"툴 인자에는 지시문·경로·티켓 본문이 그대로 들어오고 거기
자격증명이 섞일 수 있는데, 원장은 불변이라 한번 들어간 것은 못 지운다"*)는 이미 **세 겹**으로
집행되고 있다:

| 겹 | 무엇 | 위치 |
| --- | --- | --- |
| 1 | **허용목록** — `PROJECT_EVENT_TOOLS` 9개 밖의 툴은 응답에 안 실린다. 차단목록이 아니라 허용목록이라 **새 툴은 기본 차단** | `teamAudit.ts:91` |
| 2 | **자유텍스트 필드 부재** — `TeamAuditEvent` 에 `text`/`message`/`instruction`/`result` **자리가 아예 없다.** null 로 두지 않은 이유: *"자리가 있으면 언젠가 누가 채운다"* | `teamAudit.ts:26` |
| 3 | **금액·토큰 부재** — 감사 탭은 게이트 밖이라, 돈을 실으면 `TEAM_USAGE_EFFECTIVE_FROM` 게이트가 감사 탭 경유로 우회된다 | `teamAudit.ts:32` |

`projectAudit.ts:18` 도 같은 규율: *"`audit_logs.params` 는 **절대** 응답에 넣지 않는다."*
`teamAudit.ts:1374` 에는 응답 문자열에 `params`/`actorUid`/`tm_` 등이 새는지 잡는 **정규식 가드**까지 있다.

### 6.2 ★그래도 남은 구멍 하나 — 데스크톱 렌더러

```
v3/src/components/agents/AuditTimeline.tsx:137
    {JSON.stringify(log.params, null, 2)}      ← 원문 그대로 그린다
```

오늘은 데스크톱 앱이고 보는 사람이 프로젝트 멤버라 위험이 제한적이다. **그러나 이 티켓이 하려는
일은 정확히 "이 화면을 고객사에 연다" 이다.** 고객사 화면이 이 컴포넌트를 재사용하면 세 겹의
규율이 한 줄로 무너진다.

**규율(신규):**
> **`audit_logs.params` 를 읽는 코드는 `v3/src/`(데스크톱 렌더러) 안에만 존재한다.
> `marblo-web/` 과 `functions/` 에서는 `params` 라는 낱말이 응답 경로에 등장하는 것 자체를 금지한다.**

집행은 이미 있는 패턴을 그대로 쓴다 — `tests/unit/team-usage-axis-guard.test.ts` 가 하는
**소스 스캔 가드**. 축 이름이 소스에 등장하는 것 자체를 실패로 잡는 방식이다.

### 6.3 그리고 `params` 는 애초에 원장에 덜 담아야 한다

`projectAuditView.ts` 를 보면 렌더러가 `params` 에서 뽑는 것은 사실 **좁다** —
`status`/`from`/`to`(상태 전이), `message`, `summary.{problem,approach,changes,verification}`.
즉 필요한 건 **파생 필드 몇 개**지 원문 전체가 아니다.

**권고(신규 원장 행에 한함):**
- 쓰기 시점에 `paramsDigest`(허용목록 키만 남긴 얕은 요약) + `paramsHash` 를 만들어 저장한다.
- 원문 `params` 는 **저장하지 않는다.**
- 근거는 이미 원장이 지시문에 대해 하고 있는 것과 **똑같다** — `hashInstruction`:
  *"원문을 복제하면 지시문에 섞인 비밀·고객 데이터까지 불변 컬렉션에 영구 박제된다. 불변성은
  잘못 넣은 것도 못 지운다는 뜻이므로 감사 원장에는 오히려 적게 담아야 한다."*
  **`instruction` 에 적용한 이 판단을 `params` 에 적용하지 않은 것이 오늘의 비대칭이다.**

★단 §7.3 의 절단선을 반드시 읽어라 — **이건 신규 행에만 가능하다.**

---

## 7. ★질문 ④ — 불변 원장 vs 삭제권 (진짜 긴장)

### 7.1 오늘의 상태 — 문장도 배선도 없다

| | 상태 |
| --- | --- |
| `audit_logs` delete | `firestore.rules:608` `allow delete: if false` — **영구** |
| `ledger_checkpoints` delete/update | 둘 다 `if false` — 봉인 |
| TTL 정책 | `firestore.indexes.json` 에 0건 |
| 처리방침의 원장 보존기간 | **문장이 없다.** `privacyContent.tsx:157` 은 비식별지표/사용량비용/학습데이터/Sentry/GA4 다섯만 다룬다 |
| 삭제 요구 이행 | 코드 0건. `privacyContent.tsx:166` = team@marblo.app **수동 메일** |

**즉 오늘 마블로는 "무기한 보관하는 삭제 불가 원장" 을 운영하면서 그 사실을 고지하지 않는다.**
개인 사용자 3명 규모에서는 잠복하지만, 기업 계약서에 DPA 가 붙는 순간 첫 페이지 질문이 된다.

### 7.2 가짜 긴장과 진짜 긴장을 가른다

**가짜 긴장:** "불변이니까 삭제권을 못 지킨다."
불변성이 지키는 것은 *행이 사라지지 않는 것*이 아니라 **"지워진 사실을 숨길 수 없는 것"** 이다.
이 프로젝트는 이미 그 구분을 코드로 갖고 있다 — `ledger-spool.ts` 의 **tombstone**:
유실된 이벤트 자리에 "여기서 유실됐다" 는 기록을 남긴다. 삭제도 같은 모양이 될 수 있다.

**진짜 긴장 셋:**

1. **원장 본문에 지울 수 없는 개인정보가 들어 있다** — `params` 원문, `actorUid` 원시 uid.
2. **체인이 본문을 통째로 해시한다** → 사후 수정이 원리적으로 불가능하다(§7.3).
3. **암호적 삭제가 PIPA 상 "파기" 인지 확정 해석이 없다** — 법률 판단이지 기술 판단이 아니다.

### 7.3 ★절단선 — 소급은 불가능하다 (되돌리기 어려운 사실)

```
v3/electron/mcp-server/ledger-chain.ts  computeEventHash 주석:
  "본문은 필드를 골라 담지 않고 **통째로** 넣는다 — 나중에 필드가 추가돼도
   자동으로 보호 범위에 든다."
```

이 설계는 옳지만 **부작용이 하나 있다: `params` 를 사후에 지우거나 암호화하면 그 행의 `hash` 가
안 맞게 되고, `prevHash` 사슬을 타고 **그 뒤 모든 행의 검증이 깨진다.** 머클 체크포인트가
그 사슬 머리를 봉인해 두었으므로 체크포인트까지 거짓이 된다.

**따라서 답은 두 갈래로 나뉜다 — 이 절단선은 협상 대상이 아니다.**

| | 이미 쌓인 행 | 앞으로 쌓일 행 |
| --- | --- | --- |
| 방식 | **보존기간 만료 시 세그먼트 통째 삭제 + tombstone** | **원문을 애초에 안 담는다**(§6.3) |
| 체인 | 세그먼트 단위로 끊고, 체크포인트에 봉인된 머클 루트는 남긴다 → "이 구간이 존재했고 정책에 따라 파기됐다" 를 여전히 증명 | 그대로 유지 |
| 개인정보 | 남아 있음 → **접근 차단(읽기 게이트)+보존기간**이 유일한 통제 | 원리적으로 없음 |
| 전환점 | — | **새 제네시스 체크포인트**. 그 이전/이후는 다른 규약이다 |

★`ledger.ts` 가 이미 같은 방식으로 한번 절단선을 그었다: *"§10 — 소급 무결성 보증은 포기하고
제네시스 체크포인트 이후만 보증한다."* **같은 패턴을 삭제권에 적용한다.**

### 7.4 권고안 — 4겹

1. **보존기간을 정하고 고지한다.** 권고: **감사 원장 24개월**(SOC2/ISO 감사 주기 2년 관행),
   비용 원장은 국세기본법상 증빙 보존과 맞춰 **5년**. 만료 세그먼트는 tombstone 남기고 파기.
   ★이건 코드보다 **처리방침 개정이 먼저**다 — `privacyContent.tsx` 에 원장 항목을 추가한다.
2. **`actorUid` 를 가명으로 저장한다.** 원장 본문에 원시 uid 대신 `tm_`류 HMAC 가명을 적고,
   가명↔uid 매핑은 **원장 밖 별도 표**에 둔다. 삭제 요구가 오면 **그 표의 행 하나만 지운다** —
   원장은 그대로 남고 체인도 안 깨지며, 그 사람은 원장에서 영구히 재식별 불가가 된다.
   ★근거 패턴이 이미 있다: `analyticsPseudonym.ts` — *"소급은 저장이 아니라 조회로 한다.
   이벤트 행에 `user_key` 컬럼을 만들지 않는다. 링크는 별도 표에만 있고, 그 표를 지우면
   소급이 그 자리에서 취소된다."* **이 문장이 그대로 삭제권의 답이다.**
3. **테넌트별 키(선택, 기업 상위 플랜).** `params`(신규 규약에서도 남기기로 한 부분이 있다면)를
   테넌트별 DEK 로 암호화하고 DEK 를 KMS 에 둔다. 삭제 요구 = **DEK 폐기**. 암호문은 남으므로
   체인 해시가 유지된다. ★단 이건 §7.3 의 "앞으로 쌓일 행" 에만 적용된다.
4. **반출(export)은 삭제보다 싸고 먼저 필요하다.** 기업은 삭제보다 **"우리 데이터 내놔"** 를 훨씬
   자주 요구한다. `getTeamProjectAudit` 응답을 그대로 CSV/JSON 으로 떨구는 것은 신규 노출이 0이다
   (이미 화면에 그리는 것과 같은 봉투). **PR-5 로 싸게 낸다.**

★**법률 검토 필요(티켓 밖):** 암호적 삭제·가명 매핑 삭제가 PIPA 제36조의 "파기" 로 인정되는지.
국내법은 "복원 불가능한 방법" 을 요구하는데 키 폐기가 그에 해당한다는 확정 해석이 없다.
**이 답이 나오기 전에 기업 계약서에 "삭제 가능" 을 쓰면 안 된다.**

---

## 8. 기업이 실제로 물을 것 — 전수 + 오늘의 답

| 질문 | 오늘의 답 | 격차 |
| --- | --- | --- |
| **SSO(SAML/OIDC)** | 없음. Firebase Auth 소셜·이메일 | ★대. Firebase는 GCIP 로 SAML 지원 — 요금제 변경 필요 |
| **SCIM 프로비저닝** | 없음 | 대. 좌석 개념 자체가 없어 선행 조건 미충족 |
| **역할·권한** | ✅ 4역할 `ROLE_PERMISSIONS`, 룰과 UI 가 같은 판정 | 소. org 역할만 추가 |
| **감사로그 보존기간** | ❌ 문장 없음 | ★대(§7) |
| **감사로그 불변성 증명** | ✅ **강점.** 해시 체인 + 머클 체크포인트 + tombstone | 없음 — **여기가 파는 자리다** |
| **데이터 소재지(residency)** | Firestore/BQ 리전 고정. EU 요구 시 별도 프로젝트 필요 | 중. EU 고객 생기면 |
| **반출(export)** | ❌ 없음 | 소(§7.4-4) |
| **삭제권** | ❌ 수동 메일 | ★대(§7) |
| **DPA / 하위처리자 목록** | 처리방침에만 | 중. 문서 작업 |
| **SOC2 / ISO27001** | 없음 | 대. 감사 준비 자체가 프로젝트 |
| **가동률 SLA** | 없음 | 중 |
| **BYOK / 데이터 미학습** | ✅ **강점.** BYO-model + 학습 기본 OFF opt-in(`privacyContent.tsx:132`) | 없음 |
| **비용 상한·알림** | `PRICING-AND-COST-SAFETY-SPEC.md` 에 설계 있음 | 중 |
| **온프렘 / VPC** | 데스크톱 앱이라 실행은 이미 고객 기기. **원장만 우리 클라우드** | ★기회. "코드는 안 나갑니다" 가 강력한 문장 |

★**영업 문장으로 정리하면 이렇다:** 우리가 못 주는 것은 SSO·SOC2 처럼 **돈과 시간으로 사는 것**이고,
우리가 주는 것은 불변 원장·BYO-model·로컬 실행처럼 **뒤늦게 못 사는 것**이다. 이 비대칭을 세일즈덱
첫 장에 놓는다.

---

## 9. ★순서 제안 — 오케 의견 검토

### 9.1 오케 의견에 **동의한다. 단 근거를 바꾼다.**

> 오케: "멀티테넌시를 먼저 짓지 말자. 외부 활성 3명·외부 결제 1건인데 행 격리·IAM·초대를 먼저
> 지으면 상상의 고객을 위해 가장 비싼 걸 짓는 게 된다."

**결론은 옳지만 전제가 틀렸다.** 행 격리·IAM·초대는 **이미 지어져 있다**(§3.1). 그래서
"비싼 걸 나중에" 가 아니라 **"비싼 게 이미 있으니 최소판이 생각보다 훨씬 싸다"** 가 정확한 문장이다.

이 차이가 실무를 바꾼다: 오케 안대로면 "우리 조직 하나로 도는 대시보드를 **새로 만든다**" 인데,
실제로 필요한 것은 **`/team` 의 게이트를 열고 빈칸 넷을 메우는 것**이다. 새 라우트도, 새 데이터
모델도, 새 룰도 필요 없다.

### 9.2 그래서 최소판의 정의

> **최소판 = `/team` 을 "우리 조직 하나" 로 켠 것.**
> `orgId` 를 만들지 않는다. 우리 프로젝트들이 곧 데모 테넌트다.

이게 영업 자산이 되는 이유: 기업 미팅에서 보여줄 화면이 **실제 데이터로 살아 있다.** 목업이 아니라
1,338 태스크·$11,261 의 진짜 원장이다. 그리고 디자인 파트너가 생기면 그때 §4.3 의 세 결정을 연다.

### 9.3 ★org 축을 여는 트리거 (미리 정해 둔다)

아래 **둘 중 하나**가 성립하기 전에는 `organizations` 컬렉션을 만들지 않는다.

1. **한 고객사가 프로젝트 2개 이상을 하나로 보고 싶어 한다** — 이게 org 축의 유일한 정의다.
   프로젝트 1개 = 조직 1개면 `projectId` 가 이미 org 다.
2. **좌석 단위 인보이스를 요구하는 계약서에 서명한다** — 과금 축이 열리는 진짜 트리거.

★둘 다 아니면 org 는 **기능이 아니라 부채**다.

---

## 10. 독립 PR 분해

각 PR 은 **혼자 머지·되돌리기 가능**하고, 앞 PR 없이도 의미가 있다.

| PR | 무엇 | 범위 | 되돌리기 | 선행 |
| --- | --- | --- | --- | --- |
| **PR-1** | ★`params` 렌더러 구멍 봉인 + 소스 스캔 가드 | `v3/src/components/agents/AuditTimeline.tsx` · `tests/unit/*-params-guard.test.ts` | 쉽다 | 없음 |
| **PR-2** | 처리방침에 **원장 항목 신설**(보존기간 24개월 · 불변성 · 삭제 처리 방식) | `v3/src/components/legal/privacyContent.tsx` + 웹 법무 페이지 | 중(고지는 소급 못 무름) | 없음 |
| **PR-3** | ★**오케 지출 수집 배선** — `orchestrator-<projectId>` 규약으로 `cost_logs` 적재 재개 + `TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE` 설정 | `v3/electron/cost-tracker.ts` · `functions/src/teamUsage.ts` | 쉽다 | 없음 |
| **PR-4** | 사용량 탭 게이트 개방 — `TEAM_USAGE_EFFECTIVE_FROM` 설정 | 배포 env only | **즉시 되돌림**(env) | **PR-2** |
| **PR-5** | 감사·비용 **반출**(CSV/JSON) — 기존 봉투 그대로 | `functions/src/teamAudit.ts` · `teamUsage.ts` · `/team` UI | 쉽다 | 없음 |
| **PR-6** | 기업 랜딩 + 세일즈덱용 읽기전용 데모 뷰 | `marblo-web` | 쉽다 | PR-4 |
| **PR-7** | `LEDGER_ENV` 3키 **주입** — `model`/`tier`/`instructionHash` 를 실제로 채운다 | `v3/electron` spawn 경로 | 쉽다 | 없음 |
| **PR-8** | 신규 원장 규약 — `params` 원문 미저장 + `paramsDigest`/`paramsHash`, **새 제네시스 체크포인트** | `ledger.ts` · `ledger-chain.ts` · `tools.ts` | **★어렵다 — 절단선** | PR-1, PR-7 |
| **PR-9** | `actorUid` 가명화 + 가명↔uid 매핑표(삭제권 훅) | `ledger.ts` · 신규 컬렉션 · `teamAudit.ts` | **★어렵다** | PR-8 |
| **PR-10** | 보존기간 집행 — 만료 세그먼트 파기 + tombstone | `functions/` 스케줄러 · `ledger_checkpoints` | **★어렵다 — 파기는 복구 불가** | PR-2, PR-9 |
| **PR-11** | `organizations` 축 신설 (§4.2 전체) | 데이터모델·룰·BQ뷰·라우트·초대·과금 | **★★가장 어렵다** | §9.3 트리거 |
| **PR-12** | SSO(GCIP SAML/OIDC) | Firebase 요금제 + 인증 경로 | 중 | PR-11 |

### 10.1 되돌리기 난이도 범례

- **쉽다** — 머지 되돌리면 원상복구. PR-1·3·5·6·7
- **중** — 외부에 나간 약속이 남는다(고지·게이트 개방). PR-2·4
- **★어렵다** — 데이터·체인·법적 상태가 바뀐다. PR-8·9·10
- **★★가장 어렵다** — 12개 컬렉션의 접근 경계가 동시에 바뀐다. PR-11

### 10.2 권고 순서

```
지금:      PR-1 → PR-3 → PR-2 → PR-4 → PR-5 → PR-6      (영업 자산 완성)
           PR-7 은 언제든 병렬                            (원장 품질)
파트너 후: PR-8 → PR-9 → PR-10                           (컴플라이언스 척추)
계약 후:   PR-11 → PR-12                                 (멀티테넌시)
```

★**PR-3 을 PR-4 보다 먼저 두는 것이 이 순서의 핵심이다.** 지출의 29%가 비는 화면을 기업에 먼저
보여주면, 나중에 채웠을 때 "그럼 그때 본 숫자는 뭐였냐" 는 질문이 온다. 신뢰는 그 한 번에 깨진다.

---

## 11. 열린 질문 (오케 판단 필요)

1. **보존기간 24개월 / 비용 5년** 을 이대로 확정하나? 기업 계약이 더 긴 보존을 요구할 수도 있고,
   반대로 EU 고객은 더 짧은 것을 요구한다. → 첫 계약 전에 정해야 처리방침을 한 번만 고친다.
2. **암호적 삭제의 PIPA 적법성** — 법률 검토를 언제 태우나. PR-9 착수 전에 답이 없으면
   그 PR 의 전제가 흔들린다.
3. **가격.** CONTROL-PLANE.md §8.2 는 팀 $50–100/월이다. 기업은 어느 축인가 —
   §4.3-2 권고는 **사용량+플랫폼 정액**인데, 사장님 판단이 필요하다.
4. **감시선(§4.3-3).** 기업 고객이 "직원이 무슨 명령을 쳤는지 다 보여달라" 고 하면 파는가?
   내 권고는 **거절**이지만 이건 제품 결정이다.
5. **데모 테넌트를 우리 실데이터로 쓰는가.** 진짜 원장이라 설득력이 크지만, 우리 티켓 제목·
   프로젝트 이름이 노출된다. 가릴지 그대로 쓸지.

---

## 부록 A. 근거 파일 색인

| 주제 | 파일 |
| --- | --- |
| 원장 스키마 권위 | `v3/electron/mcp-server/ledger.ts` |
| 체인·해시 | `v3/electron/mcp-server/ledger-chain.ts` · `ledger-spool.ts` |
| 머클 체크포인트 | `v3/electron/ledger-checkpointer.ts` |
| 렌더러 원장 타입 | `v3/src/types/audit.ts` |
| 테넌트 경계(룰) | `v3/firestore.rules` (1,081줄) |
| 역할 정의 | `v3/src/types/invitation.ts` |
| 고객 감사 탭(서버) | `v3/functions/src/teamAudit.ts` |
| 고객 사용량 탭(서버) | `v3/functions/src/teamUsage.ts` |
| 우리 감사 뷰(서버) | `v3/functions/src/projectAudit.ts` |
| 축 가명화 | `v3/functions/src/analyticsPseudonym.ts` |
| 고객 대시보드(웹) | `marblo-web/src/app/[locale]/team/` |
| 비용 축 정본 | `v3/docs/COST-AXIS-RECONCILIATION-2026-08-08.md` |
| 팀 오버뷰 설계 | `docs/team-usage-overview-design-2026-08-21.md` · `docs/team-usage-summary-contract-2026-08-21.md` |
| 포지셔닝 정본 | `v3/docs/CONTROL-PLANE.md` |
| 처리방침(배포본) | `v3/src/components/legal/privacyContent.tsx` |

## 부록 B. 이 문서가 정정한 브리핑 항목

| # | 브리핑 | 실측 |
| --- | --- | --- |
| 1 | "테넌트 축이 없다" | 조직 축만 없다. 행 격리·RBAC·초대·권한상승 차단은 이미 있고 굳었다 |
| 2 | "대시보드를 만들까" | 이미 있다 — `/team` 사용량 탭 + 감사 탭. 게이트만 닫힘 |
| 3 | "cost_logs=clientId, task_outcomes=userId" | 반대다. cost_logs=Firebase uid(계정축), task_outcomes=clientId(익명축) |
| 4 | "taskId 만 다리다" | 그 다리는 일부러 끊었고(`U5OPOKf0D3I2TSRP8yUq`) 필요도 없다 — 계정축 안에서 완결 |
| 5 | "오늘은 비용 계산 불가" | 가능하다. D2 수리됨, taskId 행 중복 초과율 0.0% |
| 6 | "params 규율을 어떻게 지키나" | 서버 경계는 3겹으로 이미 강제. 구멍은 데스크톱 렌더러 1곳 |
| 7 | "불변 원장 vs 삭제권" | **유일하게 진짜로 안 풀린 것.** 그리고 체인이 본문을 통째 해시해 **소급 불가** |

---

_이 문서는 설계다. 구현은 §10 의 PR 단위로 별도 티켓이 받는다._

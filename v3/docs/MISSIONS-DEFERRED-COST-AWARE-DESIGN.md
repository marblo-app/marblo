# Missions — MVP 제외 결정 + 비용-인지 재설계 청사진

> 상태: **미션은 MVP에서 제외(플래그 off).** 핵심 가치 = 보드 + 오케스트레이터.
> 작성 2026-06-10. 관련: `MISSIONS-B-ORCHESTRATOR-DRIVEN.md`(B안), `PRICING-AND-COST-SAFETY-SPEC.md`.

## 1. 결정

미션(자율 다단계 흐름)을 **MVP에서 빼고**, 보드(Kanban) + 오케스트레이터(에이전트 지휘 + 대화)에 집중한다. 미션 코드는 버리지 않고 **단일 플래그 뒤에 보존(베타)** 하며, 후속 릴리스에서 **"파이썬-결정적 + 작은 모델"** 단순판으로 재설계한다.

### 근거

1. **핵심 가치는 보드 + 오케스트레이터** — 이미 작동·검증됨. MVP의 본체.
2. **conductor↔오케스트레이터 sync 미해결** — 오케(LLM)가 스텝 완료 트리거(`mission_step_done`)를 유저 핑퐁 뒤 빠뜨려 stall. 보고-필수 프롬프트(bug-6)·보고-감시 watchdog(bug-7)으로도 결정적 보장 불가(LLM 신뢰성 한계).
3. **비용/quota** — 미션은 subagent-heavy. `/status`(2026-06-10) 점검: 사용자 Max 주간 **78% 사용·90%가 subagent-heavy**. 미션 1회 = 오케 세션 + gstack 스텝마다 헤드리스 `claude --print` + dispatch/fix N 에이전트 = 큰 LLM 소비. 엔드유저가 미션 몇 번에 본인 주간 quota를 태우면 최악의 첫인상.

## 2. 과금/비용 현실 (재설계의 횡단 제약)

- **현재**: mission `run_skill`→`claude --print`는 최소 env(ANTHROPIC_API_KEY 미forward)=ambient **구독 인증** → Max 사용량 차감(API 직접청구 아님). 단 `ANTHROPIC_API_KEY` 가 set되면(예: 설정 키 → main.ts) 구독보다 우선 = API 과금.
- **정책(★검증 필요)**: 보고상 ~2026-06-15부터 `claude -p`/Agent SDK(헤드리스)가 구독 풀에서 분리 → **별도 월 크레딧(Max5x $100 등) + 초과분 API 과금**. 계정 `/status`·billing으로 재확인.
- **결론**: 헤드리스 다발은 (현재) 구독 주간 cap, (6/15~) 별도 크레딧 소진→API 비용. **미션 설계는 LLM 호출 최소화가 필수.**

## 3. 비용-인지 실행 원칙 (재설계의 헌법)

1. **결정적 로직은 파이썬 코드 (LLM 0)** — 스텝 순서·게이트·dispatch 배선·상태 폴링·git/PR(`/ship`)·단순 변환. 백엔드(FastAPI)/conductor가 결정적으로 운전.
2. **LLM은 "진짜 판단"만** — 조사/분석, goal→task 분해, 코드 작성, 리뷰 판단. 그 외엔 코드.
3. **작은 모델 우선** — 단순 서브에이전트·분해·리뷰는 haiku/sonnet. opus는 정말 필요한 곳만. (`/status`도 "단순 subagent는 싼 모델" 권고.)
4. **미션당 예산 가시화** — 텔레메트리로 미션별 토큰/비용 추정, 시작 전 "이 미션 ≈ 주간 N%" 경고/확인.
5. **(엔드유저) 과금 모드 명시** — 구독/크레딧 vs 앱-소유 API 키(+spend cap) 선택 + 사용량 표시. 유저 개인 quota 보호.

## 4. 단순 미션 아키텍처 청사진 (후속 — "결정적 컨덕터 주도")

> 결정: 오케(LLM)를 스텝 운전석에서 내리고, **컨덕터가 결정적으로 운전.** 완료 = 결정적 신호(헤드리스 op 리턴 / task DONE). 오케는 **결정지점 대화 레이어**.

### 스텝 = "헤드리스 자율 op" (인터랙티브 gstack 스킬 아님)

gstack 스킬(/investigate 등)은 **대화형 도구**라 자율 미션 primitive로 부적합(`--print` 비대화로 돌리면 질문 못 해 멈춤/품질저하). 대신 각 스텝 = **끝까지 비대화로 도는 전용 프롬프트**(작은 모델), **질문 대신 "decision 항목"을 구조화 출력**. gstack 방법론은 프롬프트에 녹이되 인터랙티브 의존만 제거.

| 스텝                       | 실행                                      | 완료 신호(결정적)       |
| -------------------------- | ----------------------------------------- | ----------------------- |
| investigate/plan/review/qa | 컨덕터가 작은-모델 헤드리스 op (비대화)   | op 리턴 + 출력 검증     |
| implement(fix)/dispatch    | 코딩 에이전트 spawn / decomposer 1회 호출 | task DONE (wait-게이트) |
| ship                       | **파이썬 git/gh 절차 (LLM 0)**            | exit 0 + PR URL         |
| wait                       | 컨덕터 폴링                               | 전부 DONE               |

### 결정지점 (사람 판단)

- op가 **질문 대신 decision 항목을 출력** → 컨덕터가 멈춤 → 유저(오케 대화창)와 정리 → 결정 반영해 다음 스텝. 결정 필요 없으면 자동 전진(= "자동으로 흐르는 느낌").
- **결정지점 정책(열린 결정)**: (A) 템플릿 레벨 `auto`/`confirm` 플래그(추천·예측가능) vs (B) 출력 마커 vs (C) LLM 분류기.

### 오케스트레이터의 새 역할

운전 안 함. **결정지점 대화 + 개입(에이전트 stuck/유저 조정) + 내레이션**에만 호출. 결정지점 사이는 컨덕터 결정적(LLM 루프 없음).

## 5. MVP 플래그 메커니즘 (현재 구현됨)

- **단일 플래그 `VITE_DEV_FEATURES=missions`** 가 둘 다 게이트:
  - UI: `TabBar.tsx` `DEV_ONLY_TABS` 에 `"missions"` 포함 → 플래그 없으면 미션 탭 숨김.
  - 엔진: `main.ts` 가 `process.env.VITE_DEV_FEATURES`(.env dotenv 로드) 에 missions 없으면 `buildMissionEngine` 미호출 → `missionBundle=null` → startup의 forwarder/pickupPlanningMissions 스킵(이미 null-safe) → **잔존 테스트 미션 자동 실행 안 됨(quota 0).**
- **로컬 개발에서 미션 보려면**: `.env` 에 `VITE_DEV_FEATURES=missions`(+기존 flows,deploy 유지) 추가 후 재시작.
- 미션 코드(버그1~7·미션카드, PR #44 cb400eb 머지분)는 플래그 뒤 그대로 보존.

## 6. 열린 결정 (재개 시)

1. **결정지점 정책** — 템플릿 auto/confirm(추천) vs 출력마커 vs LLM분류.
2. **op 세트** — 표준 op(investigate/plan/implement/review/ship) 프롬프트를 고정 설계(추천) vs 템플릿 자유정의.
3. **과금 모드** — 구독/크레딧 vs 앱 API 키(+spend cap). 엔드유저 보호.
4. **decomposer** — 컨덕터 직접 LLM 1회 호출(결정적·추천) vs 오케 위임.

## 7. 보존된 것

- 미션 전체 코드(엔진/conductor/오케/카드/버그수정 1~7) = main 머지(cb400eb) + 플래그 뒤. 후속 단순재설계의 기반·참고.
- 견고한 인프라(미션 오케 PTY/resume, 보드 카드, findMissionTaskIds 등)는 재설계에서도 재사용.

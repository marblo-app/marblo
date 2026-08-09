# L0 온램프 빌드 + 심플/어드밴스드 온보딩 파리티 감사

- **티켓**: `VzR1izqW6hzwF0YRfkgL`
- **설계 정본**: [`onramp-ladder-design-2026-08-09.md`](./onramp-ladder-design-2026-08-09.md) (#886)
- **범위**: 설계의 "지금 빌드 가능"(§8-D) = **L0(B안) + M1 + M2 호스트 갭 + 계측**. L2(크레딧·프록시·약관)는 서면확인 뒤라 손대지 않았다.

---

## 1. 무엇이 실제로 지어졌나

| 설계 항목 | 상태                              | 위치                                                                          |
| --------- | --------------------------------- | ----------------------------------------------------------------------------- |
| **N1**    | ✅ **이미 있었다**(#888 스톨계측) | `electron/telemetry.ts` `spawnBlocked` — 재구현하지 않았다                    |
| **N2**    | ✅ 신규                           | `src/lib/onrampDecompose.ts` (순수 룰 + 한도 판정)                            |
| **N3**    | ✅ 신규                           | `src/services/onrampDemoTickets.ts` + `Task.origin/originRule/originFallback` |
| **N4**    | ✅ 신규                           | `src/lib/onrampGate.ts` · `OnrampBlockModal` · `OnrampGateHost`               |
| **N5**    | ✅ 신규(잔여분)                   | `FundingGuideHost` 를 `GlobalOverlays` 로 승격                                |
| 계측      | ✅ 신규 2종                       | `onramp:decompose_used` · `onramp:exec_blocked`                               |
| N6~N10    | ✕ 미착수(의도)                    | L2 — 서면확인·프록시·원장 선행                                                |

**설계와 코드가 갈렸던 곳 1건**: 설계 초안의 `TicketDraft.role` 은 `qa`/`design` 을 썼지만 실제 `Task.role`(`AgentRole`)은 `backend|frontend|test|devops` 넷뿐이다. 불변식 **I3(티켓은 진짜다)** 가 이기므로 실제 타입을 따랐다 — 보드가 모르는 역할을 붙이면 그 티켓은 배정이 안 되는 가짜가 된다. `tests/unit/onramp-decompose.test.ts` 가 이 경계를 지킨다.

---

## 2. ★파리티 감사표 — 빈칸 0

세 셸이 있다: **심플**(`BeginnerShell`) · **어드밴스드**(`WorkspaceShell`) · **레거시**(`Layout`, 테스트 하네스 전용 경로지만 코드가 살아 있다).

| 표면                   | 심플                                   | 어드밴스드                         | 레거시              | 비고                                   |
| ---------------------- | -------------------------------------- | ---------------------------------- | ------------------- | -------------------------------------- |
| 설치·인증              | ✅ `BeginnerConnectStep`(원클릭+택1)   | ✅ `StartHereTab` + `CliSetupHost` | ✅ `CliSetupGate`   | 엔진은 `useCliSetupEngine` 한 벌       |
| 샘플 프로젝트 자동연결 | ✅                                     | ✅                                 | ✅                  | `useProjectSetup` → `useAppLifecycle`  |
| 캔드 데모(L−1)         | ✅ 연결 게이트의 "데모 보기"           | ✅ 시작하기 탭                     | ✅ 로그인 화면      | 같은 `DemoMode`                        |
| **L0 룰 분해**         | ✅ **신규** `OnrampDecomposeCard`      | ✅ **신규** 같은 컴포넌트          | —(온보딩 표면 없음) | 프리뷰에서는 비노출(실 write 이므로)   |
| **M1 실행 차단**       | ✅ **신규** `OnrampGateHost(beginner)` | ✅ **신규** `GlobalOverlays`       | ✅ **신규**         | CTA 목적지만 셸별로 다름               |
| **M2 자금 없음**       | ✅ 기존                                | ✅ **호스트 승격**                 | ✅ **갭 해소**      | 종전엔 `CliSetupHost` 안 → 레거시 무음 |
| BYOM(L1.5)             | ✕ **의도**                             | ✅ `ByomStartSection`              | ✕                   | 설계 §6-B: 승격 않고 M1 CTA2 뒤에 둔다 |

**닫은 갭 하나**: `FundingGuideHost` 는 `CliSetupHost` 안에 있었고 그 호스트는 `WorkspaceShell` 만 마운트한다 → 레거시 셸 사용자는 "로그인은 됐는데 구독이 없다" 는 **같은 상태에서 아무 안내도 못 받았다**. `GlobalOverlays` 로 올리고 원본을 지웠다(둘 다 두면 모달이 두 개 뜨고 계측이 두 배가 된다).

재발 방지: `tests/unit/onramp-mode-parity.test.ts` 가 위 표를 소스 스캔으로 못박는다(v3 vitest 는 `environment:"node"` 라 셸 렌더가 불가하고, 검증 대상이 "그 셸에 마운트돼 있는가" 라는 구조적 사실이라 스캔으로 충분하다).

---

## 3. 불변식이 코드에서 어떻게 지켜지나

| 불변식                               | 강제 장치                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **I1** L0 는 우리 원가를 안 만든다   | 룰 모듈에 네트워크·`electronAPI`·firebase·원격 URL 금지 **소스 스캔 테스트**(데모 대본과 동형)    |
| **I2** 문은 항상 L1 을 먼저 가리킨다 | M1 본문이 "추가 비용 없음 — 이미 쓰는 구독" 을 말한다. 크레딧 placeholder 는 **비활성 유지**      |
| **I3** 아래층 산출물이 위층에 산다   | 티켓을 `taskService.createTask` 로 실제 `tasks` 에 쓴다(프리뷰 배열 아님) + `origin` 필드         |
| 정직성(§4-D)                         | `fallback === true` 면 화면 **과** 티켓 본문 **양쪽**이 "다시 쪼갭니다" 를 말한다 — 테스트로 강제 |
| 조용한 실패 금지                     | 한도 초과·폴더 없음·부분 실패 모두 화면 문구가 있다. 한도 초과는 그 자리에서 M1 을 띄운다         |
| 자유 텍스트 계측 금지                | `onramp:decompose_used` 인자에 원문·제목이 못 들어가게 파리티 테스트가 식별자 단위로 검사         |

---

## 4. 계측 — 퍼널이 이제 이렇게 이어진다

```
신규 설치
  → onboarding:beginner_entered            (있음)
  → onramp:decompose_used                  ★신규 {matchedRule, fallback, ticketCount, persisted, surface}
  → onramp:exec_blocked                    ★신규 {trigger, model, installed, shown, suppressedReason}
  → onboarding:spawn_blocked               (#888, main 축)
  → onboarding:cli_setup_step(성공)        (있음)
  → onboarding:beginner_first_completion   (있음)
```

**`onramp:exec_blocked` 와 `onboarding:spawn_blocked` 는 다른 축이다.** 후자는 "게이트가 막았다"(사실), 전자는 "그 차단이 화면이 되어 유저에게 말을 걸었다"(경험). 둘이 갈리는 지점(세션 상한 2회·MCP 축 억제)이 곧 튜닝 손잡이라, 억제된 차단도 `shown:false` 로 함께 싣는다.

설계 §9-D 의 게이트 판정(G0/G1)에 필요한 축은 이 두 이벤트로 채워졌다. **판독은 아직 하지 않았다**(BQ 쿼리는 퍼널 티켓 몫).

---

## 5. 한계 · 정직성

- **룰 품질은 판정선만 지켰다.** 설계 T4 의 "임의 한국어 20문장에서 fallback < 40%" 를 테스트로 두었지만, 그 20문장은 **내가 고른 문장**이지 실제 유저 입력 표본이 아니다. 실 fallback 비율은 `matchedRule` 계측이 쌓여야 안다.
- **제목의 자연스러움은 검증되지 않았다.** 명사구 추출은 형태소 분석기 없이 조사·상용어를 벗기는 방식이라, 문장 구조가 특이하면 어색한 주어가 잡힐 수 있다. 그때도 골격(역할·순서·의존성)은 맞는다는 것이 이 설계의 주장이고, 그 주장 자체는 검증 대상이다.
- **화면을 눈으로 보지 못했다.** 이 워크트리에서 Electron 앱을 띄우지 않았다(메인 프로세스 재시작은 사용자만 가능). tsc 0 · 유닛 5,567건 통과는 배선의 증거이지 **픽셀의 증거가 아니다** — 첫 실행 화면의 카드 위치·여백은 눈으로 확인해야 한다.
- **M1 을 실제 차단 상황에서 재현하지 못했다.** 이 기기는 CLI 가 설치·인증돼 있어 `needsAuth` 가 나오지 않는다. 판정 규칙은 유닛으로 덮었지만, 실 스폰 차단 → 모달 노출의 종단 경로는 미인증 기기(클린룸)에서 확인해야 한다.
- **L0 카드를 연결 카드 *위*에 두었다.** 사다리 순서(값 먼저, 자격증명 나중)를 따른 것이지만, "원클릭이 주 경로" 라는 종전 결정(#1F0D8hH5)과 시각적 우선순위가 경쟁한다. 순서는 되돌리기 쉬운 한 줄이므로 시연 뒤 판단할 값이다.
- **크레딧 placeholder 는 손대지 않았다.** 설계 §5-B 대로 L2 착지 전에는 활성화하지 않는다.

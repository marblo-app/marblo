# Marblo 전략 재검증 — Orchestration이 Primary 해자인가 (Claude 관점, 리포트온리)

- 작성일: 2026-07-18
- 티켓: `yLVsLZ6qIglwF62fPQ2A` (리포트온리, 코드 변경 없음)
- 병행: Codex 티켓 `MrR3SeaGiZbsZA7LR8NG` 와 독립 수행 — 오케스트레이터가 두 결과를 종합
- 프레임: 사장님 교정 재검증 — "이전 CEO 리뷰가 REVIEW/audit에 과하게 쏠렸다. 진짜 최대 차별은 **라이브 오케↔에이전트 PTY 통신 + 보드 통신으로 의존성을 고려한 다중 에이전트 스폰·조율**이고, 이 PTY 기반 통신을 **핵심 기술 특허로 출원**했다. orchestration이 primary, audit는 secondary라는 가설을 검증하라."

## 0. 한 줄 결론

> **가설은 옳다. Orchestration이 primary 해자(복제 어려운 기술/IP 해자)이고, audit/REVIEW는 그 위에 세우는 secondary 수익화·엔터프라이즈 웨지다. 이전 CEO/GTM 리뷰는 이 계층을 뒤집어 audit를 primary로 올리고 orchestration을 "가시성=복제됨"으로 과소평가했다.**

두 축은 경쟁 관계가 아니라 **토대-수익화 관계**다: 특허받은 라이브 오케스트레이션이 **엔진**이고, audit/safe-merge는 그 엔진이 생산하는 **판매 가능한 아티팩트**다. 엔진 없는 audit는 GitHub+Slack으로 복제되지만, 엔진 위의 audit는 복제되지 않는다. 그래서 서사의 **주어**는 orchestration이어야 하고 audit는 **술어**여야 한다.

---

## 1. 검증 방법 — 문서 3개 + 코드 실재 확인

읽은 문서:

- `v3/docs/research/orca-worktree-ux-benchmark.md` (2026-07-17, `AkezywnUzmo2PkbB8fTG`)
- `v3/docs/research/marblo-vs-orca-final-ceo-strategy-review-2026-07-17.md` (`AtauYc1DTQhu2zn0Dq2f`)
- `v3/docs/research/marblo-gtm-strategy-vs-orca-2026-07-18.md` (`OWy15JSQXQAiXJXORT9u`)
- 보조: `v3/docs/CONTROL-PLANE.md`, `v3/docs/COMMUNICATION-ARCHITECTURE.md`

★핵심: 세 전략 문서가 다루지 않은 **`COMMUNICATION-ARCHITECTURE.md` + 실제 electron 코드**를 대조해, "orchestration = 복제 가능한 가시성"이라는 전제가 코드 현실과 맞는지 검증했다. **맞지 않았다.**

### 1.1 코드로 확인한 orchestration 실재 (근거 파일:라인)

**A. PTY 기반 오케↔에이전트 통신 — 비자명한 실기술** (`electron/pty-manager.ts`)

- `import * as pty from "node-pty"` (`:1`). 에이전트는 컨테이너가 아니라 로컬 CLI(claude/gpt/codex/gemini)를 PTY에 붙여 띄운 것.
- `writeAndSubmit` — Ink 기반 TUI에 "메시지 주입 + 제출"이 단순 `text+"\r"`로 안 됨. `SUBMIT_SIGNAL` 정규식(`:51` — `esc to interrupt|✻✶✳✽✢|↓ N tokens`)으로 "턴이 실제로 시작됨"을 감지하고, 안 되면 CR 재전송(submit-with-retry).
- **Bracketed paste**(ESC[200~/201~, `:262`)로 붙여넣기 프레이밍, `detectDangerousCommand` 스크리닝(`:87`), node-pty 마스터 fd 누수 가드(`:69,172`), `onExit` 레이스 가드(죽은 옛 프로세스의 onExit가 교체된 새 세션을 지우지 않도록).
- 부하 상황(여러 에이전트 동시 PTY 스트리밍)에서 타이밍 레이스를 이기는 "보내고-확인하고-재전송" 루프 — **이것이 "터미널 하나 띄우기"와 orchestration의 결정적 차이.**

**B. 양방향 실시간 제어 인터페이스** (`electron/bridge-server.ts:2513`, `POST /inject-message`)

코드 주석이 특허 매핑을 직접 명시:

- **하향 경로(특허 단락 296-297)**: 사용자가 칸반보드에서 코멘트/상태강제변경/우선순위/에이전트 재배정 → PM 신규지시로 담당 에이전트 PTY stdin에 주입 → 에이전트는 실행 중단 없이 기존 컨텍스트 위에서 반영.
- **상향 경로**: 에이전트 stdout → 태스크보드 → 칸반.
- 주석: _"상향+하향 합쳐 청구항 5/10 + 명세서 양방향 실시간 제어 인터페이스 구현 완성."_
- 완료 루프: `POST /notify-orchestrator` — 에이전트가 `submit_for_review`/`update_task_status` 호출 시 오케 PTY에 완료 통지 주입. **오케가 완료를 아는 유일한 경로**(bridge가 dispatch 지시에 완료 프로토콜 푸터 자동 append).

**C. 의존성 인지 다중 에이전트 스폰·조율 — 특허 청구항으로 코드에 명시**

- **청구항 4 (선행 태스크 의존성 게이트)** — `electron/mcp-server/tools.ts:2829-2890`. `dispatch_task`가 매칭점수 산출 **전에** `task.dependsOnCompleted`를 판정, 미충족이면 태스크를 `BLOCKED`로 강등하고 디스패치 거부(`:2874`). 스텁이 아니라 실 강제(applyProjection으로 projection·statusCounts 동시 이동), claim_task 게이트에 방어심층까지.
- **의존성 자동 해소** — `tools.ts:1642-1674`. 상류 태스크 완료 시 트랜잭션으로 하류를 원자적 전이하고 `[Dependency Resolved] ... all dependencies met` 통지 → **DAG 기반 자동 조율**.
- **청구항 9 (디스패치 매칭점수)** — `electron/dispatch-scoring.ts:57,461`. `매칭점수 = (w1×역할매칭)+(w2×부하균등)+(w3×비용효율)+보조신호` 가중합, 역할 미매치는 hard gate. 여러 idle 에이전트 중 최적 배정 = "쉬운 병렬 운영"의 알고리즘적 실체.
- **청구항 8 (구독제 vs 토큰단위 통합 과금)** — `electron/cost-tracker.ts:59+`, `main.ts:5146`, `preload.ts:482`. BYO-subscription/BYOK 혼합 fleet의 통합 비용 산출.
- **크로스머신 우편함** — `pending-instruction-listener.ts`. Firestore `pendingInstructions` 큐 → 다른 기기의 에이전트 PTY로 멱등 주입(트랜잭션 isDelivered 플립).
- **DAG 조립 레이어** — `electron/orchestrator/{dag-generator,dag-resolver,task-decomposer,auto-router}.ts`. 요구를 의존성 DAG로 분해 → §C의 dispatch 게이트/자동해소로 흘려보냄. "의존성을 고려한 스폰"이 단발 체크가 아니라 **전용 분해·해소 서브시스템**임을 확인.

**D. 라이브 TUI 주입의 동시성 하드닝 (독립 서브에이전트 코드검증으로 교차확인)**

- `orchestrator-manager.ts` `injectMessage`(`:478-519`)는 `bootGate`(부팅 프롬프트 제출 사이클 완료 대기) + `injectChain`(주입 직렬화)로 게이트 — 부팅과 지시 주입이 인터리브돼 Enter가 유실되는 레이스를 방어. **살아있는 대화형 TUI에 주입할 때만 생기는 미묘한 동시성 문제.**
- `bridge-server.ts:202-220` `shouldInjectOrchestratorNotification` — timeline-only `[Task Activity]`는 억제, DONE/FAILED/BLOCKED·`[Review Submitted]`·`[Dependency Resolved]`만 오케 PTY를 깨움. **오케 "대화"가 의미있는 상태변화에만 전진**하도록 분류.
- bridge 보안: per-session bearer token(`bridge-server.ts:222+`), 매 `writeAndSubmit`에 dangerous-command 스크리닝(`pty-manager.ts:285-297`).

### 1.2 특허 취급 (사장님 지시 준수)

특허는 **존재 사실**로만 다룬다. 코드 주석에 **청구항 4/5/8/9/10 및 명세서 단락 256-264/296-297이 번호로 참조**되어 있음을 확인했다(원문·명세 파지 없음, secret 없음). 즉 orchestration 메커니즘이 코드 전반에 특허 청구항 단위로 매핑되어 구현돼 있다는 사실이 확증된다 — 이는 "출원한 방어가능 IP"라는 사장님 진술을 코드가 뒷받침한다.

---

## 2. 판정 Q1 — 이전 CEO 리뷰가 orchestration 해자를 과소평가했나?

**판정: 예, 명백히 과소평가했다.**

### 근거 (이전 문서의 실제 문장)

`marblo-vs-orca-final-ceo-strategy-review-2026-07-17.md`:

- _"Visibility is not a moat. Boards, status chips, agent lists, and **diff viewers can be copied**."_ (§Where the Thesis Is Weak 2)
- _"The defensible layer is the **structured decision/provenance system around merge and audit**."_
- 후속 액션 8개가 **전부** REVIEW Cockpit / Decision Log / PR·CI 캡처 / Safe-merge / Audit export — orchestration 엔진 관련 항목 **0개**.
- Positioning Rewrite 액션: _"Replace **'multi-agent orchestration' lead copy** with 'auditable merge decisions.'"_ → orchestration을 **버릴 카피**로 명시.

`marblo-gtm-strategy-vs-orca-2026-07-18.md`:

- §2.1: _"Orca: 개인 생산성 카테고리 / Marblo: 팀 거버넌스 카테고리. **다른 링에서 싸운다.**"_ → orchestration이 있는 링(Orca와 같은 링)을 **회피**하라고 권고.
- H1을 `Turn parallel agent work into auditable merge decisions`로 확정 — 주어가 audit.

### 왜 과소평가인가 (3가지 논증)

1. **"복제 가능"의 오판.** 이전 리뷰는 orchestration을 "board/diff viewer처럼 복제됨"으로 뭉뚱그렸다. 그러나 board·diff는 UI라 복제되지만, **§1.1의 PTY submit-retry·양방향 실시간 주입·의존성 DAG 조율·매칭점수 알고리즘은 (a) 비자명한 시스템 엔지니어링이고 (b) 특허 청구항으로 출원됐다.** 복제 난이도가 UI와 질적으로 다르다. 이전 리뷰는 이 계층을 코드로 보지 않고 "가시성 기능"으로 추상화해버렸다.

2. **특허 자산을 서사에서 삭제.** 방어가능 IP(특허)를 가진 축을 "lead copy에서 빼라"고 한 것은 전략적 오류다. 해자 논의의 핵심은 "복제 어려움"인데, 정작 **가장 복제 어려운(법적 배제권까지 있는) 축**을 secondary로 내렸다.

3. **Orca 비교의 비대칭 무시.** Orca는 "격리 worktree에서 CLI 에이전트 병렬 실행"이 핵심이지만, Orca 문서 어디에도 **오케스트레이터가 에이전트 PTY에 라이브로 지시를 주입하고 의존성 DAG로 스폰을 조율하는** 메커니즘은 없다(Orca는 사람이 worktree를 손으로 만들고 관리). 즉 orchestration은 Orca와 **같은 링이 아니라 상위 링**이다. 이전 리뷰가 "같은 링 회피"로 판단한 것은, orchestration을 Orca의 병렬 실행과 동급으로 본 오인에서 비롯됐다.

**단, 이전 리뷰가 옳았던 부분(유지):** "개인 IDE를 유료로 팔면 무료 Orca에 진다", "audit/거버넌스가 팀 바이어의 지갑을 연다", "무료/오픈코어로 배포 방어" — 이 **수익화 논리는 여전히 타당**하다. 오류는 해자의 **원천**을 audit로 지목한 것이지, audit의 **수익화 가치**를 본 것이 아니다.

---

## 3. 판정 Q2 — Orchestration vs Audit, 무엇이 Primary 해자인가

**판정: Orchestration = primary(기술/IP 해자, 복제 어려움). Audit = secondary(수익화/엔터프라이즈 웨지).** 둘은 배타가 아니라 **엔진 ↔ 아티팩트** 관계.

### 3.1 두 해자의 성질 분해

| 축                                                | 성질                         | 복제 난이도                                    | 방어 기제                                                                     | 역할                             |
| ------------------------------------------------- | ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| **Orchestration** (PTY 통신·의존성 조율·매칭점수) | **기술/IP 해자**             | **높음** — 시스템 엔지니어링 + **특허 배제권** | 특허(청구항 4/5/8/9/10), 축적된 안정화 노하우(submit-retry·fd누수·레이스가드) | **엔진** = 제품이 존재하는 이유  |
| **Audit/REVIEW/Safe-merge**                       | **수익화/엔터프라이즈 웨지** | **중간** — GitHub+Slack로 부분 복제 가능       | 팀 데이터 락인, 컴플라이언스 계약, provenance 축적                            | **아티팩트** = 팀이 돈 내는 이유 |

### 3.2 왜 orchestration이 primary인가 — 인과 순서

```
[특허받은 라이브 오케스트레이션 엔진]
   └─(생산)→ 의존성 조율된 다중 에이전트 병렬 실행 (Orca도 못 하는 상위 링)
        └─(생산)→ 각 에이전트의 provenance·diff·decision 궤적
             └─(포장)→ audit/REVIEW/safe-merge = 팀에 파는 아티팩트
```

- **엔진이 아티팩트를 낳는다, 역은 성립 안 함.** audit는 orchestration이 생산한 궤적을 포장한 것. orchestration 없이 audit만 있으면 = GitHub PR + Slack(이전 리뷰의 적대검증 §1이 스스로 인정한 취약점).
- **복제 테스트.** 경쟁자가 audit 대시보드를 베끼는 것 vs. PTY 양방향 실시간 제어 + 의존성 DAG 조율 + 매칭 알고리즘을 (특허 회피하며) 재구현하는 것 — 후자가 압도적으로 어렵다. **해자의 정의(복제 비용)로 보면 orchestration이 상위.**
- **IP는 orchestration에만 붙어 있다.** audit는 특허가 아니다. 방어가능 IP 자산을 가진 축이 primary 해자라는 것은 동어반복에 가깝다.

### 3.3 왜 audit가 여전히 필수(secondary이되 버릴 수 없음)인가

- **orchestration은 해자지만 지갑을 직접 안 연다.** 개발자는 "빠른 병렬"에 열광하지만(개인 도파민), **예산은 팀리드/CTO가 쥐고**, 그들은 "안전하게 merge/누가 승인"에 돈을 낸다(GTM 문서 §7-6 정확).
- **orchestration은 개인 티어(무료)에서도 체감되므로, 그것만으로는 Free→Team 전환이 안 걸린다.** 전환 게이트 = 공유 audit/provenance(Team 경계). 즉 **orchestration이 유입·리텐션을 만들고, audit가 과금을 만든다.**
- 따라서 **버리는 게 아니라 순서를 바꾼다**: audit를 "해자의 원천"에서 "엔진의 수익화 표면"으로 재배치.

### 3.4 결론 프레이밍 (사장님 요청 형식)

> **"기술/IP 해자(복제 어려움) = Orchestration(특허받은 라이브 PTY 통신·의존성 조율)"** 이 **primary**이고,
> **"수익화/엔터프라이즈 웨지 = Audit/REVIEW/Safe-merge"** 가 그 위에 얹히는 **secondary**다.
> 관계 = **엔진(orchestration)이 낳은 궤적을 아티팩트(audit)로 팔아 수익화**. 엔진이 해자를 지키고, 웨지가 계약을 딴다.

---

## 4. 판정 Q3 — 올바른 Primary 포지셔닝/서사 재정렬

**원칙: 서사의 주어를 audit → orchestration으로 되돌리되, audit를 술어로 붙여 "왜 이 orchestration이 팀에게 안전한가"로 잇는다. 계층은 3단.**

### 4.1 3단 계층 (엔진 → 아티팩트 → 카테고리)

```
1층 (HOOK, 복제불가 엔진 · 특허):
   "의존성을 알아서 조율하며 수십 개 에이전트를 라이브로 스폰·조종한다."
   → 개발자 유입·바이럴·데모의 aha. Orca보다 상위 링임을 즉시 증명.
        ↓ (이 엔진이 만든 궤적을)
2층 (WEDGE, 수익화 아티팩트):
   "그 병렬 작업을 감사가능한 merge 결정으로 만든다 — spec→agent→diff→test→decision→SHA."
   → 팀리드/CTO의 지갑. Free→Team 전환 게이트.
        ↓ (둘을 묶어)
3층 (CATEGORY):
   "Marblo = AI-native 팀의 control plane. 엔진(오케스트레이션) + 통제(감사)."
```

### 4.2 카피 재정렬 (이전 GTM H1과 대비)

|             | 이전(audit 주어)                                           | 재정렬(orchestration 주어 + audit 술어)                                                                                                                                        |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H1**      | `Turn parallel agent work into auditable merge decisions.` | `Orchestrate dozens of coding agents — with dependencies handled, live.`                                                                                                       |
| **Sub**     | (audit 나열)                                               | `Marblo spawns and steers a fleet of agents in real time, resolves task dependencies automatically, then turns their work into auditable merge decisions your team can trust.` |
| **1차 CTA** | Start free                                                 | `Run your first fleet` (엔진 체감)                                                                                                                                             |
| **2차 CTA** | See a team review                                          | `See a team review` (웨지, 유지)                                                                                                                                               |

핵심 교정: 이전 GTM 액션 T-3(포지셔닝 리라이트)의 _"'multi-agent orchestration' 카피를 빼라"_ 는 **철회**한다. orchestration은 lead여야 하며, 그것이 **특허로 방어되는 유일한 축**이기 때문이다.

### 4.3 데모/바이럴 재정렬

- **1층이 데모의 히어로**: "의존성 그래프를 인지해 5개 에이전트가 순서대로/병렬로 자동 스폰되고, 보드에서 코멘트 하나 남기면 그 지시가 라이브로 에이전트에 주입되는" 장면. 이건 **시각적으로 화려**하고(이전 GTM이 "audit는 GIF가 안 예쁘다"고 자인) Orca가 못 보여주는 그림.
- **2층이 공유 아티팩트**: audit card(GTM T-8)는 유지하되, 카드의 헤드라인을 "N agents orchestrated with dependency X→Y→Z, all auditable"로 — **엔진과 아티팩트를 한 카드에** 담는다.
- **Orca 상호운용 프레임은 재해석**: 이전엔 "Orca 위에 얹는 audit 층"이었으나, 정확히는 **"Orca가 못 하는 오케스트레이션 층 + audit"**. Orca 유저에게 "당신의 worktree 위에 라이브 오케스트레이션과 감사를 더한다"로 소구.

### 4.4 리스크·주의 (재정렬의 함정)

1. **특허 소구의 신중함.** "특허받은"을 마케팅 문구로 직접 쓸지는 법무 검토 후. 본 리포트는 특허를 **해자 논거**로만 사용(원문 미파지). 대외 카피는 "특허" 단어 없이 **기능 우위**로 표현 가능.
2. **엔진만 팔면 개인 티어에 갇힌다.** 1층 hook이 강할수록 무료 유입은 늘지만, 2층(audit=Team 경계)으로 넘기는 전환 넛지가 없으면 수익 없음 → GTM T-10(2인 초대 트리거) **더 중요해짐**.
3. **Orca 상방 이동.** Orca가 238 컨트리뷰터로 라이브 오케스트레이션을 따라올 수 있음. 방어선 = **특허 + 안정화 노하우(submit-retry·fd누수·크로스머신 멱등)의 깊이** — UI가 아니라 시스템 신뢰성. 이 노하우를 문서화된 자산(COMMUNICATION-ARCHITECTURE.md)으로 계속 축적.
4. **엔진이 안정적이어야 서사가 산다.** orchestration을 primary로 내세우는 순간, PTY 유실·오케 먹통 같은 회귀(메모리에 다수 기록: injectMessage silent drop, onExit 레이스, MCP -32000)가 곧 **핵심 서사의 반증**이 된다. 즉 재정렬은 **안정성 투자 우선순위 상향**을 동반해야 한다.

---

## 5. 최종 요약 (3문항 답)

- **Q1 (과소평가?)** — **예.** 이전 CEO/GTM 리뷰는 orchestration을 "board·diff처럼 복제되는 가시성"으로 추상화해, 정작 **비자명한 시스템 엔지니어링 + 특허 청구항(4/5/8/9/10)으로 방어되는** 가장 복제 어려운 축을 secondary로 내리고 "lead 카피에서 빼라"고까지 했다. 코드(§1.1)가 이 전제를 반증한다.
- **Q2 (primary 해자?)** — **Orchestration = primary(기술/IP 해자, 복제 어려움)**, **Audit = secondary(수익화/엔터프라이즈 웨지)**. 관계 = **엔진↔아티팩트**: 특허받은 라이브 오케스트레이션이 궤적을 낳고, audit가 그것을 팀에 판다. 엔진 없는 audit = GitHub+Slack(복제됨).
- **Q3 (재정렬?)** — **3단 계층**: ①엔진(오케스트레이션, 특허·데모 hook) → ②웨지(audit·safe-merge, Free→Team 과금 게이트) → ③카테고리(control plane). 서사 주어를 audit→orchestration으로 되돌리고 audit를 술어로 잇는다. 이전 GTM의 "orchestration 카피 삭제" 권고는 철회. 단 안정성 투자·전환 넛지·특허 소구 법무검토를 동반 조건으로.

**승부수(수정):** REVIEW/audit 척추를 **버리지 말되**, 그것을 "해자의 원천"이 아니라 **"특허받은 오케스트레이션 엔진의 수익화 표면"**으로 재배치한다. 서사·데모·바이럴의 **1층은 복제불가한 라이브 다중 에이전트 조율**, 2층이 audit. Orca와 **다른 링**이 아니라 **상위 링**에서 싸운다.

---

## 6. 출처

- 코드(실재 확인, v3/electron):
  - `pty-manager.ts:1,51,262,87` — node-pty·writeAndSubmit·SUBMIT_SIGNAL·bracketed paste·dangerous-command 스크리닝
  - `bridge-server.ts:2513` — 양방향 실시간 제어(특허 단락 296-297, 청구항 5/10), `/notify-orchestrator` 완료 루프
  - `mcp-server/tools.ts:2829-2890,1642-1674` — 청구항 4 의존성 게이트(BLOCKED 강등)·의존성 자동 해소
  - `dispatch-scoring.ts:57,461` — 청구항 9 매칭점수 가중합(역할×부하×비용효율)
  - `cost-tracker.ts:59`, `main.ts:5146`, `preload.ts:482` — 청구항 8 통합 과금
  - `pending-instruction-listener.ts` — 크로스머신 멱등 주입
- 문서: `COMMUNICATION-ARCHITECTURE.md`, `CONTROL-PLANE.md`, 위 research 3종
- 특허: 코드 주석에 청구항 4/5/8/9/10·명세서 단락 256-264/296-297 **번호 참조 확인**(존재 사실만; 원문·명세 미파지, secret 없음)

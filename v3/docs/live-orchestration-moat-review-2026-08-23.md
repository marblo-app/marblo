# 라이브 오케스트레이션 폐루프는 해자인가 — CEO 리뷰

> **Task**: `6A7GJpVzwHnh87cDogG0` (재배정 — 앞 에이전트 MiniMax-M3 무산출 사망)
> **Date**: 2026-08-23
> **Method**: `/plan-ceo-review` 프레임(전제 도전 · 역산 · 초점) + 웹 실사 + 코드/스키마 실사
> **Constraint**: 코드 변경 없음. 프로덕션 데이터 조회 없음(스키마·코드·기존 감사문서만).
> **표기 규칙**: `[근거 있음]` = 출처 있는 외부 사실 / `[확인 불가]` = 찾지 못함, 단정하지 않음 / `[내 추론]` = 위 둘에서 내가 세운 판단

---

## 사장님 요약 (15줄)

1. **판정: 폐루프는 해자가 아닙니다.** 좋은 UX 이고, 약한 락인이 얹혀 있습니다. 축적 데이터 해자는 아직 없습니다.
2. 사장님 직감은 맞았고 실사 결과는 더 나쁩니다 — 그 층은 이미 **무료 오픈소스 기성품**입니다.
3. `agent-kanban`: 리더 에이전트가 목표를 쪼개 워커에 배정, 워커가 claim→구현→PR, `depends_on` 사이클 검출, 런타임 13종. **우리 보드 프로토콜과 동형입니다.**
4. `vibe-kanban`: 카드→에이전트 스폰, 로그·diff 상향, **실행 중 에이전트에 메시지 주입**, MCP 서버. `agent-board`: 칸반+DAG+MCP+감사로그.
5. PTY 러너만 8종, 칸반형만 7종이 공개 목록에 있습니다. 경쟁자가 생기는 중이 아니라 이미 카테고리입니다.
6. 그리고 이 층을 중심에 놓은 회사는 둘 다 죽었습니다 — **Terragon 폐업, Bloop 셧다운.** 시장의 답으로 읽어야 합니다.
7. 복제 난이도: **낮습니다.** 워크체인은 568줄이고 자기보고-거부 개념도 이미 OSS(`proof-loop`, `agentic-os`)입니다. 3~12개월이면 따라잡힙니다.
8. 코드는 시간이 지나도 비싸지지 않습니다. 오늘 복제 비용 = 1년 뒤 복제 비용. 해자의 정의를 만족하지 않습니다.
9. **다만 우리 폐루프는 실재합니다.** 스폰→비용/결과→라우팅 그래프→다음 스폰. 파일로 확인했고 설계 규율(콜드=0, 귀책 분리, UCB1 탐색)이 훌륭합니다.
10. **그런데 복리가 아닙니다. ①** 라우팅 그래프가 **머신 로컬 JSON**(`routing-graph.ts:764`)입니다 — 고객 100명이면 서로 모르는 그래프 100개. 네트워크 효과 0.
11. **②** 표본이 세 자릿수입니다. `task_outcomes` 888행, **실패 라벨 39건.** 사내 감사문서 판정도 "Not ready". 잘 만든 엔진에 연료가 없습니다.
12. **③** 개념도 이미 오픈소스입니다 — ACRouter(arXiv 2606.22902, 코드 Apache 2.0)가 같은 학습 루프를 공개했습니다.
13. **대안: 폐루프 말고 원장을 소유하십시오.** 우리만 가진 교차점은 **태스크 그래프 × 비용 × 결과 라벨**입니다. 칸반 경쟁자엔 비용축이 없고(README 확인), FinOps(Portkey/LiteLLM)엔 결과 라벨이 없습니다.
14. 폐루프는 해자가 아니라 **원장을 채우는 수집기**로 재배치하십시오. 그 가치는 자기 자신이 아니라 원장 기여로 정산됩니다.
15. **실행 순서 B→A→C:** (B) 실패 라벨 39건→수천건, (A) 라우팅 그래프 비식별 풀링 = 유일한 네트워크 효과 경로, (C) provenance·safe-merge 를 나갈 수 없는 system of record 로. — `CONTROL-PLANE.md` §2.2 가 이미 답을 적어놨고, 실행이 실행기 층으로 샜습니다.

---

## 0. 판정 (한 줄)

**★"PTY 기반 에이전트 + 보드 상하향 통신 + 라이브 오케 폐루프" 는 해자가 아니다.**
그것은 (iii) 좋은 UX 이고, 거기에 (ii) 약한 워크플로 락인이 얹힌 것이다. (i) 축적 데이터 해자는 **아직 존재하지 않는다** — 우리 코드가 그렇게 만들어져 있지 않기 때문이다(§4).

사장님의 직감("경쟁자가 많아지는 것 같다")은 맞았고, 실사 결과는 그보다 나쁘다. 우리가 해자로 봤던 그 층은 2026 현재 **무료 오픈소스로 내려받을 수 있는 기성품**이다.

동시에, 사장님의 두 번째 문장("라이브 오케스트레이션 폐루프를 잡아야 한다")은 **방향은 맞고 대상이 틀렸다.** 잡아야 할 것은 루프의 *메커니즘*이 아니라 루프가 *뱉는 것*이다(§6).

---

## 1. 전제 검증 — "그런 경쟁자가 많아지는 것 같다" 를 사실로 바꾼다

웹 조사 가능 여부를 먼저 확인했다: **가능**(WebSearch/WebFetch 정상 동작, 아래 전부 실제 조회 결과).

### 1.1 PTY 기반 멀티에이전트 + 보드 상하향 통신을 이미 하는 제품 `[근거 있음]`

| 제품                                        | 우리와 겹치는 지점                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 출처                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **saltbo/agent-kanban**                     | "Leader agent breaks the goal into tasks and assigns to workers → Daemon dispatches workers, each in its own worktree → Workers claim, implement, and open PRs → Leader reviews and merges PRs." 상태 Todo→In Progress→In Review→Done. `depends_on` + **cycle detection**. 에이전트가 `ak` CLI 로 보드를 읽고 쓴다. Ed25519 에이전트 신원. 지원 런타임 13종(Claude Code/Codex/Gemini/Copilot/Hermes/Cursor/Goose/Amp/Kiro/Qwen/OpenCode/Antigravity/Pi). FSL-1.1(2년 후 Apache 2.0), 455★ | github.com/saltbo/agent-kanban, agent-kanban.dev    |
| **quentintou/agent-board**                  | "Kanban + DAG dependencies + **MCP server** + auto-retry + **audit trail**. Built for autonomous AI agent teams."                                                                                                                                                                                                                                                                                                                                                                         | github.com/quentintou/agent-board                   |
| **BloopAI/vibe-kanban**                     | 카드→worktree+에이전트 스폰(하향), 로그·diff 스트리밍(상향), **실행 중 에이전트에 follow-up 메시지 주입**(하향, executor 바쁘면 자동 큐잉), diff 인라인 코멘트→에이전트 전달, MCP 서버 존재. Claude Code/Codex/Gemini/Copilot/Amp/Cursor/OpenCode/Droid/Qwen 지원                                                                                                                                                                                                                         | github.com/BloopAI/vibe-kanban, vibekanban.com      |
| **Alethe**                                  | "agents and shells run as **real PTYs** in split panes and custom grids", 팬 닫기·앱 재시작에도 생존, 유휴 그룹 서스펜드                                                                                                                                                                                                                                                                                                                                                                  | awesome-agent-orchestrators                         |
| **Ouijit**                                  | "Kanban board and terminals wired together by **lifecycle hooks**"                                                                                                                                                                                                                                                                                                                                                                                                                        | 〃                                                  |
| **openkanban**                              | "Kanban board for orchestrating coding agents, rendered entirely in the terminal"                                                                                                                                                                                                                                                                                                                                                                                                         | 〃                                                  |
| **Fusion**                                  | "Multi-node orchestrator with a kanban board"                                                                                                                                                                                                                                                                                                                                                                                                                                             | 〃                                                  |
| **Agent Teams**                             | "Agents coordinate through **inter-agent messaging**"                                                                                                                                                                                                                                                                                                                                                                                                                                     | 〃                                                  |
| **Conductor / Sculptor / Claude Code 자체** | Conductor = macOS 데스크톱, 클로즈드. Sculptor = worktree 대신 컨테이너. Claude Code 는 자체적으로 작업을 의존성 그래프로 쪼개 백그라운드 에이전트를 병렬 스폰("The Conductor")                                                                                                                                                                                                                                                                                                           | nimbalyst / codeagentswarm 2026 비교글, theunwindai |

`andyrewlee/awesome-agent-orchestrators` 목록에는 PTY/tmux 러너만 8개, 칸반 보드형만 7개가 별도 카테고리로 서 있다. **이건 "경쟁자가 생기는 중" 이 아니라 이미 카테고리다.**

### 1.2 정직하게 적어야 할 반대 사실

- **Terragon 폐업** `[근거 있음]` — 클라우드에서 코딩 CLI 를 돌리던 백그라운드 에이전트 오케스트레이터.
- **Bloop(vibe-kanban) 2026-04 셧다운 발표** `[근거 있음]` — 제품은 OSS 커뮤니티 유지로 전환.

`[내 추론]` 이건 우리에게 좋은 소식이 아니다. **"경쟁자가 죽었다" 가 아니라 "이 층으로는 회사가 안 된다"** 는 시장의 답이다. 두 곳 다 우리가 해자라고 부르던 바로 그 층을 제품의 중심에 놓았다. 그리고 남은 것들은 대부분 무료다 — 무료 대체재가 있는 층에서 가격을 받을 수 없다.

### 1.3 우리만 하는 것으로 남는가?

우리 보드 프로토콜(`claim_task` → `update_task_status` → `add_activity` → `submit_for_review`, `ask_orchestrator` 로 상향 질문, 오케 PTY 로 답 주입)을 agent-kanban 의 흐름과 겹쳐 보면 **동형이다.** 유일하게 겹치지 않는 것은 `ask_orchestrator` 의 **타입드 Q&A 왕복**(질문 id → 답변이 워커 PTY 로 주입)인데, vibe-kanban 의 follow-up 주입(사람→에이전트)과 Agent Teams 의 inter-agent messaging 을 합치면 기능적으로 같은 자리다. `[내 추론]` 차별점으로 팔 수 있는 크기가 아니다.

---

## 2. 복제 난이도 — 낮다

★**복제 비용이 낮으면 해자가 아니다. 이 결론이 나왔으므로 그대로 적는다.**

| 구성요소                              | 우리 구현 규모                           | 복제 난이도 `[내 추론]`                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PTY 에이전트 스폰·생존                | agent-manager 외                         | **낮음** — tmux/node-pty 로 주말 작업. OSS 8종이 이미 함.                                                                                                                                                                                                                                                                      |
| 보드 ↔ 에이전트 양방향(MCP/CLI)       | mcp-server/tools.ts                      | **낮음** — agent-board 가 MCP 로, agent-kanban 이 CLI 로 이미 함.                                                                                                                                                                                                                                                              |
| 오케→워커 위임, 의존성 게이트         | dispatch + depends_on                    | **낮음** — agent-kanban 은 사이클 검출까지 있다.                                                                                                                                                                                                                                                                               |
| 워크체인(오케가 다음 할 일을 안 잊음) | `work-chain-core.ts` **568줄**, 의존성 0 | **낮음** — 순수 데이터 모델 + 판정 함수다. 설계 판단이 좋을 뿐 코드량이 방벽이 아니다.                                                                                                                                                                                                                                         |
| 자기보고 완료 거부(보드 사실로 판정)  | `rejectSelfReportReason`                 | **낮음~중간** — 개념은 이미 OSS 다: `LeoStehlik/proof-loop`("evidence-backed done claims"), `KbWen/agentic-os`(5단계 중 어느 단계도 근거 없이 done 아님), `verification-before-completion` 스킬 `[근거 있음]`. 우리 구현이 **상태기계 층**에 있다는 게 프롬프트 규칙보다 강하지만, 그 차이는 3일치 설계 차이지 3년치가 아니다. |
| 라우팅 학습 루프                      | graph-updater→routing-graph→autoselect   | **중간** — 개념·구현 모두 오픈소스로 존재한다: **ACRouter**(arXiv 2606.22902), 실행 피드백을 메모리에 적어 다음 라우팅에 쓰는 C-A-F 루프, Opus-only 대비 비용 2.6배 개선 주장 `[근거 있음]`(재검증 경로는 §4.2 각주).                                                                                                                                   |

**결론: 폐루프는 12개월이면 따라잡힌다. 잘 만든 팀이면 3개월이다.** 해자의 정의(복제 비용이 시간이 갈수록 커지는 것)를 만족하지 않는다 — 우리 루프는 오늘 복제 비용과 1년 뒤 복제 비용이 같다. 코드는 시간이 지나도 비싸지지 않는다.

---

## 3. 해자의 정체 분해 — 셋 중 무엇인가

★**"좋은 UX" 는 해자가 아니다. 흐리지 않고 하나로 답한다.**

| 후보                    | 판정              | 근거                                                                                                                                                                         |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(i) 축적되는 데이터** | ✗ **아직 아니다** | §4. 학습이 머신 로컬에 쌓이고, 표본이 세 자릿수다.                                                                                                                           |
| **(ii) 워크플로 락인**  | △ **약~중**       | 우리 안에 provenance·의사결정·비용 원장이 쌓이는 건 사실이라 나갈 때 잃는 게 있다. 하지만 락인의 세기는 "쌓인 양"에 비례하는데 그 양이 §4 수준이다. 지금 나가는 비용 ≈ 하루. |
| **(iii) 그냥 좋은 UX**  | ✓ **이것이다**    | §1·§2. 기능 목록으로 보면 무료 OSS 와 겹치고, 우리가 나은 부분은 판단의 질(자기보고 거부, 비용축 규율, 해상도 표기)이지 복제 불가능성이 아니다.                              |

**폐루프의 정체 = (iii) + 약간의 (ii). 해자가 아니다.**

`[내 추론]` 오해를 막기 위해 덧붙인다 — "해자가 아니다" 는 "가치 없다" 가 아니다. 좋은 UX 는 **오늘 고객을 얻는 이유**다. 다만 **내일 고객을 잃지 않는 이유는 되지 못한다.** 사장님이 물으신 건 후자다.

---

## 4. 우리 자산 실사 — 복리인가, 나란히 있는 기능인가

전부 파일을 열어 확인했다. "있다고 가정" 한 항목은 없다.

### 4.1 실재하는 것 ✓

| 자산                            | 위치                                                                                  | 확인 내용                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_routing_effectiveness`     | `v3/electron/mcp-server/routing-effectiveness.ts` (353줄)                             | (model@effort × 난도 × taskType) → 성공률·평균비용·**비용당성공**. 조인은 BQ 왕복 없이 `tasks/{id}` 에 물질화(`costTotal` + `dispatchMeta.spawnedModelKey`). ★규율이 좋다: 터미널 상태만 집계(진행중은 `skipped.nonTerminal`), 비용 0 ≠ 비용 없음(`costCoverage` 동반, 합 0 이면 `successPerDollar`=null), `model@effort` 와 `provider` 해상도를 한 칸에 안 섞음, 임계값·추천 없음.                                                                                                                              |
| `task_outcomes`                 | BQ `marblo_telemetry.task_outcomes`                                                   | 스키마 실재. `success` 는 보드 status 에서 파생(`src/lib/telemetry/taskOutcome.ts`: DONE=성공, FAILED/BLOCKED=실패).                                                                                                                                                                                                                                                                                                                                                                                             |
| `cost_logs`                     | BQ `marblo_telemetry.cost_logs`                                                       | 스키마 실재. per-task 롤업은 `services/taskRollups.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **지식그래프 라우팅**           | `routing-graph.ts`(885줄) ← `graph-updater.ts`(326줄) → `model-autoselect.ts`(1225줄) | ★**진짜 물려 돈다.** 쓰기: 에이전트 수명주기 결과(stale/crash/spawn_failed/blocked/failed/completed/merged)를 `applyOutcome` 으로 접어 원자적 저장. 읽기: `graphBiasForModel` 이 ±20 가산 성분으로 dispatch 핫패스에 들어감. 설계 규율이 상당하다 — 콜드스타트 0, 신뢰도 축소 n/(n+K), 귀책 분리(호스트 장애는 2일 감쇠, `dependency_stuck` 은 **학습에서 완전 제외**), model@effort 신키↔구키 **계층 축소**로 마이그레이션. `model-autoselect` 는 여기에 UCB1 형 저표본 보너스와 stale 감쇠(7~27일)까지 얹었다. |
| **워크체인 보드 파생 완료판정** | `work-chain-core.ts`(568줄)                                                           | ★티켓이 연결된 항목은 `self_reported` 종료를 **구조적으로 거부**(`rejectSelfReportReason`). 완료는 오케 말이 아니라 연결 티켓의 실제 status 로 판정(`deriveItemState`, `doneWhen`: exists/review/done). 자기보고로 닫힌 항목은 `evidence:"self"` 로 끝까지 구분돼 보인다. 헤더에 왜 missions/flows/pendingInstructions 를 안 썼는지 근거까지 적혀 있다.                                                                                                                                                          |
| RAW 학습데이터 파이프라인       | `training-capture.ts`(573줄)                                                          | 프롬프트/완성/추론/툴IO 원문을 **별도 데이터셋** `marblo_training` 으로. 이중 게이트(서버가 자격 확인 후에만 업로드 + 서버가 `uid===ADMIN_UID` 와 `privacyConsent.trainingDataCapture` 재검사), fail-closed, 로컬 JSONL 스풀로 오프라인 내구성.                                                                                                                                                                                                                                                                  |

**§4.1 소결: "그냥 나란히 있는 기능들" 이 아니다.** 스폰 결과 → `cost_logs`/`task_outcomes` → 라우팅 그래프 → `graphBias` → 다음 스폰 결정. 이 고리는 **닫혀 있고 코드로 확인된다.** 사장님이 폐루프라 부르신 것의 기술적 실체는 실재한다.

### 4.2 그런데 이게 복리가 되는가 — ✗ **안 된다. 세 가지 이유.**

**① 학습이 회사가 아니라 노트북 한 대에 쌓인다.**
`routing-graph.ts:764` — `GLOBAL_GRAPH_FILE = path.join(userData, "routing-graph.json")`. 파일 헤더도 스스로 "machine-local" 이라고 적는다. **고객 간 풀링 경로가 없다.**
→ 고객 100명이 생겨도 우리는 100개의 서로 모르는 그래프를 갖는다. 101번째 고객은 여전히 콜드 스타트다. 이건 정의상 **네트워크 효과가 0**이고, 복리의 반대다. 복리는 "남이 쓸수록 내가 좋아지는 것" 인데 지금 구조는 "내가 쓸수록 나만 좋아지는 것" — 그건 복리가 아니라 **개인 설정값**이다.

**② 표본이 세 자릿수다.**
`[근거 있음, 사내 실측]` `model-selection.ts:962` 주석에 남은 2026-08-20 전체 스캔: **491건 중 model@effort 해상도가 붙은 게 299건**(성공 295 · 실패 **4**), 모델미상 154건. `bq-ml-training-data-audit-2026-08-08.md`: `task_outcomes` **888행**(2026-06-15 ~ 08-08), 그중 FAILED 6 · BLOCKED 33.
→ **실패 라벨이 39건.** 라우팅이 배워야 하는 건 "무엇이 실패하는가" 인데 그 표본이 39건이다. 성공률 98.7%짜리 데이터로는 모델을 가를 수 없다. 같은 감사문서의 자체 판정도 **"Not ready for supervised spawn-model"**, 라벨 품질 "약함".
→ 그리고 우리 코드는 이 사실에 정직하다(콜드=0, 축소 n/(n+K)). 즉 **오늘 이 루프가 라우팅에 실제로 미치는 영향은 거의 0에 가깝다.** 잘 만든 엔진에 연료가 안 들어 있는 상태다.

**③ 개념 자체가 이미 공개·오픈소스다.**
ACRouter(arXiv 2606.22902) `[근거 있음]` — 조회 경로는 각주[^acrouter]. 실행 피드백을 메모리에 적고 유사 과거 태스크를 찾아 라우팅하는 루프를, 우리보다 큰 벤치(CodeRouterBench)와 함께 공개했다.

[^acrouter]:
    **재검증 경로**(2026-08-23 오케 대조 요청으로 독립 재확인). arXiv **API 는 빈 응답**을 주지만 `/abs/` 페이지는 200 이고 전문이 나온다 — 재확인할 사람은 API 말고 abs 로 갈 것.
    · 논문: _Agent-as-a-Router: Agentic Model Routing for Coding Tasks_ — https://arxiv.org/abs/2606.22902 (제출 2026-06-22, 저자 11인: Pengfei Zhou, Zhiwei Tang, Yixing Ma, Jiasheng Tang, Yizeng Han, Zhenglin Wan, Fanqing Meng, Wei Wang, Bohan Zhuang, Wangbo Zhao, Yang You)
    · 초록 인용: "we propose Agent-as-a-Router, a framework that formalizes routing as a **C-A-F loop (Context→Action→Feedback→Context)**. It **closes the information gap by accumulating execution-grounded experience during deployment**. We instantiate this framework as **ACRouter**, composed of an Orchestrator, a Verifier, a Memory module, and introduce **CodeRouterBench**, an evaluation environment comprising ~10K task instances with verified scores from 8 frontier LLMs… Codes and benchmarks are released at [this https URL]."
    · 오픈소스 실물: https://github.com/LanceZPF/agent-as-a-router (초록이 직접 지목). 오케스트레이터 모델 가중치는 Hugging Face 에 **Apache 2.0**.
    · 2.6배 수치 출처: VentureBeat 2026-07-13 — "ACRouter cost **$13.21** across the full task run, compared to **$34.02** for always defaulting to Opus — a **2.6x savings**." https://venturebeat.com/orchestration/acrouter-picks-the-smartest-ai-model-per-task-beating-opus-only-setups-by-2-6x-on-cost
    · ★이 인용이 무너져도 §4.2 의 논지는 안 무너진다 — ③은 ①(머신 로컬)·②(실패 라벨 39건)에 대한 **보조 논거**다. 복리 부정의 하중은 우리 코드와 사내 감사 수치가 진다.
    `[확인 불가]` 칸반 제품군(vibe-kanban/agent-kanban 등)이 이런 학습 루프를 갖췄다는 근거는 찾지 못했다 — **없다고 단정하지 않는다.** 다만 agent-kanban README 에는 비용추적·모델라우팅·과거결과학습에 대한 언급이 **없다**(전문 확인). 그 자리는 아직 비어 있다.

**④ RAW 학습데이터는 현재 사실상 우리 것만 모인다.**
`training-capture.ts` 의 게이트가 `uid === ADMIN_UID`. 정책으로는 옳다(원문 텍스트는 코드이자 PII 다). 하지만 데이터 해자 관점에서는 **현재 규모가 1인분**이라는 뜻이다.

### 4.3 §4 결론

> 폐루프는 **잘 설계된 기계**이고 **비어 있는 저장고**다.
> 기계는 3개월이면 복제된다(§2). 저장고는 우리 것이지만, 지금 안에 든 게 888행이고 심지어 **고객마다 따로 놓여 있다**.
> 그러므로 오늘 기준: **복리가 아니다.** 나란히 있는 기능들도 아니다 — 물려는 있는데, 돌 만한 연료가 없고 돌아봐야 그 결과가 한 대의 노트북에 갇힌다.

---

## 5. 반대 시나리오 — 폐루프에 집중하는 게 틀린 베팅이라면

★이 항을 비워두지 않는다. 오히려 이게 이 문서의 결론이다.

### 5.1 왜 틀린 베팅인가

1. **무료 대체재가 이미 있는 층에 자원을 태우는 것이다.** agent-kanban 은 FSL(2년 뒤 Apache 2.0), agent-board·openkanban 은 그냥 오픈소스다. 여기서 우리가 얻을 수 있는 최대치는 "더 나은 무료 대안" 이고, 그건 사업이 아니다.
2. **모델 벤더가 흡수 중인 방향이다.** Claude Code 자체가 작업을 의존성 그래프로 쪼개 백그라운드 에이전트를 병렬 스폰한다 `[근거 있음]`. 우리 `CONTROL-PLANE.md` §2.1 이 이미 같은 경고를 적어놨다 — "실행기를 만드는 것은 방어가능한 해자가 아니다". **폐루프는 실행기 층이다.** 우리 문서가 스스로 정한 선을 지금 우리가 넘고 있다.
3. **선례가 둘 다 죽었다.** Terragon 폐업, Bloop 셧다운(§1.2). 이 층을 중심에 놓은 회사가 남아 있지 않다.
4. **역산(inversion): 폐루프가 완벽해지면 우리는 무엇을 이겼는가?** 오케가 다음 할 일을 절대 안 잊는 상태가 됐다고 하자. 고객이 우리를 떠날 때 잃는 것은? 오늘 기준 **아무것도 아니다** — 티켓은 내보낼 수 있고, 라우팅 그래프는 어차피 그 사람 노트북에 있고, 스킬은 마크다운이다. 완벽한 폐루프의 해자 기여도 = 0.

### 5.2 대신 무엇을 해야 하나 — **원장을 소유하라(Own the ledger)**

`[내 추론]` 우리가 가진 것 중 **경쟁자 목록 어디에도 없는 단 하나**는 이것이다:

> **결과 라벨이 붙은, 태스크 단위 비용 원장.** > `cost_logs` **174,310행** + `tasks/{id}` 에 물질화된 per-task 비용 + `dispatchMeta`(난도·taskType·실제 스폰 argv) + 보드 status 파생 성공/실패 → **비용당성공(successPerDollar)**.

이게 왜 다른가:

- **칸반 경쟁자들에겐 비용축이 아예 없다.** agent-kanban README 에 비용 언급 0건(전문 확인) `[근거 있음]`.
- **FinOps 경쟁자들(Portkey, LiteLLM, Mavvrik, CloudZero)에겐 태스크 그래프가 없다** `[근거 있음]`. 그들은 게이트웨이/청구 레이어라 "누가 얼마 썼나" 는 답하지만 **"이 지출이 성공했나"** 는 구조적으로 답할 수 없다. 성공/실패 라벨은 보드에만 있고, 보드는 우리에게 있다.
- 시장 통증은 실측돼 있다 `[근거 있음]`: 개발자당 Claude Code 하루 ~$6, 병렬 5개면 하루 $50–65, "Anthropic 청구 페이지는 총액만 보여주고 개발자·팀·프로젝트별로 쪼개주지 않는다".

**교차점이 비어 있다: 태스크 그래프 × 비용 × 결과.** 우리는 세 축을 다 갖고 있고 이미 코드로 물려놨다.

### 5.3 그러면 폐루프를 버리나 — 아니다. **격을 낮춰 재배치한다.**

폐루프는 **해자가 아니라 원장을 채우는 수집기**다. 이게 정확한 위치다.

- 폐루프가 잘 돌수록 → 결과 라벨이 정확해지고(자기보고 거부가 여기서 결정적이다) → 원장의 품질이 올라간다.
- 즉 폐루프의 가치는 **자기 자신이 아니라 원장에 대한 기여로 정산된다.**
- ★이 재배치가 실제로 바꾸는 것: "오케가 다음 할 일을 안 잊는다" 를 다듬는 데 쓰던 시간을, **"실패 라벨을 39건에서 3,900건으로 만드는 일"** 에 쓴다.

### 5.4 그 베팅을 성립시키는 세 가지 (이게 실제 액션이다)

| #     | 무엇                                                                                                                                                      | 왜 이게 해자로 가는 길인가                                                                                                                                                                                                              | 현재 상태                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **A** | **라우팅 그래프를 풀링하라** — 비식별 집계로 테넌트 간 공유(개별 셀 카운터는 서버로, 원문은 절대 아님)                                                    | 이 한 줄이 "개인 설정값" 을 **네트워크 효과**로 바꾼다. 고객이 늘수록 101번째 고객의 첫날이 좋아진다. 오늘 유일하게 (iii)→(i) 로 넘어갈 수 있는 경로다.                                                                                 | 미구현. `GLOBAL_GRAPH_FILE` 은 머신 로컬.                                                               |
| **B** | **실패 라벨을 만들어라** — 지금 39건. `dependency_stuck`/무산출/워치독 stale 을 결과축에 제대로 적재하고, 성공률 98.7% 가 아니라 **실제 분포**를 확보한다 | 라벨 없는 원장은 회계장부이지 학습자산이 아니다. 감사문서 자체가 "Not ready" 라고 적었다.                                                                                                                                               | 부분. `graph-updater` 는 이미 여섯 종 outcome 을 분류함 — 그 해상도가 `task_outcomes` 까지 안 올라온다. |
| **C** | **원장을 나갈 수 없게 만들어라 (system of record)** — provenance 번들·의사결정 로그·safe-merge 게이트를 감사 가능한 하나의 기록으로                       | 락인의 세기는 "떠날 때 잃는 것" 이다. 6개월치 지출-결과 감사추적은 경쟁사로 가져갈 수 없다. `CONTROL-PLANE.md` §2.2 가 지목한 그 세 가지가 정확히 이것이다 — **우리 전략 문서는 이미 맞는 답을 적어놨고, 실행이 실행기 층으로 흘렀다.** | 설계 있음, 실행 분산.                                                                                   |

`[내 추론]` A 하나만 해도 해자 논의의 판이 바뀐다. B 없이는 A 가 빈 그릇이고, C 없이는 A·B 가 쌓여도 고객이 그냥 나간다. 순서는 **B → A → C**(연료 → 배관 → 잠금).

### 5.5 이 베팅이 틀릴 수 있는 지점 (정직하게)

- `[내 추론]` **프라이버시**: 라우팅 그래프 풀링은 "우리 티켓의 난도·taskType 분포" 를 통계로 내보내는 것이다. 셀 카운터만 보내도 소기업에선 역추론 여지가 있다. §A 는 프라이버시 설계가 선행 조건이고, `training-capture` 의 이중게이트·fail-closed 규율을 그대로 적용해야 한다.
- `[내 추론]` **모델 벤더가 이 층도 먹을 수 있다.** Anthropic 이 태스크 단위 비용-결과 귀속을 내놓으면 우리 자리가 좁아진다. 다만 그들은 **자기 모델만** 볼 수 있고, 우리 원장은 하네스·벤더 교차(claude/gpt/grok/minimax/deepseek)다. 교차 비교는 벤더가 구조적으로 못 하는 일이다 — 여기가 방어선이다.
- `[근거 있음]` **FinOps 쪽에서 반대로 올라올 수 있다.** LiteLLM/Portkey 가 태스크 개념을 붙이면 교차점을 뺏긴다. 그들에게 없는 건 보드와 결과 라벨이므로, B(라벨)를 서두르는 게 곧 방어다.

---

## 6. 사장님 원문에 대한 직답

> "PTY 기반 에이전트들과 오케 보드의 상향하향 통신이 해자라고 봤는데 요즘엔 그런 경쟁자들이 많아지는 것 같아서, 라이브 오케스트레이션 폐루프를 잡아야 될 것 같다. 우리만의 강력한 해자."

- **"경쟁자가 많아지는 것 같다"** → 맞습니다. 사실입니다. 그리고 무료입니다(§1).
- **"PTY + 보드 상하향이 해자"** → **아니었습니다.** 좋은 UX 였습니다(§3).
- **"라이브 오케 폐루프를 잡아야 한다"** → **방향은 맞고 대상이 틀렸습니다.** 폐루프는 3개월이면 복제됩니다(§2). 폐루프가 만들어내는 **결과 라벨 붙은 비용 원장**이 잡아야 할 것입니다(§5).
- **"우리만의 강력한 해자"** → 오늘은 없습니다. 만들 수 있는 것은 하나 있고, 그건 §5.4 의 A·B·C 입니다.

---

## 7. 근거 등급 요약

| 주장                                              | 등급                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| PTY+보드 상하향 경쟁 제품이 다수 존재             | `[근거 있음]` — 제품명·인용문·URL 명시(§1.1)            |
| Terragon 폐업 / Bloop 셧다운                      | `[근거 있음]`                                           |
| ACRouter = 오픈소스 실행피드백 라우팅 학습        | `[근거 있음]` — arXiv abs 전문 + 저장소 + VentureBeat 로 **2026-08-23 독립 재검증**(§4.2 각주에 조회 경로). arXiv **API 는 빈 응답**, `/abs/` 로 갈 것 |
| agent-kanban README 에 비용/라우팅/학습 언급 없음 | `[근거 있음]` (전문 확인)                               |
| 칸반 경쟁자들이 라우팅 학습 루프를 "안 갖췄다"    | `[확인 불가]` — 단정하지 않음                           |
| Claude Code 하루 ~$6/개발자, 병렬 5개 $50–65      | `[근거 있음]` (CloudZero/Torii 등)                      |
| 우리 라우팅 그래프가 머신 로컬                    | `[근거 있음, 사내]` `routing-graph.ts:764`              |
| task_outcomes 888행 / 실패 39건 / 스캔 491중 299  | `[근거 있음, 사내]` 감사문서 + `model-selection.ts:962` |
| "폐루프는 해자가 아니다"                          | `[내 추론]` — 위 사실들에서 도출                        |
| "원장을 소유하라" 대안                            | `[내 추론]` — 교차점 공백은 근거 기반, 베팅 판단은 추론 |

## 참고 출처

- https://github.com/saltbo/agent-kanban , https://agent-kanban.dev/
- https://github.com/quentintou/agent-board
- https://github.com/BloopAI/vibe-kanban , https://vibekanban.com/
- https://github.com/andyrewlee/awesome-agent-orchestrators
- https://arxiv.org/abs/2606.22902 (ACRouter — ★`/abs/` 사용, arXiv API 는 빈 응답), https://github.com/LanceZPF/agent-as-a-router (코드, Apache 2.0), https://venturebeat.com/orchestration/acrouter-picks-the-smartest-ai-model-per-task-beating-opus-only-setups-by-2-6x-on-cost (2026-07-13, 2.6배 수치)
- https://github.com/LeoStehlik/proof-loop , https://github.com/KbWen/agentic-os
- https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/ , https://www.codeagentswarm.com/en/guides/best-tools-to-run-multiple-ai-coding-agents
- https://www.cloudzero.com/blog/claude-code-agents/ , https://www.toriihq.com/articles/spend-management-tools-claude-code
- 사내: `v3/docs/CONTROL-PLANE.md`, `v3/docs/bq-ml-training-data-audit-2026-08-08.md`, `v3/electron/routing-graph.ts`, `v3/electron/graph-updater.ts`, `v3/electron/model-autoselect.ts`, `v3/electron/model-selection.ts`, `v3/electron/mcp-server/routing-effectiveness.ts`, `v3/electron/mcp-server/work-chain-core.ts`, `v3/electron/training-capture.ts`

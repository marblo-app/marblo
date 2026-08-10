# 워커 부트 프리픽스 다이어트 — 구현·실측

**티켓** `x4EGDVAWLuy2sdPb9fEK` · **작성** 2026-08-10 · **선행** [#900 토큰 절감 레버](./token-efficiency-levers-2026-08-09.md)
**성격** 구현 + 실측 A/B. 플래그로 즉시 롤백 가능.

---

## 0. 한 줄 결론

> #900 이 추천한 3개 조치를 전부 구현했고, **처음으로 부트 프리픽스를 직접 잴 수 있는 하네스**를 얻었다.
> 그 하네스가 #900 의 추정 하나를 **반증했다**: 역할별 MCP `tools/list` 스코핑(A1)은 프로토콜 레벨에서
> 40.8KB → 9.5KB (**−76.6%**) 를 실제로 달성하는데, 현행 Claude Code 가 MCP 툴 스키마를 **전량 지연
> 로딩**하므로 claude 워커의 프리픽스는 **391 토큰**밖에 안 줄어든다 (추정치는 −9,700 이었다).
>
> 반면 아무도 추천 목록에서 1순위로 꼽지 않았던 **auto-memory 주입 차단(A2)** 이 단독 **−13,814 토큰
> (−29.3%)** 으로 가장 큰 단일 레버였다.
>
> 기본 출하 조합(A1+A2)의 실측 부트 프리픽스: **47,102 → 32,897 토큰 (−30.2%)**, 부트 요청 비용 **−44%**.

---

## 1. 측정 하네스 — #900 §8-(A) 계측 갭을 메운 부분

#900 이 범위(31%↔63%)로만 말할 수밖에 없었던 이유는 `cost_logs` 가 15초 폴 델타라 **요청 단위**를 못 봐서다.
이번에 그 축을 우회했다.

```bash
claude -p "Reply with exactly: OK" \
  --dangerously-skip-permissions --model claude-opus-5 \
  --strict-mcp-config --mcp-config <marblo-only.json> \
  --output-format json
```

응답 `usage` 의 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` 가 곧
**단일 요청의 프리픽스 전량**이다. 첫 요청이라 프리픽스 외에 아무것도 없다. 폴 델타를 통하지 않으므로
"요청/폴 비율" 미지수가 개입하지 않는다.

**신뢰 범위 (반드시 붙는 단서)**

1. `-p` 비대화형 실행이다. 대화형 PTY 세션과 시스템 프롬프트가 **완전히** 같다는 보장은 없다. A/B 비교(같은
   모드에서 노브만 바꿈)는 유효하고, 절대값은 근사로 읽어야 한다.
2. cwd = 레포 루트라 프로젝트 `CLAUDE.md` 는 포함되고, **역할 스킬 본문(첫 사용자 메시지, ~2.2K)과 스폰
   프롬프트는 빠져 있다.** 실제 워커의 첫 요청은 이 측정치보다 그만큼 크다.
3. 전역 MCP 화이트리스트 서버(filesystem 등)는 제외하고 marblo 만 물렸다. 그 서버들의 툴도 같은 지연 로딩
   경로를 타므로 결론은 바뀌지 않지만, 절대값은 실제보다 약간 작다.
4. 관측된 47,102 는 #900 §3.4 가 정합성 논증으로 도출한 "실제 단일 요청 부트 ≈53K" 와 잘 맞는다.
   즉 §3.3 의 **상한 해석(최소 폴 = 요청 2개)이 옳았다**.

---

## 2. 실측 A/B

`claude-opus-5`, 레포 루트, marblo MCP 만 연결. 각 1회 측정.

| 구성                                   | 프리픽스 토큰 |            Δ vs BASE |    부트 요청 비용 |
| -------------------------------------- | ------------: | -------------------: | ----------------: |
| **BASE** (현행 · 44툴 · 메모리 · 스킬) |    **47,102** |                    — |            $0.323 |
| A1 — 역할별 tools/list 스코핑          |        46,711 |             **−391** |            $0.319 |
| A2 — auto-memory 차단                  |        33,288 |          **−13,814** |            $0.185 |
| A3 — 스킬 목록 차단                    |        35,343 |          **−11,759** |            $0.211 |
| **A1+A2 — 기본 출하값**                |    **32,897** | **−14,205 (−30.2%)** | **$0.181 (−44%)** |
| A1+A2+A3 (A3 opt-in 시)                |        21,529 | **−25,573 (−54.3%)** |            $0.073 |

부트 프리픽스 47.1K 의 성분 분해(실측 차분):

```
auto-memory 주입          13,814  (29.3%)   ← A2 가 제거
스킬 카탈로그             11,759  (25.0%)   ← A3 가 제거 (기본 OFF)
marblo MCP 툴 이름           391  ( 0.8%)   ← A1 이 제거
그 외(CC 코어 프롬프트 +
  내장 툴 + CLAUDE.md 등)  21,138  (44.9%)   ← 통제 불가
```

### 2.1 ★A1 추정치 반증 — MCP 툴 스키마는 프리픽스에 없다

`--debug-file` 로그가 직접 말해준다:

```
[DEBUG] Dynamic tool loading: 0/63 deferred tools included   ← BASE
[DEBUG] Dynamic tool loading: 0/33 deferred tools included   ← A1 적용 후
[DEBUG] [ToolSearch:optimistic] mode=tst, ENABLE_TOOL_SEARCH=undefined, result=true
```

Claude Code 2.1.226 은 MCP 툴을 **전부 지연 로딩**한다. 프리픽스에는 스키마가 아니라 **이름만** 실리고,
모델이 `ToolSearch` 로 필요할 때 스키마를 가져온다. 그래서 30개 툴(31.3KB 스키마)을 지웠는데 프리픽스는
391 토큰(≈툴 이름 30개)만 줄었다.

프로토콜 레벨 감축 자체는 실재한다 — `dist-mcp` 직접 프로브:

| `MARBLO_AGENT_ROLE`  | 툴 수 | `tools/list` 직렬화 |
| -------------------- | ----: | ------------------: |
| (미설정)             |    44 |            40,819 B |
| `backend`/`frontend` |    14 |             9,534 B |
| `merge`              |    17 |            12,954 B |
| `orchestrator`       |    44 |            40,819 B |
| `qa` (모르는 역할)   |    44 |            40,819 B |

**그래서 A1 을 왜 남기는가.** 두 가지 이유로 남긴다. 어느 쪽도 "지금 8~17% 를 번다"는 주장이 아니다.

1. **지연 로딩이 없는 하네스**에는 31.3KB 가 그대로 프리픽스에 실린다. 현재 편성상 스폰의 다수가 codex 계열이다.
   (codex 측 A/B 를 시도했으나 격리 `CODEX_HOME` 에서 marblo MCP 핸드셰이크가 안 붙어 **측정에 실패했다** —
   추정치를 지어내지 않고 미측정으로 남긴다. §5-A.)
2. **보험.** `ToolSearch:optimistic ... ENABLE_TOOL_SEARCH=undefined, result=true` 는 롤아웃 기본값이 켜져
   있다는 뜻이다. 꺼지는 순간 44개 스키마가 프리픽스로 돌아오고, 그때 A1 은 −8~9K 를 즉시 낸다.

### 2.2 A2 가 왜 1등인가

`autoMemoryEnabled:false` 하나가 13.8K 를 지운다. #900 은 `MEMORY.md` 인덱스 26.6KB(≈7.6K 토큰)만 계산했는데,
실제로는 인덱스 + 회상된 메모리 본문 + 메모리 시스템 블록이 함께 붙는다. 워커는 티켓 하나만 처리하므로
전역 인덱스 120줄의 회수율이 낮다 — #900 §4.1 의 A2 논거가 그대로 유효하고, 규모만 2배였다.

---

## 3. 무엇이 바뀌었나

### 3.1 A1 — 역할별 MCP `tools/list` 스코핑

- `v3/electron/mcp-server/tool-surface.ts` — 정책(순수 모듈). 워커 코어 14툴 + 역할별 추가.
- `v3/electron/mcp-server/tools.ts` — `auditedTool` 초크포인트에서 **등록 자체를 건너뛴다**.
  핸들러만 막으면 스키마가 `tools/list` 에 남아 절감이 0 이다.
- `v3/electron/agent-config.ts` — MCP 서버 env 에 `MARBLO_AGENT_ROLE` 주입.

**워커 코어 (14)** — 티켓 수명주기 + 읽기 + 보고 + 막힘 경로:
`get_agent_skill` `get_available_tasks` `claim_task` `update_task_status` `submit_for_review`
`get_task` `get_task_activities` `get_task_dependencies` `search_tasks`
`add_activity` `check_feedback` `acknowledge_feedback` `ask_orchestrator` `request_model_escalation`

**역할별 추가**: `merge` → `merge_and_close` `get_worktree_audit` `list_worktree_audit` ·
`devops` → `get_agents` `get_ledger_spool_status`

**제거되는 30개**는 전부 오케스트레이터 전용이다 (dispatch/spawn/reuse/kill/cleanup, create/delete task,
flow, pending-instruction, answer_question, mission, telegram, routing/model-guidance, worktree audit…).

**★fail-open 이 이 설계의 핵심 안전장치다.** 스코핑은 "이 세션이 워커임을 확실히 알 때"만 켠다:

| 상황                                | 표면   |
| ----------------------------------- | ------ |
| `MARBLO_AGENT_ROLE` 미설정          | 전체   |
| 역할이 `orchestrator`/`team_leader` | 전체   |
| agentId 가 `orchestrator-` 로 시작  | 전체   |
| **정책에 없는 역할**(예: `qa`)      | 전체   |
| 알려진 워커 역할                    | 스코핑 |

새 역할을 정책에 넣는 걸 잊으면 손해는 "절감을 못 본다"뿐이고, 잘못 넣으면 손해는 "능력을 잃는다"다.
비대칭이 크므로 목록은 **관측된 역할로만** 유지한다(`backend` `frontend` `test` `devops` `merge` `flutter`).

### 3.2 A2/A3 — 메모리·스킬 주입 축소

`v3/electron/prefix-diet.ts` (신규, 순수 모듈) 가 세 노브의 on/off 단일 소스다.
워커 claude 스폰에서:

- A2 → `--settings` JSON 에 `autoMemoryEnabled:false` 를 **머지**
- A3 → `--disable-slash-commands` (기본 OFF)

★`--settings` 는 단일 값 옵션이라 두 번 넘기면 마지막만 남는다. 텔레그램 플러그인 차단
(`pyp7odpPQ6emCWLmUrBz`)과 반드시 한 객체로 합쳐야 하고, 그 회귀를 `prefix-diet.test.ts` 가 고정한다.

### 3.3 ★A3 는 왜 기본 OFF 인가

11.8K 로 두 번째로 큰 레버인데도 켜지 않았다. 셋 중 유일하게 **조용한** 능력 손실을 낼 수 있어서다:
워커가 `/browse`·`/investigate`·superpowers TDD 같은 스킬을 지시받았을 때, 그 스킬이 "권한 없음"이 아니라
**아예 존재하지 않게** 된다. 실패가 "툴 없음"이 아니라 "그 워커가 왜인지 일을 못 끝냄"으로 나타난다.

A1+A2 만으로 이미 #900 의 목표 감축률(부트의 42%)에 준하는 30.2% 를 확보했으므로, A3 는
**A1·A2 무회귀 확인 뒤 켜는 2단계**로 남긴다. 켜는 방법은 env 한 줄이다.

---

## 4. 롤백

| env                        | 값     | 효과                                    |
| -------------------------- | ------ | --------------------------------------- |
| `MARBLO_PREFIX_DIET`       | `off`  | **전면 롤백** — argv/env 가 이전과 동등 |
| `MARBLO_TOOL_SURFACE`      | `full` | A1 만 끄기                              |
| `MARBLO_WORKER_AUTOMEMORY` | `on`   | A2 만 끄기                              |
| `MARBLO_WORKER_SKILLS`     | `off`  | A3 **켜기**(기본은 적용 안 함)          |

앱 재시작이면 반영된다 — 배포된 빌드를 되돌릴 필요가 없다.
스코핑된 세션은 부팅 시 stderr 에 남는다(어떤 툴이 왜 안 보이는지 라이브에서 즉시 판별):

```
[MCP] tools/list scoped: role=backend reason=worker role exposed=14 hidden=30 (rollback: MARBLO_TOOL_SURFACE=full)
```

---

## 5. 아직 안 잰 것 · 후속

- **(A) codex/grok 워커의 A1 절감.** 격리 `CODEX_HOME` 에서 marblo MCP 가 붙지 않아 `codex exec` 의
  `usage.input_tokens` 가 MCP 없는 baseline 과 구분되지 않았다(14,185 vs 14,398 vs bare 14,403 — 노이즈 범위).
  **A1 의 실질 가치가 여기 달려 있으므로 다음 스파이크의 1번 항목이다.**
- **(B) 총비용 절감 실측.** 이 문서의 A/B 는 **요청 단위**다. 총비용 효과는 배포 후 `cost_logs` 에서
  `claude-opus-5` 의 에이전트별 최소 단일-폴 `cache_read` p50 이 **105,733 에서 내려가는지**로 판정한다
  (#900 §7.2 의 단일 판정 지표). 프리픽스 −30.2% 를 #900 의 모델에 넣으면
  `30.2% × 31~63% × 59.8% ≈ 총비용 5.6~11.4%` + `cache_write` 동반분이지만, 이건 **추정이고 실측이 아니다.**
- **(C) 메모리 제거의 함정 회귀.** #900 §4.1 이 경고한 대로, 워커가 과거 함정을 모른 채 같은 실수를 반복할
  수 있다. 프로젝트 `CLAUDE.md` 는 auto-memory 와 별개 경로라 그대로 살아있지만(핵심 규칙 보존), 완화책으로
  **역할 스킬 안에 압축된 상시 주의사항**을 넣는 것이 다음 후보다. 내용을 지어내지 않으려고 이번엔 안 했다.
- **(D) 배포 직후 1회성 `cache_write` 스파이크.** 프리픽스가 바뀌면 기존 세션 캐시가 한 번 깨진다.
  #900 §5 실측대로 재수립 비용 상한은 총비용의 1.4% 라 무시 가능하다.

---

## 부록 — 재현

부트 프리픽스 A/B:

```bash
# marblo MCP 만 물린 config 를 만들고(역할 env 유무로 A/B), 워커 argv 를 재현한다.
claude -p "Reply with exactly: OK" --dangerously-skip-permissions --model claude-opus-5 \
  --strict-mcp-config --mcp-config ./mcp-worker.json --output-format json \
  | python3 -c "import json,sys; u=json.load(sys.stdin)['usage']; \
      print(u['input_tokens']+u['cache_read_input_tokens']+u['cache_creation_input_tokens'])"
```

역할별 `tools/list` 표면:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | MARBLO_AGENT_ROLE=backend node v3/dist-mcp/index.js 2>/dev/null \
  | jq -c 'select(.id==2)' | jq -r '.result.tools|length, (tojson|length)'
```

지연 로딩 확인: `--debug-file ./dbg.log` 후 `grep "deferred tools included" dbg.log`.

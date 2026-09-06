# Agent reconnect harness diagnosis (2026-09-06)

Ticket: `xtUscc01FKq85V3TA9AN`

## 판정

재시작 전 CLI 프로세스가 살아남는 경로는 없다. `app.before-quit` 에서
`agentManager.stopAll()` 과 `ptyManager.killAll()` 을 호출하므로, 재시작 후
"붙었다"는 것은 기존 프로세스 보존이 아니라 새 프로세스 relaunch + CLI resume
경험이다.

11:35 직후 오케 실측의 "재시작 전 스폰된 CLI 프로세스 0개"는 코드와 일치한다.
당시 보드의 gpt 4기 `working` 표시는 프로세스 생존의 근거가 아니다. 보드 상태는
PTY 바이트와 Firestore 상태에서 파생되며, 종료 상태 write/reclaim이 늦거나
machine-scope skip이 걸리면 실제 프로세스 없이 `working` 이 남을 수 있다.

이후 11:45 비침습 확인에서는 이 워크트리에 붙은 `codex resume --last` 4개가
실제로 존재했다. 따라서 이번 관측은 다음처럼 분리된다.

- 11:35 직후: gpt 4기 보드 표시는 유령으로 볼 수 있다. 실제 CLI 프로세스는 없었다.
- 11:35:19 이후: `agent:reconnect` 가 gpt/codex 에이전트들을 새로 띄워
  `codex resume --last` 로 붙였을 가능성이 크다.
- Claude 워커가 같은 재시작에서 왜 relaunch/resume 되지 않았는지는 실제 재시작 없이
  확정하지 못했다. 코드상 취약점은 Claude 워커만 per-agent isolated home sentinel
  이 아니라 `~/.claude/projects/<cwd>/marblo-labels.json` 또는 name/id-scoped scan에
  의존한다는 점이다.

## 하네스 x 벤더

| 요청명 | registry provider | launch harness | resume 계약 |
| --- | --- | --- | --- |
| `claude` | `anthropic` | `claude` | fresh agent는 `--session-id <uuid>`, resume은 concrete UUID로 `--resume <uuid>`. `latest` 가 unresolved이면 argv에 resume flag를 내지 않는다. |
| `codex` / `gpt` | `openai` | `gpt` (Codex CLI) | `codex resume --last` 또는 `codex resume <uuid>`. unknown concrete id는 fatal. |
| `grok` | `xai` | `grok` | fresh는 `--session-id <uuid>`, concrete resume은 `--resume <uuid>`, latest는 cwd-scoped `--continue`. 빈 cwd 세션에서 `--continue` 는 fatal이므로 hasSavedSession gate 필요. |
| `glm` / `zai` | `zai` | `claude` | Claude 하네스에 `ANTHROPIC_BASE_URL` / token env-swap. resume 계약은 Claude와 동일. |
| `minimax` | `minimax` | `claude` | Claude 하네스 env-swap. resume 계약은 Claude와 동일. |
| `kimi` | `moonshot` | `claude` | Claude 하네스 env-swap. resume 계약은 Claude와 동일. |
| `solar-pro4` / `solar` | `upstage` | `gpt` | Codex 하네스 OpenAI-compatible env-swap. resume 계약은 Codex와 동일. |
| `deepseek` | `deepseek` | `gpt` | Codex 하네스 OpenAI-compatible env-swap. resume 계약은 Codex와 동일. |

## 코드 근거

- `v3/electron/main.ts`: `before-quit` 에서 `agentManager.stopAll()` 과
  `ptyManager.killAll()` 호출. 기존 worker 프로세스는 앱 재시작을 넘지 못한다.
- `v3/electron/main.ts`: `agent:reconnect` 는 기존 PTY가 없으면 machine ownership을
  확인한 뒤 하네스별 resume id를 계산하고 `agentManager.launch()` 로 새 PTY를 띄운다.
- `v3/electron/agent-config.ts`: `harnessForLaunch()` 는 pinned model registry row의
  `harness` 를 최종 스폰 바이너리로 쓴다. env-swap 벤더는 switch case를 늘리지 않는다.
- `v3/electron/model-registry.ts`: GLM/MiniMax/Kimi는 `harness: "claude"`, Solar/DeepSeek는
  `harness: "gpt"` 로 등록되어 있다.
- `v3/electron/reconnect-manager.ts`: Claude cold-boot resume은 agent-specific label 또는
  name/id-scoped scan이 없으면 `null` 을 반환한다. 이 경우 fresh launch하지 않는다.
- `v3/src/hooks/useAgentReconnect.ts`: `skippedReason === "no-session"` 일 때만 Firestore
  status를 `stopped` 로 동기화한다. `foreign-machine` 등은 공유 계정 보호 때문에 상태를
  건드리지 않는다.

## Claude 경로의 취약 지점

정확한 비교 지점은 `v3/electron/main.ts` 의 `agent:reconnect` resume-id 분기다.

- Claude: `candidate.sessionId` 또는
  `resolveSessionId(rootPath, "latest", agentData.name, agentData.id)` 로 concrete UUID를
  찾아야 한다. 실패하면 `resolveClaudeColdBootResumeId()` 가 `null` 을 반환하고
  `no-session` skip이 된다.
- Codex/Gemini/Grok: per-agent isolated home에 세션 파일이 있으면 concrete UUID 없이
  `"latest"` sentinel을 넘긴다. Codex는 `resume --last`, Grok은 `--continue` 로 CLI가
  직접 고른다.

즉 Claude만 "agent id -> saved session" O(1) store가 없다. label write가 유실되거나
session JSONL name/id scan이 매칭하지 못하면 Claude만 끊겨 보일 수 있다. 다만 이번
재시작에서 그 실패가 실제로 발생했는지는 재시작 직후의 `agent:reconnect` 결과와
`~/.claude/projects/<encoded-cwd>/marblo-labels.json` 존재 여부를 봐야 확정된다.

## 다음 재시작 관측 목록

앱을 재시작하지 말고, 다음 자연 재시작 직후 오케가 아래만 확인한다.

1. `agent:reconnect` 결과 로그: 각 agentId별 `reconnected`, `ptySessionId`,
   `skippedReason`, `spawnedModel`.
2. 같은 시각 `ps` + `lsof cwd`: worker cwd에 붙은 `claude`, `codex`, `grok` 프로세스와
   시작 시각.
3. 각 재연결 프로세스 env의 `MARBLO_AGENT_ID`, `CODEX_HOME`, `GROK_HOME`.
4. Claude 대상 worktree의 `~/.claude/projects/<encoded-cwd>/marblo-labels.json` 에
   agentId 매핑이 있는지, 해당 `<session>.jsonl` 이 summary-only가 아닌지.
5. Firestore agent doc의 `machineId`, `instancePid`, `status`, `lastHeartbeatAt`:
   `foreign-machine` 또는 legacy skip이면 보드 상태는 일부러 보존된다.
6. 재시작 60초 뒤 ghost reclaim 로그: own-machine ghost가 `stopped` 로 회수됐는지.


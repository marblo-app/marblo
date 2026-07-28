/**
 * 오케 스폰이 막혔을 때 **무엇을 보여줄지** 를 정하는 순수 규칙.
 *
 * ── 무엇이 틀려 있었나 ───────────────────────────────────────────────────
 * main 은 스폰 차단을 전부 `needsAuth` 라는 한 봉투로 돌려준다. 그런데 관문은
 * 둘이다:
 *   ① 인증      — `checkSpawnAuthGate` (CLI 미설치 / 미로그인 / 벤더키 부재)
 *   ② MCP 가용성 — `checkOrchestratorMcpGate` (#639, grok 한정)
 * 렌더러는 그 봉투를 보면 무조건 CLI 설정 위저드를 열었다. ②로 막힌 사용자는
 * 로그인이 멀쩡하므로 위저드가 "grok 연결됨" 을 보여주고 끝난다 — 화면 어디에도
 * "폴더 신뢰가 없어 marblo MCP 가 안 붙는다" 는 말이 없다. 고를 수는 있는데 왜
 * 안 되는지 알 길이 없는, 활성화 장벽의 전형이다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 * `reason` 이 MCP 표식이면 "mcp", 그 밖(표식 없음 포함)은 종전대로 "auth".
 * 표식이 없을 때 auth 로 떨어지는 것은 **의도된 하위호환**이다 — 구버전 main 이
 * 든 패키지 앱에서도 종전 동작이 한 글자도 안 바뀐다.
 *
 * 표식 문자열은 `electron/orchestrator-switch.ORCHESTRATOR_BLOCK_REASON_MCP` 가
 * 원본이다. `src/` ↔ `electron/` 는 서로 import 하지 않는 repo 규약이라 여기는
 * 미러이고, 벌어지면 `tests/unit/orchestrator-launch-block.test.ts` 가 깨진다
 * (테스트는 두 경계를 다 import 할 수 있다).
 */

/** MCP 가용성으로 막혔다는 표식 — electron/orchestrator-switch 의 미러. */
export const ORCHESTRATOR_BLOCK_REASON_MCP = "mcp-unavailable";

/** main 이 돌려주는 차단 봉투(모양만. 필드 추가에 관대하다). */
export interface OrchestratorNeedsAuth {
  model: string;
  action: string;
  installed: boolean;
  reason?: string;
}

export type OrchestratorBlockKind = "auth" | "mcp";

export interface OrchestratorLaunchBlock {
  kind: OrchestratorBlockKind;
  /** 어떤 CLI 가 막혔나(그대로 표시한다 — 우리가 이름을 지어내지 않는다). */
  model: string;
  /** main 이 준 조치 문구. 사용자가 실제로 할 일이 여기 적혀 있다. */
  action: string;
  /** true 면 CLI 설정 위저드를 연다. false 면 패널이 직접 설명한다. */
  opensCliSetup: boolean;
}

export function classifyOrchestratorBlock(
  needsAuth: OrchestratorNeedsAuth,
): OrchestratorLaunchBlock {
  const kind: OrchestratorBlockKind =
    needsAuth.reason === ORCHESTRATOR_BLOCK_REASON_MCP ? "mcp" : "auth";
  return {
    kind,
    model: needsAuth.model,
    action: needsAuth.action,
    opensCliSetup: kind === "auth",
  };
}

/**
 * 오케 스폰이 막혔을 때 **무엇을 보여줄지** 를 정하는 순수 규칙.
 *
 * ── 무엇이 틀려 있었나 ───────────────────────────────────────────────────
 * main 은 스폰 차단을 전부 `needsAuth` 라는 한 봉투로 돌려준다. 그런데 관문은
 * 셋이다:
 *   ① 인증      — `checkSpawnAuthGate` (CLI 미설치 / 미로그인 / 벤더키 부재)
 *   ② MCP 가용성 — `checkOrchestratorMcpGate` (#639, grok 한정)
 *   ③ 벤더 잔액  — `checkOrchestratorVendorGate` (7HthjBEf, DeepSeek 한정)
 * 렌더러는 그 봉투를 보면 무조건 CLI 설정 위저드를 열었다. ②로 막힌 사용자는
 * 로그인이 멀쩡하므로 위저드가 "grok 연결됨" 을 보여주고 끝난다 — 화면 어디에도
 * "폴더 신뢰가 없어 marblo MCP 가 안 붙는다" 는 말이 없다. 고를 수는 있는데 왜
 * 안 되는지 알 길이 없는, 활성화 장벽의 전형이다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 * `reason` 이 MCP 표식이면 "mcp", 벤더 표식이면 "vendor", 그 밖(표식 없음 포함)은
 * 종전대로 "auth".
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

/**
 * 벤더 크레덴셜·잔액으로 막혔다는 표식 — 같은 파일의 미러(2026-08-21, 7HthjBEf).
 *
 * DeepSeek 오케는 선불 잔액으로 돈다. 잔액 0·키 없음·401·네트워크 넷 중 무엇으로
 * 막히든 **로그인으로는 하나도 안 풀린다** — 표식 없이 흘리면 아래 classify 가
 * "auth" 로 읽어 CLI 로그인 위저드를 열고, 사용자는 "Codex 연결됨" 만 보고 끝난다.
 * MCP 축이 이미 겪은 실패모드와 같은 모양이라 같은 방식으로 가른다.
 */
export const ORCHESTRATOR_BLOCK_REASON_VENDOR = "vendor-credential";

/** main 이 돌려주는 차단 봉투(모양만. 필드 추가에 관대하다). */
export interface OrchestratorNeedsAuth {
  model: string;
  action: string;
  installed: boolean;
  reason?: string;
}

export type OrchestratorBlockKind = "auth" | "mcp" | "vendor";

export interface OrchestratorLaunchBlock {
  kind: OrchestratorBlockKind;
  /** 어떤 CLI 가 막혔나(그대로 표시한다 — 우리가 이름을 지어내지 않는다). */
  model: string;
  /** main 이 준 조치 문구. 사용자가 실제로 할 일이 여기 적혀 있다. */
  action: string;
  /** true 면 CLI 설정 위저드를 **함께** 연다(패널 배너를 대신하지 않는다). */
  opensCliSetup: boolean;
  /** 설치는 돼 있나 — 로그인 CTA 를 걸어도 되는지의 전제. */
  installed: boolean;
}

export function classifyOrchestratorBlock(
  needsAuth: OrchestratorNeedsAuth,
): OrchestratorLaunchBlock {
  const kind: OrchestratorBlockKind =
    needsAuth.reason === ORCHESTRATOR_BLOCK_REASON_MCP
      ? "mcp"
      : needsAuth.reason === ORCHESTRATOR_BLOCK_REASON_VENDOR
        ? "vendor"
        : "auth";
  return {
    kind,
    model: needsAuth.model,
    action: needsAuth.action,
    opensCliSetup: kind === "auth",
    installed: needsAuth.installed,
  };
}

/**
 * 차단 봉투 → **화면 지시**. 호출부(패널 launch/switch, 자동기동 훅)는 전부 이
 * 함수를 거친다.
 *
 * ── 무엇이 틀려 있었나 (라이브 버그 d44PLFhR) ──────────────────────────
 * 종전 호출부는 `if (opensCliSetup) 위저드 else 패널배너` 라는 **배타 분기**였다.
 * 그래서 인증 차단은 전적으로 위저드에 맡겨졌는데, 위저드의 재오픈 가드
 * (`cliSetupGate.shouldOpenGateOnReopen`)는 "claude/codex 중 하나라도 준비됐나"
 * (`ORCHESTRATOR_CLI_IDS`) 하나만 본다. claude 가 멀쩡한 사용자가 **grok** 오케로
 * 전환하려다 grok 미로그인으로 막히면 requiredReady=true 라 위저드가 스스로를
 * 억제하고 — 배타 분기 탓에 패널도 침묵한다. 화면에 아무 일도 안 일어난다.
 *
 * 위저드의 그 가드는 그 자체로는 옳다(재시작마다 뜨던 유령 팝업을 막는 장치다).
 * 틀린 건 "위저드가 열릴 것" 이라고 넘겨짚고 패널이 입을 닫은 쪽이다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 * **패널 배너는 모든 차단에서 뜬다.** 위저드는 그 위에 얹히는 보조 표면이다.
 * 이 불변식이 "고를 수는 있는데 왜 안 되는지 모른다" 를 구조적으로 없앤다.
 */
export interface OrchestratorBlockUiPlan {
  block: OrchestratorLaunchBlock;
  /** 항상 true — 무음 차단을 코드로 금지한다. */
  showPanelNotice: boolean;
  /** 인증 축일 때만. 열려도 패널 배너를 대체하지 않는다. */
  openCliSetup: boolean;
}

export function planOrchestratorBlockUi(
  needsAuth: OrchestratorNeedsAuth,
): OrchestratorBlockUiPlan {
  const block = classifyOrchestratorBlock(needsAuth);
  return {
    block,
    showPanelNotice: true,
    openCliSetup: block.opensCliSetup,
  };
}

/**
 * 배너가 쓸 i18n 키. kind 별로 갈린다 — MCP 문구("폴더 신뢰를 확인하세요")가
 * 로그인 차단에 새면 사용자를 정확히 반대 방향으로 보낸다. 이 repo 는 같은 종류의
 * 사고를 이미 한 번 겪었다(grok 행이 Antigravity 설명을 달고 있던 #642).
 */
export function orchestratorBlockCopyKeys(kind: OrchestratorBlockKind): {
  title: string;
  hint: string;
} {
  if (kind === "mcp") {
    return {
      title: "orchestrator.blocked.mcpTitle",
      hint: "orchestrator.blocked.mcpHint",
    };
  }
  if (kind === "vendor") {
    // ★문구가 로그인·폴더신뢰 어느 쪽으로도 새면 안 된다. 이 축의 조치는
    // "충전 / 키 등록 / 네트워크 확인" 셋뿐이고, **어느 것인지는 main 이 준
    // `action` 한 줄이 말한다**(배너가 그 줄을 그대로 그린다). 여기 hint 는 그
    // 위에 얹는 공통 맥락 — "이건 로그인 문제가 아니다" 를 먼저 못박는다.
    return {
      title: "orchestrator.blocked.vendorTitle",
      hint: "orchestrator.blocked.vendorHint",
    };
  }
  return {
    title: "orchestrator.blocked.authTitle",
    hint: "orchestrator.blocked.authHint",
  };
}

/**
 * 배너에 원클릭 로그인 CTA 를 걸 CLI — 걸 수 없으면 null.
 *
 * `cliSetupStore.CliModel` 과 같은 값 집합이지만 그 모듈을 import 하지 않는다(이
 * 파일은 순수 규칙만 담는다). 값이 벌어지면 아래 배열이 단일소스다.
 *
 * CTA 를 **거는** 조건은 셋 다 참일 때뿐이다:
 *   ① 인증 축이다      — MCP 차단은 로그인으로 안 풀린다.
 *   ② 설치돼 있다      — 미설치면 로그인이 아니라 설치가 먼저다(문구가 그렇게 온다).
 *   ③ 아는 CLI 다      — 모르는 이름으로 로그인 터미널을 띄우지 않는다.
 */
const LOGIN_CTA_MODELS = ["claude", "codex", "grok", "antigravity"] as const;

export type OrchestratorBlockLoginModel = (typeof LOGIN_CTA_MODELS)[number];

export function orchestratorBlockLoginModel(
  block: OrchestratorLaunchBlock,
): OrchestratorBlockLoginModel | null {
  // ①은 이제 "auth 축인가" 로 읽는다 — MCP 도 벤더도 로그인으로 안 풀린다.
  if (block.kind !== "auth" || !block.installed) return null;
  const match = LOGIN_CTA_MODELS.find((m) => m === block.model);
  return match ?? null;
}

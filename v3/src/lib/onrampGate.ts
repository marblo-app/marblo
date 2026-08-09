import {
  classifyOrchestratorBlock,
  type OrchestratorNeedsAuth,
} from "./orchestratorLaunchBlock";

/**
 * M1 — "여기까지는 무료로 볼 수 있어요" 의 **판정 규칙**
 * (설계: v3/docs/onramp-ladder-design-2026-08-09.md §5-A).
 *
 * ── 무엇이 틀려 있었나 ───────────────────────────────────────────────────
 * 실행 게이팅은 **이미 있다**. `electron/main.ts` 의 `checkSpawnAuthGate` 가
 * 워크트리·PTY 부수효과가 나기 **전에** 스폰을 막고 `needsAuth` 를 돌려준다.
 * 부족한 건 게이트가 아니라 **그 게이트가 아무 말도 안 한다는 것**이다:
 * 그 봉투를 해석하는 화면은 AgentsTab · LanesTab · OrchestratorPanel ·
 * useAgentReconnect 넷뿐이고, 그중 **비기너 셸은 하나도 없다**(설계 §4-G).
 * 그래서 L0 유저에게 이 차단은 화면을 하나도 만들지 않는다 — 눌렀는데 아무 일도
 * 안 일어나는, 활성화 장벽의 전형이다.
 *
 * 이 파일은 그러므로 **새 게이트가 아니라 이미 있는 게이트의 목소리**다.
 *
 * ── 왜 순수 모듈인가 ────────────────────────────────────────────────────
 * `orchestratorLaunchBlock.ts` 와 같은 이유다. 그 파일은 "인증 축 문구가 MCP 축에
 * 새면 유저를 정반대로 보낸다" 는 사고를 한 번 겪고 규칙을 순수 모듈로 떼어
 * 놓았다. M1 도 같은 종류의 실수를 할 수 있는 자리다 — MCP 로 막힌 유저(로그인은
 * 멀쩡한 사람)에게 "계정을 연결하세요" 를 띄우면 정확히 반대로 안내하게 된다.
 * 그래서 판정은 여기서 하고, 화면은 결과만 그린다.
 */

/** M1 이 뜬 계기 — 계측(`onramp:exec_blocked`)의 `trigger` 축이 된다. */
export type OnrampBlockTrigger =
  /** 데모 티켓의 "실행/에이전트 배정" 클릭. */
  | "demo_ticket_run"
  /** 오케 자동기동·수동 실행이 `needsAuth` 로 되돌아왔다. */
  | "spawn_needs_auth"
  /** 분해 한도 소진 — 한도 도달 자체가 전환 트리거다(설계 §4-F). */
  | "decompose_limit";

export interface OnrampBlockContext {
  /** 지금 몇 층인가 — `cliSetupStore.ready` 가 false 면 L0. */
  ready: boolean;
  /** 이 세션에서 M1 을 이미 몇 번 띄웠나. */
  shownThisSession: number;
}

/**
 * 세션당 재노출 상한 [설계 §5-A 제안값]. 1회는 놓치기 쉽고 3회는 조르는 것이다.
 */
export const ONRAMP_BLOCK_SESSION_LIMIT = 2;

export interface OnrampBlockPlan {
  /** 모달을 띄우는가. */
  show: boolean;
  /** 안 띄운다면 왜 — 계측·테스트가 읽는 사유 코드. */
  suppressedReason?: "already_ready" | "mcp_axis" | "session_limit";
  /** 어떤 CLI 가 막았나. 우리가 이름을 지어내지 않고 그대로 표시한다. */
  model: string;
  /** 설치는 돼 있나 — CTA 문구가 "연결하기" vs "설치하고 연결하기" 로 갈린다. */
  installed: boolean;
  trigger: OnrampBlockTrigger;
}

/**
 * `needsAuth` 봉투(또는 우리가 직접 만든 차단 사유) → 화면 지시.
 *
 * 규칙 셋(위에서부터 이긴다):
 *  1. 이미 `ready` 다 → 안 띄운다. 이 모달은 **연결 안 된 사람**의 것이다.
 *     (ready 인데 안 도는 것은 자금 축이고, 그건 M2=SubscriptionNeededModal 몫이다 —
 *      두 모달이 같은 상태에서 겹치면 유저는 서로 다른 두 지시를 동시에 받는다.)
 *  2. MCP 축으로 막혔다 → 안 띄운다. 로그인으로 안 풀리는 차단이다.
 *  3. 세션 상한을 넘겼다 → 안 띄운다.
 */
export function planOnrampBlockUi(
  needsAuth: OrchestratorNeedsAuth,
  trigger: OnrampBlockTrigger,
  ctx: OnrampBlockContext,
): OnrampBlockPlan {
  const block = classifyOrchestratorBlock(needsAuth);
  const base = {
    model: block.model,
    installed: block.installed,
    trigger,
  };
  if (ctx.ready) {
    return { ...base, show: false, suppressedReason: "already_ready" };
  }
  if (block.kind === "mcp") {
    return { ...base, show: false, suppressedReason: "mcp_axis" };
  }
  if (ctx.shownThisSession >= ONRAMP_BLOCK_SESSION_LIMIT) {
    return { ...base, show: false, suppressedReason: "session_limit" };
  }
  return { ...base, show: true };
}

/**
 * 모달 본문의 CTA1 문구 키. 미설치면 "설치하고 연결하기" 로 바뀐다 —
 * 안 깔린 CLI 에 "연결하기" 를 걸면 유저는 없는 로그인 화면을 찾게 된다.
 */
export function onrampBlockCtaKey(installed: boolean): string {
  return installed ? "onramp.block.cta.connect" : "onramp.block.cta.install";
}

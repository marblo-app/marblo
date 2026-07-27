import type { Agent } from "../../types/agent";

/**
 * 한도(Rate limit) 패널이 그릴 **행 목록**을 세우는 순수 로직.
 *
 * ── ★왜 하네스축이 아니라 벤더축인가 ──────────────────────────────────────
 * 한도는 **벤더 계정**의 사실이다. 우리 `claude` 바이너리 하나가 Anthropic·Z.ai·
 * MiniMax·Kimi 넷을 띄우므로(env-swap), 하네스로 행을 세우면 서로 다른 네 개의
 * 쿼터가 "Claude Code" 한 칸에 겹쳐 보인다. 그래서 벤더를 알 수 있으면 벤더로,
 * 모르면(모델 근거가 없는 에이전트) 하네스로만 행을 세운다.
 *
 * ── ★수치는 조회 가능한 벤더만 ────────────────────────────────────────────
 * 오늘 계정 단위 한도를 **실제로 조회하는 경로**는 `usage:accountRateLimits`
 * 하나이고, 그것이 돌려주는 키는 정확히 `claude`(Anthropic 구독 헤드리스 프로브)와
 * `gpt`(codex rollout 의 rate_limits) 둘뿐이다. 나머지 벤더(Z.ai/MiniMax/Kimi/
 * xAI/Google)는 잔여 쿼터 공개 API 자체가 없다 — 근거는 `lib/vendorBilling.ts`
 * 상단의 1차 문서 전수조사다.
 *
 * 그래서 이 모듈은 행마다 `source` 를 함께 돌려준다. `"unavailable"` 인 행에는
 * UI 가 게이지를 그리지 않고 "조회불가(벤더 미제공)" 로 **비운다** — 없는 수치를
 * 0% 나 100% 로 채우면 그건 우리가 만든 숫자다.
 */

/** 설치 감지된 CLI 패키지 id → 하네스. */
export const CONNECTED_RATE_LIMIT_PACKAGES: Record<string, Agent["model"]> = {
  "cli-claude-code": "claude",
  "cli-codex": "gpt",
};

/**
 * 계정 한도를 **실제로 조회하는** 하네스 → 그 프로브가 대표하는 벤더.
 *
 * 키가 곧 `usage:accountRateLimits` 응답의 필드명이다(claude / gpt). 다른 벤더가
 * 조회 API 를 내면 여기 한 줄과 프로브 배선이 같이 늘어난다 — 이 표가 비어 있는
 * 벤더는 UI 가 자동으로 "조회불가" 를 그린다.
 */
export const ACCOUNT_PROBE_VENDOR: Readonly<Record<string, string>> = {
  claude: "anthropic",
  gpt: "openai",
};

/** 이 행의 수치를 어디서 얻는가. `unavailable` = 벤더가 조회 API 를 안 준다. */
export type RateLimitQuotaSource = "account-probe" | "unavailable";

export interface RateLimitRow {
  /** React key + 정렬 안정성용. 벤더를 알면 벤더 id, 모르면 `harness:<id>`. */
  key: string;
  /** 벤더 id. 빈 문자열 = 모델 근거가 없어 벤더를 특정하지 못했다. */
  vendor: string;
  /** 이 벤더를 띄운 하네스들(첫 관측 순서). 라벨·아이콘·설명 문구에 쓴다. */
  harnesses: string[];
  /** 수치를 읽어올 계정 프로브 키(claude/gpt). 없으면 null. */
  probe: "claude" | "gpt" | null;
  source: RateLimitQuotaSource;
}

/** 한 에이전트가 이 패널에 기여하는 사실: 무엇으로 떴고(하네스) 어디에 붙었나. */
export interface RateLimitAgentFact {
  harness: string;
  /** `usageBreakdown.mapAgentsToModels` 가 해석한 벤더. 모르면 "unknown"/빈값. */
  vendor?: string;
}

function isKnownVendor(vendor?: string): boolean {
  const v = (vendor ?? "").trim().toLowerCase();
  return Boolean(v) && v !== "unknown";
}

/**
 * 패널 행 목록.
 *
 * 정렬: 수치를 그릴 수 있는 행(계정 프로브 보유)이 먼저, 그 안에서는 첫 관측
 * 순서를 보존한다 — 실측이 있는 칸이 위에 있어야 화면이 정직하게 읽힌다.
 */
export function buildRateLimitRows(input: {
  connectedModels: readonly string[];
  agents: readonly RateLimitAgentFact[];
}): RateLimitRow[] {
  const rows = new Map<string, RateLimitRow>();

  const upsert = (vendor: string, harness: string) => {
    const key = isKnownVendor(vendor)
      ? vendor.trim().toLowerCase()
      : `harness:${harness}`;
    let row = rows.get(key);
    if (!row) {
      const probeHarness = Object.keys(ACCOUNT_PROBE_VENDOR).find(
        (h) => ACCOUNT_PROBE_VENDOR[h] === key,
      ) as "claude" | "gpt" | undefined;
      row = {
        key,
        vendor: isKnownVendor(vendor) ? key : "",
        harnesses: [],
        probe: probeHarness ?? null,
        source: probeHarness ? "account-probe" : "unavailable",
      };
      rows.set(key, row);
    }
    if (harness && !row.harnesses.includes(harness))
      row.harnesses.push(harness);
  };

  // 설치된 CLI 는 에이전트가 하나도 없어도 보여야 한다(로그인만 되어 있으면
  // 계정 프로브가 실수치를 준다). 이 하네스들의 벤더는 네이티브 = 프로브 벤더다.
  for (const harness of input.connectedModels) {
    upsert(ACCOUNT_PROBE_VENDOR[harness] ?? "", harness);
  }

  for (const agent of input.agents) {
    if (isKnownVendor(agent.vendor)) upsert(agent.vendor ?? "", agent.harness);
  }

  // ★벤더를 모르는 에이전트는 **행을 새로 만들지 않는다** — 그 하네스가 이미
  // 어떤 행에 서 있다면(설치된 CLI 든, 벤더가 밝혀진 형제 에이전트든) 새 칸은
  // 정보를 더하지 않고 같은 CLI 를 두 번 세울 뿐이다. 모델 근거 없는 claude
  // 에이전트(오케 기본 경로)가 "Claude" 옆에 "Claude Code 조회불가" 를 하나 더
  // 만드는 것이 그 경우다. 아무 행에도 없는 하네스일 때만 하네스 전용 행을 연다.
  for (const agent of input.agents) {
    if (isKnownVendor(agent.vendor) || !agent.harness) continue;
    const seen = [...rows.values()].some((r) =>
      r.harnesses.includes(agent.harness),
    );
    if (!seen) upsert("", agent.harness);
  }

  return [...rows.values()].sort((a, b) => {
    const ap = a.source === "account-probe" ? 0 : 1;
    const bp = b.source === "account-probe" ? 0 : 1;
    return ap - bp;
  });
}

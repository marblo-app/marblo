/**
 * ②단계(인증)의 **BYOM 대안** — "Claude/Codex 계정이 없어도 시작하는 길" 을 세우는
 * 순수 규칙.
 *
 * ── 무엇이 막혀 있었나 ───────────────────────────────────────────────────
 * 온보딩 ②단계의 통과 조건은 `requiredReady` 하나였고 그 뜻은 "Claude **또는**
 * Codex 계정이 연결됨"(#579 `.some`)이다. 그 사이 레지스트리엔 Grok(네이티브
 * 하네스)·GLM·MiniMax·Kimi(env-swap)가 들어왔지만, 온보딩 ②단계엔 그 벤더로
 * 시작하는 길이 아예 없었다 — 두 계정 중 아무것도 없는 사용자(해외·BYOM 유입의
 * 기본형)는 ②단계에서 영구히 멈춘다. 클린룸 최초실행 E2E(#633)가 잡은 F4 다.
 *
 * ── 이 파일이 계산하는 것 ────────────────────────────────────────────────
 * 벤더 목록·상태는 #632 의 `vendorOnboarding.vendorSetupCards` 가 이미 레지스트리
 * 파생으로 만든다. 여기서 얹는 축은 **하나**다:
 *
 *   canHostOrchestrator — 이 벤더로 **오케스트레이터까지** 띄울 수 있는가.
 *
 * 이 축이 왜 필요한가: 온보딩 ③④단계(폴더 연결 → 첫 티켓)는 전부 오케스트레이터를
 * 거친다. 워커로만 쓸 수 있는 벤더로 ②단계를 "통과" 시키면 화면만 넘어가고 ④단계에서
 * 다시 막힌다 — 그건 대안이 아니라 거짓말이다. 그래서 ②단계를 대신 만족시키는 것은
 * **오케를 태울 수 있는 BYOM 경로가 실제로 준비됐을 때** 뿐이다.
 *
 * ── 그 판정을 무엇으로 하나(★리터럴 금지) ────────────────────────────────
 * "이 벤더가 오케가 될 수 있나" 는 우리 취향이 아니라 **오케 셀렉터가 실제로 세우는
 * 칸 목록**(`orchestratorStore.ORCHESTRATOR_MODEL_OPTIONS`)이 정하는 사실이다. 그
 * 목록은 `electron/model-selection.selectorEligible` 파생이고, 두 곳이 벌어지면
 * `tests/unit/orchestrator-model-options.test.ts` 가 깨진다. 그래서 여기엔 벤더 id 가
 * 하나도 없고, 메인 프로세스가 오케 후보를 넓히는 날 이 파일은 한 줄도 안 바꾸고
 * 판정이 저절로 참이 된다(반대로 오늘 못 하는 것을 미리 참이라고 말하지도 않는다).
 */

import type { VendorSetupCard } from "./vendorOnboarding";

/** BYOM 대안 한 칸 = #632 카드 + "오케까지 태울 수 있나" 한 축. */
export interface ByomOption extends VendorSetupCard {
  /**
   * 이 벤더의 모델 중 하나라도 오케 셀렉터 칸으로 서 있는가.
   * false 면 이 벤더는 **워커(디스패치) 전용** 이고, ②단계를 대신 만족시키지 못한다.
   */
  canHostOrchestrator: boolean;
}

/**
 * 오케 셀렉터 칸 값들에서 **핀된 모델 id** 만 뽑는다.
 * 값 포맷은 `harness[:modelId][@effort]` 다("claude", "codex:gpt-5.6-terra@high").
 */
export function orchestratorPinnedModelIds(
  optionValues: readonly string[],
): Set<string> {
  const ids = new Set<string>();
  for (const raw of optionValues) {
    const body = raw.split("@")[0] ?? "";
    const sep = body.indexOf(":");
    if (sep < 0) continue;
    const modelId = body.slice(sep + 1).trim();
    if (modelId) ids.add(modelId);
  }
  return ids;
}

/**
 * 모델 접미가 없는 칸의 **하네스 이름**들("claude", "codex", …). 그 칸의 뜻은
 * "이 CLI 를 자기 기본 모델로 띄운다" 다.
 *
 * ★이 축은 **자체 CLI 로 뜨는 벤더에만** 적용된다. env-swap 벤더는 우리 하네스
 * 바이너리를 빌려 쓸 뿐이므로, 하네스 이름이 같다는 이유로 "오케가 될 수 있다" 고
 * 읽으면 정반대의 거짓이 된다 — `claude` 칸은 Anthropic 계정으로 뜨는 칸이지
 * 그 바이너리를 빌려 쓰는 GLM 의 칸이 아니다. 그래서 `canHostOrchestrator` 는
 * 벤더 종류에 따라 다른 축을 본다(아래 참조).
 */
export function orchestratorBareHarnesses(
  optionValues: readonly string[],
): Set<string> {
  const names = new Set<string>();
  for (const raw of optionValues) {
    const body = raw.split("@")[0] ?? "";
    if (body.includes(":")) continue;
    const name = body.trim();
    if (name) names.add(name);
  }
  return names;
}

/**
 * ②단계에 세울 BYOM 대안들.
 *
 * 입력은 #632 의 카드 전체다. 여기서 빼는 것은 두 가지뿐:
 *   - `orchestratorCli` — ①②단계가 이미 그리는 Claude/Codex 행(대안이 아니라 본안).
 *   - 모델 행이 하나도 없는 벤더 — 고를 것이 없는 칸은 안내가 아니라 소음이다.
 * (같은 필터를 `vendorOnboarding.additionalVendorCards` 가 시작하기 탭에서 쓴다.
 *  두 화면이 같은 규칙으로 같은 목록을 세우게 하려고 조건을 복제하지 않고 그
 *  의미를 그대로 재현한다 — 유닛테스트가 두 목록의 동일성을 못박는다.)
 */
export function byomOptions(
  cards: VendorSetupCard[],
  orchestratorOptionValues: readonly string[],
): ByomOption[] {
  const pinned = orchestratorPinnedModelIds(orchestratorOptionValues);
  const bare = orchestratorBareHarnesses(orchestratorOptionValues);
  return cards
    .filter((c) => c.kind !== "orchestratorCli" && c.modelIds.length > 0)
    .map((c) => ({
      ...c,
      // 구체 모델이 칸으로 서 있으면 종류와 무관하게 오케를 태울 수 있다.
      // 거기에 더해 **자체 CLI 벤더**는 "그 CLI 를 기본 모델로 띄우는" 칸으로도
      // 성립한다(그 칸의 주인이 곧 그 벤더다). env-swap 벤더에는 그 축을 주지
      // 않는다 — 하네스를 빌려 쓸 뿐 그 칸의 주인이 아니기 때문이다.
      canHostOrchestrator:
        c.modelIds.some((id) => pinned.has(id)) ||
        (c.kind === "nativeCli" &&
          (bare.has(c.harness) || bare.has(c.command))),
    }));
}

/**
 * BYOM 경로가 온보딩 게이트에 기여하는 값.
 *
 * ★`requiredInstalled`/`requiredReady`(Claude·Codex 축)와 **OR** 로 합쳐진다. 즉
 * 이 값들은 기존 축을 대체하지 않고 "다른 길로도 그 단계를 만족했다" 만 말한다.
 * 오케를 못 태우는 벤더는 어느 필드에도 기여하지 않는다(위 파일 주석 참조).
 */
export interface ByomGateContribution {
  /** ①단계를 대신 만족시키는가 — 오케 가능 BYOM 경로의 실행 준비가 섰나. */
  installed: boolean;
  /** ②단계를 대신 만족시키는가 — 그 경로가 **완전히** 준비됐나. */
  ready: boolean;
}

export function byomGateContribution(
  options: ByomOption[],
): ByomGateContribution {
  const hosts = options.filter((o) => o.canHostOrchestrator);
  return {
    // env-swap 벤더는 "설치" 라는 단계가 없다(우리 하네스 바이너리를 그대로 쓴다) —
    // 키가 서면 그 자체로 실행 준비다. 네이티브 CLI 벤더는 바이너리가 깔려야
    // 하므로 미설치/프로브 전(unknown)은 기여하지 않는다.
    installed: hosts.some((o) =>
      o.kind === "envSwap"
        ? o.status === "ready"
        : o.status === "ready" || o.status === "needsLogin",
    ),
    ready: hosts.some((o) => o.status === "ready"),
  };
}

/**
 * 화면 문구를 고르기 위한 요약. "지금 이 사용자에게 무엇을 말해야 하나" 한 줄로:
 *
 *   ready       — BYOM 만으로 다음 단계로 갈 수 있다.
 *   workerOnly  — 쓸 수 있는 벤더는 있지만 오케는 못 태운다(워커 전용).
 *   setup       — 아직 키/로그인이 필요한 벤더만 있다.
 *   none        — 레지스트리에 붙일 벤더 자체가 없다.
 */
export type ByomHeadline = "ready" | "workerOnly" | "setup" | "none";

export function byomHeadline(options: ByomOption[]): ByomHeadline {
  if (options.length === 0) return "none";
  if (options.some((o) => o.canHostOrchestrator && o.status === "ready")) {
    return "ready";
  }
  if (options.some((o) => o.status === "ready")) return "workerOnly";
  return "setup";
}

/** 헤더 배지용 — 지금 바로 쓸 수 있는 BYOM 벤더 수. */
export function byomReadyCount(options: ByomOption[]): number {
  return options.filter((o) => o.status === "ready").length;
}

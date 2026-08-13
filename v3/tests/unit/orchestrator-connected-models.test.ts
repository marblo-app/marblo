/**
 * 비기너 오케 헤더의 "연결·인증된 모델만" 필터 — 티켓 cmp95TVin64IIlOiFlAC.
 *
 * `src/lib/orchestratorConnectedModels.ts` 가 `useCliSetupStore` 의
 * `states` 스냅샷만으로 정확히 거르는지 확인한다(스토어·DOM 없이 순수함수만).
 */
import { describe, it, expect } from "vitest";
import type { CliState } from "../../src/stores/cliSetupStore";
import {
  connectedOrchestratorModelOptions,
  isOrchestratorModelConnected,
} from "../../src/lib/orchestratorConnectedModels";

function ready(): CliState {
  return { installed: true, authenticated: true, checking: false };
}
function loggedOut(): CliState {
  return { installed: true, authenticated: false, checking: false };
}

describe("orchestratorConnectedModels", () => {
  it("설치+인증 둘 다 된 프로바이더의 모델만 connected 로 본다", () => {
    const states = { "cli-claude-code": ready() };
    expect(isOrchestratorModelConnected("claude", states)).toBe(true);
    expect(isOrchestratorModelConnected("claude:claude-opus-5", states)).toBe(
      true,
    );
    expect(isOrchestratorModelConnected("codex", states)).toBe(false);
  });

  it("설치만 되고 로그인은 안 된 프로바이더는 connected 가 아니다", () => {
    const states = { "cli-codex": loggedOut() };
    expect(isOrchestratorModelConnected("codex", states)).toBe(false);
    expect(isOrchestratorModelConnected("codex:gpt-5.6-sol", states)).toBe(
      false,
    );
  });

  it("프로브 결과가 아예 없는 프로바이더는 connected 가 아니다", () => {
    expect(isOrchestratorModelConnected("grok", {})).toBe(false);
  });

  it("claude 만 연결되면 claude 변형만 목록에 남는다", () => {
    const states = { "cli-claude-code": ready() };
    const options = connectedOrchestratorModelOptions(states, "claude");
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.value === "claude" || o.value.startsWith("claude:")).toBe(true);
    }
  });

  it("claude·codex 둘 다 연결되면 두 그룹 다 남고 grok/antigravity 는 빠진다", () => {
    const states = {
      "cli-claude-code": ready(),
      "cli-codex": ready(),
    };
    const options = connectedOrchestratorModelOptions(states, "claude");
    const values = options.map((o) => o.value);
    expect(values).toContain("claude:claude-opus-5");
    expect(values).toContain("codex:gpt-5.6-sol");
    expect(values).not.toContain("grok");
    expect(values).not.toContain("antigravity");
  });

  it("★현재 선택값은 연결이 끊겨도 목록에서 사라지지 않는다(controlled select 불일치 방지)", () => {
    // 예: 저장된 선택이 grok 인데 이번 세션엔 grok 이 인증돼 있지 않다.
    const states = { "cli-claude-code": ready() };
    const options = connectedOrchestratorModelOptions(states, "grok");
    expect(options.map((o) => o.value)).toContain("grok");
  });

  it("아무 프로바이더도 연결돼 있지 않으면 선택값 하나만 남는다", () => {
    const options = connectedOrchestratorModelOptions({}, "claude");
    expect(options.map((o) => o.value)).toEqual(["claude"]);
  });
});

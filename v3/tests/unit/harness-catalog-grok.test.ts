/**
 * Grok Build 하네스가 **선택 확장**으로 편입됐다는 계약 (uXwZg5Gl).
 *
 * 코덱스 WIP 는 `cli-grok` 을 `category: "required"` 로 넣었었다. 그러면
 *   (a) `uninstallPackage` 의 `category === "required"` 가드가 제거를 막아
 *       선택 확장을 되돌릴 수 없고,
 *   (b) Harness 스토어가 "필수" 로 표시해 미설치 사용자에게 설정이 덜 끝난
 *       것처럼 보인다.
 * 필수 하네스는 오케스트레이터가 실제 후보로 삼는 claude/codex 뿐이다
 * (`ORCHESTRATOR_CLI_IDS`). 이 파일이 그 경계를 고정한다.
 */
import { describe, it, expect } from "vitest";
import { CATALOG } from "../../electron/harness-catalog";
import { ORCHESTRATOR_CLI_IDS, ROWS } from "../../src/stores/cliSetupStore";

describe("harness catalog — Grok Build 편입", () => {
  const grok = CATALOG.find((p) => p.id === "cli-grok");

  it("cli-grok 이 카탈로그에 있고 shell 인스톨러로 붙는다", () => {
    expect(grok).toBeDefined();
    expect(grok!.type).toBe("cli");
    expect(grok!.install.kind).toBe("shell");
    expect(grok!.install.source).toBe("https://x.ai/cli/install.sh");
    expect(grok!.detect.binary).toBe("grok");
  });

  it("★required 가 아니라 recommended 다 — 제거 가능한 선택 확장", () => {
    expect(grok!.category).toBe("recommended");
    // uninstallPackage 의 가드가 보는 값이 정확히 이것이다.
    expect(grok!.category).not.toBe("required");
  });

  it("오케 후보는 여전히 claude/codex 뿐이다(#579 계약 무변경)", () => {
    expect(ORCHESTRATOR_CLI_IDS).toEqual(["cli-claude-code", "cli-codex"]);
    expect(ORCHESTRATOR_CLI_IDS).not.toContain("cli-grok");
  });

  it("온보딩 게이트에서 grok 은 필수도 자동설치도 아니다", () => {
    const row = ROWS.find((r) => r.id === "cli-grok");
    expect(row).toBeDefined();
    expect(row!.required).toBe(false);
    expect(row!.autoInstall).toBe(false);
    // 기존 행은 그대로 — claude 만 required, claude/codex 만 자동설치.
    expect(ROWS.filter((r) => r.required).map((r) => r.id)).toEqual([
      "cli-claude-code",
    ]);
    expect(ROWS.filter((r) => r.autoInstall).map((r) => r.id)).toEqual([
      "cli-claude-code",
      "cli-codex",
    ]);
  });
});

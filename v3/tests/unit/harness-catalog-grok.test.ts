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
 *
 * ★k22rGEgv 갱신: grok 이 **기본 함대**로 편입돼 자동설치 대상이 됐다
 * (`ROWS.autoInstall = true`). 그렇다고 위 경계가 흔들리지는 않는다 — 세 축이
 * 각자 다른 것을 말한다:
 *   autoInstall  묻지 않고 깔아도 되는가        → grok: 예
 *   required     없으면 오케를 못 띄우는가       → grok: 아니오
 *   category     하네스 스토어에서 제거 가능한가 → grok: recommended(가능)
 * 이 셋이 한 값으로 뭉개지는 순간 "자동으로 깔렸는데 지울 수 없는 CLI" 나
 * "grok 만 깔고 준비됨으로 판정 → 스폰 fast-fail" 이 생긴다.
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

  it("★온보딩 게이트에서 grok 은 자동설치이되 필수는 아니다 (k22rGEgv)", () => {
    // 사장님 요구: 기본 함대가 Claude·Codex 2종 → Grok 포함 3종. 두 축이
    // 갈라지는 자리다 — 깔아는 주되(autoInstall), 게이트를 여는 자격은 없다
    // (required=false, 오케 후보도 아님).
    const row = ROWS.find((r) => r.id === "cli-grok");
    expect(row).toBeDefined();
    expect(row!.autoInstall).toBe(true);
    expect(row!.required).toBe(false);
    // required 는 여전히 claude 뿐 — grok 만 깔린 사용자를 "준비됨" 으로
    // 판정하면 스폰이 즉시 fast-fail 한다.
    expect(ROWS.filter((r) => r.required).map((r) => r.id)).toEqual([
      "cli-claude-code",
    ]);
    expect(ROWS.filter((r) => r.autoInstall).map((r) => r.id)).toEqual([
      "cli-claude-code",
      "cli-codex",
      "cli-grok",
    ]);
    // Antigravity 는 계속 완전 옵트인 — 자동설치가 "전부 다" 로 번지지 않는다.
    expect(ROWS.find((r) => r.id === "cli-antigravity")!.autoInstall).toBe(
      false,
    );
  });

  it("★자동설치가 됐다고 카탈로그가 required 로 올라가지는 않는다", () => {
    // 두 플래그는 다른 축이다. 여기를 required 로 올리면 harness-manager 의
    // `category === "required"` 가드가 제거를 막아, 자동으로 깔린 CLI 를
    // 사용자가 되돌릴 수 없게 된다.
    expect(grok!.category).toBe("recommended");
  });
});

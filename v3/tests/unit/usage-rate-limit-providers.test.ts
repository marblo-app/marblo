/**
 * 한도(Rate limit) 패널의 **행 구성** 회귀 가드.
 *
 * 두 가지를 지킨다:
 *   1. 축이 벤더다 — 같은 `claude` 하네스라도 env-swap 벤더는 자기 행을 갖는다.
 *   2. ★수치를 그릴 수 있는 벤더와 없는 벤더가 데이터로 구분된다. 조회 API 가
 *      없는 벤더는 `source: "unavailable"` 로 내려가고 UI 가 "조회불가" 를 그린다
 *      — 가짜 게이지가 생기지 않는다.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PROBE_VENDOR,
  buildRateLimitRows,
} from "../../src/components/usage/rateLimitProviders";

describe("buildRateLimitRows", () => {
  it("에이전트가 없어도 설치된 CLI 는 행을 갖는다(계정 프로브가 실수치를 준다)", () => {
    const rows = buildRateLimitRows({
      connectedModels: ["claude", "gpt"],
      agents: [],
    });
    expect(rows.map((r) => r.vendor)).toEqual(["anthropic", "openai"]);
    expect(rows.every((r) => r.source === "account-probe")).toBe(true);
    expect(rows.map((r) => r.probe)).toEqual(["claude", "gpt"]);
  });

  it("설치 목록에 없어도 실제로 쓴 하네스는 남는다", () => {
    const rows = buildRateLimitRows({
      connectedModels: ["gpt"],
      agents: [{ harness: "antigravity", vendor: "unknown" }],
    });
    expect(rows.map((r) => r.key)).toEqual(["openai", "harness:antigravity"]);
  });

  it("★같은 claude 하네스라도 env-swap 벤더는 별도 행이다", () => {
    const rows = buildRateLimitRows({
      connectedModels: ["claude"],
      agents: [
        { harness: "claude", vendor: "zai" },
        { harness: "claude", vendor: "moonshot" },
        { harness: "claude", vendor: "anthropic" },
      ],
    });
    expect(rows.map((r) => r.key)).toEqual(["anthropic", "zai", "moonshot"]);
    // Anthropic 행은 설치 CLI 로 이미 서 있고, GLM/Kimi 가 그 칸에 섞이지 않는다.
    expect(rows.find((r) => r.key === "anthropic")!.harnesses).toEqual([
      "claude",
    ]);
  });

  it("★조회 API 가 있는 벤더만 수치 소스를 갖는다(나머지는 unavailable)", () => {
    const rows = buildRateLimitRows({
      connectedModels: ["claude", "gpt"],
      agents: [
        { harness: "grok", vendor: "xai" },
        { harness: "claude", vendor: "zai" },
        { harness: "claude", vendor: "minimax" },
        { harness: "claude", vendor: "moonshot" },
      ],
    });
    const bySource = Object.fromEntries(rows.map((r) => [r.key, r.source]));
    expect(bySource).toEqual({
      anthropic: "account-probe",
      openai: "account-probe",
      xai: "unavailable",
      zai: "unavailable",
      minimax: "unavailable",
      moonshot: "unavailable",
    });
    // probe 키는 계정 프로브 응답 필드(claude/gpt)와 정확히 같은 집합이어야 한다.
    for (const row of rows) {
      if (row.source === "account-probe") {
        expect(ACCOUNT_PROBE_VENDOR[row.probe!]).toBe(row.vendor);
      } else {
        expect(row.probe).toBeNull();
      }
    }
  });

  it("수치를 그릴 수 있는 행이 위로 온다", () => {
    const rows = buildRateLimitRows({
      connectedModels: [],
      agents: [
        { harness: "grok", vendor: "xai" },
        { harness: "claude", vendor: "anthropic" },
      ],
    });
    expect(rows.map((r) => r.key)).toEqual(["anthropic", "xai"]);
  });

  it("★모델 근거가 없는 에이전트는 벤더를 지어내지 않고 하네스 행으로 남는다", () => {
    // grok 은 자기 세션 파일이 없어 detectedModelId 가 센티넬이고, 핀도 없으면
    // 벤더를 알 방법이 없다 — 그 상태를 xai 로 승격하면 없는 사실을 만드는 것이다.
    const rows = buildRateLimitRows({
      connectedModels: [],
      agents: [{ harness: "grok" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor).toBe("");
    expect(rows[0].key).toBe("harness:grok");
    expect(rows[0].source).toBe("unavailable");
  });

  it("★근거 없는 에이전트가 이미 선 하네스를 두 번 세우지 않는다", () => {
    // 오케 기본 경로는 모델을 핀하지 않아 벤더가 미상이다. 그 doc 들이 "Claude"
    // 옆에 "Claude Code 조회불가" 를 하나 더 만들면 같은 CLI 가 두 칸이 된다.
    const rows = buildRateLimitRows({
      connectedModels: ["claude"],
      agents: [
        { harness: "claude", vendor: "unknown" },
        { harness: "claude" },
        { harness: "claude", vendor: "zai" },
      ],
    });
    expect(rows.map((r) => r.key)).toEqual(["anthropic", "zai"]);
  });

  it("한 벤더를 여러 하네스가 태우면 하네스 목록이 합쳐진다", () => {
    const rows = buildRateLimitRows({
      connectedModels: [],
      agents: [
        { harness: "gemini", vendor: "google" },
        { harness: "antigravity", vendor: "google" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].harnesses).toEqual(["gemini", "antigravity"]);
  });
});

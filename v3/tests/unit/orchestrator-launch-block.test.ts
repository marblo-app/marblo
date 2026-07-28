/**
 * 스폰 차단 분류 ↔ 메인 프로세스 표식의 **단일소스 게이트**.
 *
 * 렌더러(`src/lib/orchestratorLaunchBlock.ts`)와 메인(`electron/orchestrator-
 * switch.ts`)은 서로 import 하지 않는다(repo 경계 규약). 그래서 표식 문자열은
 * 미러이고, 벌어지면 여기서 깨진다 — 테스트는 두 경계를 다 import 할 수 있다.
 *
 * 이 파일이 깨졌다면 고칠 곳은 테스트가 아니라 미러 상수다.
 */
import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_BLOCK_REASON_MCP as RENDERER_MCP_REASON,
  classifyOrchestratorBlock,
  planOrchestratorBlockUi,
  orchestratorBlockCopyKeys,
  orchestratorBlockLoginModel,
} from "../../src/lib/orchestratorLaunchBlock";
import { ORCHESTRATOR_BLOCK_REASON_MCP as MAIN_MCP_REASON } from "../../electron/orchestrator-switch";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

describe("오케 스폰 차단 분류", () => {
  it("★표식 문자열이 main 과 정확히 같다", () => {
    expect(RENDERER_MCP_REASON).toBe(MAIN_MCP_REASON);
  });

  it("MCP 게이트 차단은 위저드를 열지 않는다 — 패널이 직접 설명한다", () => {
    const block = classifyOrchestratorBlock({
      model: "grok",
      action: "grok 오케 차단 — 폴더 신뢰가 없습니다.",
      installed: true,
      reason: MAIN_MCP_REASON,
    });
    expect(block.kind).toBe("mcp");
    expect(block.opensCliSetup).toBe(false);
    // 조치 문구는 main 이 준 값 그대로 흘린다(우리가 지어내지 않는다).
    expect(block.action).toContain("폴더 신뢰");
    expect(block.model).toBe("grok");
  });

  it("인증 차단은 종전대로 위저드가 받는다", () => {
    const block = classifyOrchestratorBlock({
      model: "claude",
      action: "claude login",
      installed: true,
      reason: "not-authenticated",
    });
    expect(block.kind).toBe("auth");
    expect(block.opensCliSetup).toBe(true);
  });

  it("★표식이 없으면 인증으로 읽는다 — 구버전 main 하위호환", () => {
    // 패키지된 옛 main 은 reason 을 안 보낸다. 그 경로의 동작이 한 글자도
    // 바뀌면 안 된다(설치/로그인 차단이 위저드로 안 가면 화면이 죽는다).
    const block = classifyOrchestratorBlock({
      model: "codex",
      action: "codex login",
      installed: false,
    });
    expect(block.kind).toBe("auth");
    expect(block.opensCliSetup).toBe(true);
  });

  it("모르는 reason 도 인증으로 떨어진다(안전한 기본값)", () => {
    const block = classifyOrchestratorBlock({
      model: "claude",
      action: "무언가",
      installed: true,
      reason: "future-reason-we-do-not-know",
    });
    expect(block.opensCliSetup).toBe(true);
  });
});

/**
 * ★무음 차단 금지 (라이브 버그 d44PLFhR).
 *
 * 종전 호출부는 `opensCliSetup` 이 참이면 위저드에**만** 맡기고 패널 배너를 아예
 * 세우지 않았다. 그런데 위저드의 재오픈 가드(`shouldOpenGateOnReopen`)는
 * "claude/codex 중 하나라도 준비됐나"(`ORCHESTRATOR_CLI_IDS`)만 본다 — claude 가
 * 멀쩡한 사용자가 **grok** 오케로 전환하려다 grok 미로그인으로 막히면
 * requiredReady=true 라 배너가 스스로를 억제하고, 패널도 아무 말을 안 해서 화면엔
 * 정말 아무 일도 일어나지 않는다. 사장님이 본 "그냥 안 됨" 이 정확히 이것이다.
 *
 * 그래서 규칙을 순수 함수로 못박는다: **패널 배너는 모든 차단에서 뜬다.**
 * 위저드는 그 위에 얹히는 보조 표면일 뿐이다.
 */
describe("차단 표면 계획(planOrchestratorBlockUi)", () => {
  it("★인증 차단이어도 패널 배너를 세운다 — 위저드가 억제돼도 화면이 말을 한다", () => {
    const ui = planOrchestratorBlockUi({
      model: "grok",
      action: "grok login",
      installed: true,
      reason: "not-authenticated",
    });
    expect(ui.block.kind).toBe("auth");
    expect(ui.showPanelNotice).toBe(true);
    // 위저드는 종전대로 함께 연다(로그인이 진짜 없는 첫 실행 사용자용).
    expect(ui.openCliSetup).toBe(true);
  });

  it("MCP 차단은 패널만 — 위저드는 풀어줄 수 없다", () => {
    const ui = planOrchestratorBlockUi({
      model: "grok",
      action: "폴더 신뢰를 확인하세요",
      installed: true,
      reason: MAIN_MCP_REASON,
    });
    expect(ui.showPanelNotice).toBe(true);
    expect(ui.openCliSetup).toBe(false);
  });

  it("어떤 봉투가 와도 패널 배너는 항상 뜬다(무음 차단 없음)", () => {
    for (const reason of [
      undefined,
      "not-installed",
      "not-authenticated",
      "vendor-not-configured",
      MAIN_MCP_REASON,
      "future-reason",
    ]) {
      const ui = planOrchestratorBlockUi({
        model: "grok",
        action: "무언가",
        installed: true,
        ...(reason ? { reason } : {}),
      });
      expect(ui.showPanelNotice).toBe(true);
    }
  });
});

describe("차단 배너 문구 키", () => {
  it("kind 별로 다른 문구를 쓴다 — MCP 문구가 인증 차단에 새면 오독이다", () => {
    const auth = orchestratorBlockCopyKeys("auth");
    const mcp = orchestratorBlockCopyKeys("mcp");
    expect(auth.title).not.toBe(mcp.title);
    expect(auth.hint).not.toBe(mcp.hint);
  });

  it("★쓰는 키가 ko/en 두 로케일에 실제로 있다", () => {
    for (const kind of ["auth", "mcp"] as const) {
      const { title, hint } = orchestratorBlockCopyKeys(kind);
      for (const [name, dict] of [
        ["ko", ko],
        ["en", en],
      ] as const) {
        // 키 자체에 점이 들어 있어 toHaveProperty 의 경로 해석을 쓸 수 없다.
        const keys = dict as unknown as Record<string, string>;
        expect(keys[title], `${name}:${title}`).toBeTruthy();
        expect(keys[hint], `${name}:${hint}`).toBeTruthy();
      }
    }
  });
});

describe("차단 배너의 로그인 CTA 대상", () => {
  it("인증 차단이고 아는 CLI 면 그 CLI 로 로그인 터미널을 띄울 수 있다", () => {
    expect(
      orchestratorBlockLoginModel(
        classifyOrchestratorBlock({
          model: "grok",
          action: "grok login",
          installed: true,
        }),
      ),
    ).toBe("grok");
  });

  it("설치조차 안 됐으면 로그인 CTA 를 걸지 않는다 — 설치가 먼저다", () => {
    expect(
      orchestratorBlockLoginModel(
        classifyOrchestratorBlock({
          model: "grok",
          action: "curl -fsSL https://x.ai/cli/install.sh | bash",
          installed: false,
        }),
      ),
    ).toBeNull();
  });

  it("MCP 차단엔 로그인 CTA 가 없다 — 로그인 문제가 아니다", () => {
    expect(
      orchestratorBlockLoginModel(
        classifyOrchestratorBlock({
          model: "grok",
          action: "폴더 신뢰를 확인하세요",
          installed: true,
          reason: MAIN_MCP_REASON,
        }),
      ),
    ).toBeNull();
  });

  it("모르는 CLI 이름이면 CTA 없이 문구만 보여준다", () => {
    expect(
      orchestratorBlockLoginModel(
        classifyOrchestratorBlock({
          model: "some-future-cli",
          action: "무언가 login",
          installed: true,
        }),
      ),
    ).toBeNull();
  });
});

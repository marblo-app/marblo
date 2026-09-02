/**
 * 오케 **정지 사유** 축의 계약 — F-4/F-5/F-6 (검증 티켓 ymRo9BtilQnb48Y5ol68).
 *
 * 이 파일이 못박는 것은 넷이다:
 *   ① 사유 표식이 main(`electron/orchestrator-manager`)과 렌더러
 *      (`src/lib/orchestratorHalt`)에서 **같다**. 둘은 서로 import 하지 않는
 *      경계라 미러이고, 테스트만 두 쪽을 다 import 할 수 있다.
 *   ② ★PTY 원문이 화면으로 나가지 않는다. 아는 표식이 아니면 "unknown" 으로
 *      접히고, main 이 준 문자열은 어떤 경로로도 렌더링 대상이 되지 않는다.
 *   ③ 모든 사유에 **다음 행동** 문구가 ko/en 둘 다 있다. 이 티켓의 요구는
 *      "사유를 띄워라" 가 아니라 "무엇을 해야 하는지 적어라" 였다.
 *   ④ F-6 — 부팅 데드라인이 **스폰 시각** 기준이다(홀드 시작 기준이면 blind
 *      fallback 만큼 늦게 울려 상수 60s 가 실측 70.1s 로 어긋난다).
 */
import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_HALT_REASONS as RENDERER_REASONS,
  ORCHESTRATOR_SPAWN_ERRNOS as RENDERER_SPAWN_ERRNOS,
  classifyOrchestratorHalt,
  orchestratorHaltCopyKeys,
  orchestratorHaltKeepsTerminal,
  orchestratorHaltLoginModel,
  type OrchestratorHaltKind,
} from "../../src/lib/orchestratorHalt";
import {
  ORCHESTRATOR_HALT_REASONS as MAIN_REASONS,
  ORCHESTRATOR_SPAWN_ERRNOS as MAIN_SPAWN_ERRNOS,
} from "../../electron/orchestrator-manager";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

const ALL_KINDS: OrchestratorHaltKind[] = [...RENDERER_REASONS, "unknown"];

describe("정지 사유 표식 — main ↔ 렌더러 미러", () => {
  it("★두 경계의 사유 목록이 원소·순서까지 같다", () => {
    expect([...RENDERER_REASONS]).toEqual([...MAIN_REASONS]);
  });

  it("spawn errno 허용 목록도 경계 양쪽에서 같다", () => {
    expect([...RENDERER_SPAWN_ERRNOS]).toEqual([...MAIN_SPAWN_ERRNOS]);
  });
});

describe("classifyOrchestratorHalt", () => {
  it("error 가 아니면 사유가 없다 — 초록 위에 낡은 사유가 남지 않는다", () => {
    for (const status of ["starting", "running", "stopped"]) {
      expect(
        classifyOrchestratorHalt({ status, reason: "needsAuth" }),
      ).toBeNull();
    }
  });

  it("아는 사유는 그대로, 하네스 id 와 함께 통과시킨다", () => {
    expect(
      classifyOrchestratorHalt({
        status: "error",
        reason: "needsAuth",
        model: "codex",
      }),
    ).toEqual({ kind: "needsAuth", model: "codex" });
  });

  it("사유가 없으면(구버전 main) unknown 으로 접는다 — 그래도 사유는 뜬다", () => {
    expect(classifyOrchestratorHalt({ status: "error" })).toEqual({
      kind: "unknown",
      model: null,
    });
  });

  it("★PTY 발췌가 실려 와도 화면 축으로 새지 않는다", () => {
    // 이 프로젝트는 PTY 원문을 밖으로 내보내지 않는 규약이 있다. 사유 표시를
    // 붙이면서 그 규약을 깨는 가장 쉬운 방법이 "main 이 준 문자열을 그대로
    // 그리는" 것이라, 경계에서 아예 버린다.
    const leak =
      "╭─ Do you trust the contents of this directory? ─╮ /Users/boss/secret";
    const halt = classifyOrchestratorHalt({
      status: "error",
      reason: leak,
      model: leak,
    });
    expect(halt).toEqual({ kind: "unknown", model: null });
    // 그리고 unknown 문구 어디에도 그 문자열이 없다.
    const keys = orchestratorHaltCopyKeys("unknown");
    for (const locale of [ko, en]) {
      const dict = locale as Record<string, string>;
      expect(dict[keys.title]).not.toContain("secret");
      expect(dict[keys.hint]).not.toContain("secret");
    }
  });

  it("모르는 하네스 이름은 버린다 — 문구는 이름 없이도 성립한다", () => {
    expect(
      classifyOrchestratorHalt({
        status: "error",
        reason: "needsAuth",
        model: "totally-made-up-cli",
      }),
    ).toEqual({ kind: "needsAuth", model: null });
  });

  it("spawnFailed의 허용 errno만 배너 힌트 선택에 넘긴다", () => {
    expect(
      classifyOrchestratorHalt({
        status: "error",
        reason: "spawnFailed",
        spawnErrno: "EACCES",
      }),
    ).toEqual({ kind: "spawnFailed", model: null, spawnErrno: "EACCES" });
    expect(
      classifyOrchestratorHalt({
        status: "error",
        reason: "spawnFailed",
        spawnErrno: "EIO",
      }),
    ).toEqual({ kind: "spawnFailed", model: null });
  });
});

describe("문구 — 사유마다 '다음 행동' 이 있다", () => {
  it("★모든 사유가 ko/en 에서 title·hint·label 셋을 다 갖는다", () => {
    for (const kind of ALL_KINDS) {
      const keys = orchestratorHaltCopyKeys(kind);
      for (const [name, locale] of [
        ["ko", ko],
        ["en", en],
      ] as const) {
        const dict = locale as unknown as Record<string, string>;
        for (const key of [keys.title, keys.hint, keys.label]) {
          expect(
            typeof dict[key] === "string" && dict[key].length > 0,
            `${name}: ${key}`,
          ).toBe(true);
        }
      }
    }
  });

  it("★hint 는 '오류' 한 줄이 아니라 다음 행동을 적는다", () => {
    // 사장님이 겪으신 것이 정확히 "설명 없이 멈춘 화면" 이었다. 길이 하한은
    // 조잡해 보이지만, 실제로 이 축이 퇴화하는 방식은 hint 를 "오류입니다" 로
    // 줄이는 것이라서 그 퇴화를 정확히 잡는다.
    for (const kind of ALL_KINDS) {
      const keys = orchestratorHaltCopyKeys(kind);
      const koHint = (ko as unknown as Record<string, string>)[keys.hint];
      const enHint = (en as unknown as Record<string, string>)[keys.hint];
      expect(koHint.length, `ko ${kind}`).toBeGreaterThan(30);
      expect(enHint.length, `en ${kind}`).toBeGreaterThan(30);
    }
  });

  it("로그인 사유의 문구는 무엇을 로그인할지 말한다", () => {
    const keys = orchestratorHaltCopyKeys("needsAuth");
    expect((ko as unknown as Record<string, string>)[keys.title]).toContain(
      "{model}",
    );
    expect((en as unknown as Record<string, string>)[keys.title]).toContain(
      "{model}",
    );
  });

  it("spawnFailed는 폴더가 아닌 errno별 다음 행동을 안내한다", () => {
    const eaccesKeys = orchestratorHaltCopyKeys("spawnFailed", "EACCES");
    const enxioKeys = orchestratorHaltCopyKeys("spawnFailed", "ENXIO");
    for (const locale of [ko, en]) {
      const dict = locale as unknown as Record<string, string>;
      expect(dict[eaccesKeys.hint]).toContain("postinstall.mjs");
      expect(dict[enxioKeys.hint].toLowerCase()).toContain("pty");
      expect(dict[orchestratorHaltCopyKeys("spawnFailed").hint].toLowerCase()).not.toContain(
        "folder",
      );
    }
  });
});

describe("배너 CTA", () => {
  it("로그인으로 풀리는 사유에만 로그인 버튼을 건다", () => {
    expect(
      orchestratorHaltLoginModel({ kind: "needsAuth", model: "claude" }),
    ).toBe("claude");
    expect(
      orchestratorHaltLoginModel({ kind: "firstRunDialog", model: "claude" }),
    ).toBeNull();
    // 하네스를 모르면 로그인 터미널을 띄우지 않는다.
    expect(
      orchestratorHaltLoginModel({ kind: "needsAuth", model: null }),
    ).toBeNull();
  });
});

describe("★멈춘 뒤에도 터미널을 보여줘야 하는 사유", () => {
  it("사용자가 그 화면에서 직접 답해야 풀리는 사유는 터미널을 남긴다", () => {
    // 비기너에겐 이 터미널이 유일한 조작 수단이다. 사유를 띄우면서 터미널을
    // 감추면 "고치라고 안내해 놓고 고칠 도구를 뺏는" 화면이 된다.
    expect(orchestratorHaltKeepsTerminal("firstRunDialog")).toBe(true);
    expect(orchestratorHaltKeepsTerminal("needsAuth")).toBe(true);
  });

  it("PTY 가 이미 죽은 사유는 감춘다", () => {
    expect(orchestratorHaltKeepsTerminal("rootPathMissing")).toBe(false);
    expect(orchestratorHaltKeepsTerminal("crashLoop")).toBe(false);
    expect(orchestratorHaltKeepsTerminal("spawnFailed")).toBe(false);
  });
});

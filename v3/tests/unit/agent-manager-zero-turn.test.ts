/**
 * "클레임됐는데 성공 턴 0" 판정 회귀 (티켓 gPIC5k65hGKcTOpq4NQZ).
 *
 * 실측 사고: 세션 `Y4wcieyXuaxHGBsV84gW` 가 429(Token Plan usage limit
 * reached)로 1시간 35분 동안 단 한 턴도 못 돌았는데 PTY 바이트는 계속 흘러
 * status=working 으로 보였다(오케가 세션 jsonl 을 손으로 열어보고서야 잡음).
 *
 * `tests/fixtures/session-zero-turn-429.jsonl` 은 그 사고 세션의 실제 jsonl
 * 사본이다(오케가 읽기전용으로 보존, 시크릿 없음 확인 후 복사) — 순수함수만
 * 부르는 합성 테스트가 아니라 실제 사고 데이터로 검증한다.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  assistantLineHasRealModel,
  sessionHasSuccessfulTurn,
  readSessionSuccessfulTurnStatus,
  claudeSessionFilePath,
} from "../../electron/agent-manager";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "fixtures",
  "session-zero-turn-429.jsonl",
);

function fixtureLines(): string[] {
  return fs.readFileSync(FIXTURE_PATH, "utf-8").split("\n");
}

describe("assistantLineHasRealModel — 개별 라인 판정(순수)", () => {
  it("model:<synthetic> 인 assistant 라인은 실모델 턴이 아니다", () => {
    expect(
      assistantLineHasRealModel({
        type: "assistant",
        message: { model: "<synthetic>" },
      }),
    ).toBe(false);
  });

  it("실모델(예: claude-sonnet-5)이 박힌 assistant 라인은 실모델 턴이다", () => {
    expect(
      assistantLineHasRealModel({
        type: "assistant",
        message: { model: "claude-sonnet-5" },
      }),
    ).toBe(true);
  });

  it("assistant 가 아닌 이벤트(user/system/attachment 등)는 판정 대상이 아니다", () => {
    expect(
      assistantLineHasRealModel({
        type: "user",
        message: { model: "claude-sonnet-5" },
      }),
    ).toBe(false);
  });

  it("model 이 없거나 빈 문자열이면 실모델 턴이 아니다", () => {
    expect(assistantLineHasRealModel({ type: "assistant", message: {} })).toBe(
      false,
    );
    expect(
      assistantLineHasRealModel({
        type: "assistant",
        message: { model: "" },
      }),
    ).toBe(false);
  });
});

describe("sessionHasSuccessfulTurn — 실사고 픽스처(Y4wcieyXuaxHGBsV84gW)", () => {
  it("★red→green: 사고 세션 48줄 전체가 assistant 5턴 모두 <synthetic> — 성공 턴 0건으로 판정한다", () => {
    // 실측: assistant 턴 5개, 전부 model:"<synthetic>", 전부 429 rate_limit.
    const lines = fixtureLines();
    const assistantCount = lines.filter((l) => {
      try {
        return JSON.parse(l)?.type === "assistant";
      } catch {
        return false;
      }
    }).length;
    expect(assistantCount).toBe(5); // 실측 건수 고정 — 픽스처가 조용히 바뀌면 여기서 깨진다.

    expect(sessionHasSuccessfulTurn(lines)).toBe(false);
  });

  it("뮤테이션 확인 — 5개 중 1줄이라도 실모델이면 green 으로 뒤집힌다", () => {
    const lines = fixtureLines();
    const idx = lines.findIndex((l) => l.includes('"type":"assistant"'));
    expect(idx).toBeGreaterThanOrEqual(0);
    const mutated = [...lines];
    mutated[idx] = mutated[idx].replace(
      '"model":"<synthetic>"',
      '"model":"claude-sonnet-5"',
    );
    expect(sessionHasSuccessfulTurn(mutated)).toBe(true);
  });

  it("정상 세션(실모델 턴 포함)은 성공 턴 있음으로 판정한다", () => {
    const healthy = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-5", usage: { input_tokens: 10 } },
      }),
    ];
    expect(sessionHasSuccessfulTurn(healthy)).toBe(true);
  });

  it("빈 줄·파싱 불가 라인은 건너뛴다(그 자체가 실패 근거가 아니다)", () => {
    expect(sessionHasSuccessfulTurn(["", "   ", "{not json"])).toBe(false);
  });
});

describe("readSessionSuccessfulTurnStatus — 파일 읽기 경로", () => {
  it("실제 사고 픽스처 파일을 읽으면 false(확정 0건)를 반환한다", () => {
    expect(readSessionSuccessfulTurnStatus(FIXTURE_PATH)).toBe(false);
  });

  it("파일이 없으면 null('모른다') — false('확정 0건')로 승격하지 않는다", () => {
    expect(
      readSessionSuccessfulTurnStatus(
        path.join(__dirname, "..", "fixtures", "no-such-session-file.jsonl"),
      ),
    ).toBeNull();
  });
});

describe("claudeSessionFilePath — 경로 인코딩", () => {
  it("claude-paths.ts 의 encodeClaudeProjectDir 와 같은 규칙으로 세션 경로를 만든다", () => {
    const p = claudeSessionFilePath(
      "/Users/dongwonkim/.marblo/worktrees/GFB8JnJrrX6AgahqmGB3/Y4wcieyXuaxHGBsV84gW",
      "bf17ec16-7934-4a1f-bb75-5fa65a5bc41c",
    );
    expect(p).toContain(
      "-Users-dongwonkim--marblo-worktrees-GFB8JnJrrX6AgahqmGB3-Y4wcieyXuaxHGBsV84gW",
    );
    expect(p.endsWith("bf17ec16-7934-4a1f-bb75-5fa65a5bc41c.jsonl")).toBe(true);
  });
});

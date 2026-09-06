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

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  assistantLineHasRealModel,
  sessionHasSuccessfulTurn,
  readSessionSuccessfulTurnStatus,
  claudeSessionFilePath,
  resolveClaudeSessionIdForAgent,
} from "../../electron/agent-manager";
import { encodeClaudeProjectDir } from "../../electron/claude-paths";

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

describe("resolveClaudeSessionIdForAgent — 세션 id 해석(실제 fs, 티켓 IOAvYsfHz72Ov5BDy8NO)", () => {
  // ★실제 os.homedir()/.claude/projects/ 아래에 스크래치 디렉터리를 만든다 —
  // 경로 인코딩(claudeSessionFilePath 와 같은 encodeClaudeProjectDir)이
  // os.homedir() 를 하드코딩하고 있어 목(mock)으로는 이 함수의 실제 호출
  // 경로(디렉터리 스캔 + marblo-labels.json 읽기)를 검증할 수 없다. 매 테스트
  // 마다 고유한 fake rootPath 를 써서 충돌을 피하고, afterEach 에서 반드시
  // 지운다.
  const scratchRoots: string[] = [];

  function scratchRootPath(tag: string): string {
    const rootPath = `/tmp/marblo-test-zero-turn-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    scratchRoots.push(rootPath);
    return rootPath;
  }

  function projectDirFor(rootPath: string): string {
    return path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodeClaudeProjectDir(rootPath),
    );
  }

  afterEach(() => {
    while (scratchRoots.length) {
      const rootPath = scratchRoots.pop()!;
      fs.rmSync(projectDirFor(rootPath), { recursive: true, force: true });
    }
  });

  it("라벨 매치가 있으면 mtime 과 무관하게 그 세션을 고른다", () => {
    const rootPath = scratchRootPath("label-wins");
    const dir = projectDirFor(rootPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "old-session.jsonl"), "{}\n");
    fs.writeFileSync(path.join(dir, "new-session.jsonl"), "{}\n");
    // ★old-session 이 mtime 상으로는 더 오래됐도록(진짜 "old") 만든다 — 라벨이
    // 없었다면 mtime 폴백은 new-session 을 골랐을 것이다. 그런데도 라벨이
    // old-session 을 가리키면 라벨이 이겨야 한다.
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(dir, "old-session.jsonl"), now, now);
    fs.utimesSync(path.join(dir, "new-session.jsonl"), now + 10, now + 10);
    fs.writeFileSync(
      path.join(dir, "marblo-labels.json"),
      JSON.stringify({
        "old-session": { agentId: "agent-x", label: "agent-x" },
      }),
    );

    expect(resolveClaudeSessionIdForAgent(rootPath, "agent-x")).toBe(
      "old-session",
    );
  });

  it("라벨 파일이 없으면(실사고와 같은 모양) 가장 최근 mtime 의 세션으로 폴백한다", () => {
    const rootPath = scratchRootPath("no-label-fallback");
    const dir = projectDirFor(rootPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "older.jsonl"), "{}\n");
    fs.writeFileSync(path.join(dir, "newer.jsonl"), "{}\n");
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(dir, "older.jsonl"), now, now);
    fs.utimesSync(path.join(dir, "newer.jsonl"), now + 10, now + 10);
    // marblo-labels.json 을 아예 안 쓴다 — 실사고 프로젝트 디렉터리와 같은 모양.

    expect(resolveClaudeSessionIdForAgent(rootPath, "any-agent")).toBe("newer");
  });

  it("라벨은 있는데 이 agentId 항목이 없으면 mtime 폴백으로 넘어간다", () => {
    const rootPath = scratchRootPath("label-miss-fallback");
    const dir = projectDirFor(rootPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "only-session.jsonl"), "{}\n");
    fs.writeFileSync(
      path.join(dir, "marblo-labels.json"),
      JSON.stringify({
        "only-session": { agentId: "someone-else", label: "someone-else" },
      }),
    );

    expect(resolveClaudeSessionIdForAgent(rootPath, "agent-x")).toBe(
      "only-session",
    );
  });

  it("디렉터리가 없으면 null('모른다')이다 — false 로 승격하지 않는다", () => {
    const rootPath = scratchRootPath("missing-dir");
    // mkdir 하지 않는다 — 존재하지 않는 프로젝트 디렉터리.
    expect(resolveClaudeSessionIdForAgent(rootPath, "agent-x")).toBeNull();
  });

  it("디렉터리는 있는데 jsonl 이 하나도 없으면 null 이다", () => {
    const rootPath = scratchRootPath("empty-dir");
    fs.mkdirSync(projectDirFor(rootPath), { recursive: true });
    expect(resolveClaudeSessionIdForAgent(rootPath, "agent-x")).toBeNull();
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

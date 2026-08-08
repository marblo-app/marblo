/**
 * 재읽기 이중청구 — `cost_logs` 8월 비용의 32.4% 를 만든 결함.
 *
 * `ParseState.lastLineCount` 가 프로세스 메모리에만 있어서, 같은 세션 파일에
 * 트래커가 다시 붙을 때마다(앱 재시작 · reuse_agent · mtime 플랩) 워터마크가
 * 0 으로 돌아가고 **이미 청구한 바이트 전체가 새 델타로 다시** 나갔다.
 *
 * BQ 지문(marblo-2253d.marblo_telemetry.cost_logs): 같은 agentId·같은 model 이
 * 완전히 동일한 번들(734,788 in / 41,976 out / 21.4M cache-read, $15.65)을
 * 16회 재적재. 15초 폴 하나가 그만한 토큰을 나를 수는 없다.
 *
 * 근거·쿼리: v3/docs/COST-AXIS-RECONCILIATION-2026-08-08.md
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  CostTracker,
  __setWatermarkPathForTest,
  restoreParseState,
  saveParseState,
  type CostEntry,
} from "../../electron/cost-tracker";

let tmpDir: string;
const trackers: CostTracker[] = [];

/** One claude JSONL assistant turn with the given usage. */
function turn(model: string, input: number, output: number): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

function makeTracker(onCost: (agentId: string, cost: CostEntry) => void) {
  const t = new CostTracker(onCost);
  vi.spyOn(
    t as unknown as { ensureClaudeProbe: () => void },
    "ensureClaudeProbe"
  ).mockImplementation(() => {});
  trackers.push(t);
  return t;
}

/**
 * Drive one poll against `file` the way the tracker does, through the private
 * poller, so the watermark restore/persist path is the one under test.
 */
function pollOnce(
  t: CostTracker,
  agentId: string,
  file: string,
  model: string
): void {
  const sessions = (
    t as unknown as {
      sessions: Map<string, Record<string, unknown>>;
    }
  ).sessions;
  sessions.set(agentId, {
    agentId,
    format: "claude",
    filePath: file,
    searchRoot: "",
    state: { lastLineCount: 0, cumulative: {}, model: null, rateLimit: null },
    restoredFor: "",
    accumulated: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    model,
    totalCostUsd: 0,
    timer: setInterval(() => {}, 1_000_000),
  });
  (t as unknown as { pollSessionFile: (id: string) => void }).pollSessionFile(
    agentId
  );
  const tracker = sessions.get(agentId) as { timer: NodeJS.Timeout };
  clearInterval(tracker.timer);
  sessions.delete(agentId);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wm-"));
  __setWatermarkPathForTest(path.join(tmpDir, "cost-watermarks.json"));
});

afterEach(() => {
  for (const t of trackers.splice(0)) t.clearAll();
  __setWatermarkPathForTest(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("파스 워터마크 — 재부착이 이미 청구한 바이트를 다시 청구하지 않는다", () => {
  it("★같은 파일에 다시 붙어도 델타가 다시 나가지 않는다(재읽기 이중청구)", () => {
    const file = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(
      file,
      [turn("claude-opus-5", 1000, 500), turn("claude-opus-5", 2000, 700)].join(
        "\n"
      ) + "\n"
    );

    const emitted: CostEntry[] = [];
    const t = makeTracker((_id, cost) => emitted.push(cost));

    // 첫 부착 — 파일 전체가 한 번 청구된다(정상).
    pollOnce(t, "ag-1", file, "claude-opus-5");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].deltaInputTokens).toBe(3000);
    expect(emitted[0].deltaOutputTokens).toBe(1200);

    // 재부착(= 앱 재시작 / reuse_agent). 파일은 그대로다.
    pollOnce(t, "ag-1", file, "claude-opus-5");
    expect(emitted).toHaveLength(1); // 새 델타 없음 — 이게 수리의 핵심

    // 새 턴이 붙으면 그 증분만 나간다.
    fs.appendFileSync(file, turn("claude-opus-5", 10, 20) + "\n");
    pollOnce(t, "ag-1", file, "claude-opus-5");
    expect(emitted).toHaveLength(2);
    expect(emitted[1].deltaInputTokens).toBe(10);
    expect(emitted[1].deltaOutputTokens).toBe(20);
  });

  it("파일이 같은 이름으로 새로 나면(크기 감소) 워터마크를 버리고 0부터 읽는다", () => {
    const file = path.join(tmpDir, "rotate.jsonl");
    fs.writeFileSync(
      file,
      Array.from({ length: 5 }, () => turn("claude-opus-5", 1000, 500)).join(
        "\n"
      ) + "\n"
    );
    const emitted: CostEntry[] = [];
    const t = makeTracker((_id, cost) => emitted.push(cost));
    pollOnce(t, "ag-1", file, "claude-opus-5");
    expect(emitted).toHaveLength(1);

    // CLI 가 같은 경로에 새 세션을 썼다 — 옛 라인수를 이어받으면 진짜 토큰이
    // 조용히 누락된다. 줄어든 파일은 워터마크를 무효화해야 한다.
    fs.writeFileSync(file, turn("claude-opus-5", 42, 7) + "\n");
    pollOnce(t, "ag-1", file, "claude-opus-5");
    expect(emitted).toHaveLength(2);
    expect(emitted[1].deltaInputTokens).toBe(42);
  });

  it("워터마크 저장소가 없거나 깨져도 실패하지 않고 0부터 읽는다", () => {
    const file = path.join(tmpDir, "s.jsonl");
    fs.writeFileSync(file, turn("claude-opus-5", 5, 5) + "\n");
    expect(restoreParseState(file)).toBeNull();
    expect(restoreParseState(path.join(tmpDir, "nope.jsonl"))).toBeNull();

    saveParseState(file, {
      lastLineCount: 1,
      cumulative: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 },
      model: "claude-opus-5",
      rateLimit: null,
    });
    expect(restoreParseState(file)?.lastLineCount).toBe(1);
  });
});

describe("한 세션 파일에 트래커는 하나 — 팬아웃 오귀속 방어", () => {
  it("★sessionId 없는 부착이 이미 추적중인 파일을 집으면 추적을 건다(중복청구 금지)", () => {
    const projectDir = path.join(tmpDir, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
    const shared = path.join(projectDir, "live.jsonl");
    fs.writeFileSync(shared, turn("claude-opus-5", 900000, 100000) + "\n");

    const t = makeTracker(() => {});
    const sessions = (
      t as unknown as { sessions: Map<string, { filePath: string }> }
    ).sessions;
    // 다른 에이전트가 이미 이 파일을 물고 있다.
    sessions.set("agent-A", { filePath: shared } as { filePath: string });

    const guard = (
      t as unknown as {
        isFileTrackedByOther: (id: string, f: string) => boolean;
      }
    ).isFileTrackedByOther.bind(t);

    expect(guard("agent-B", shared)).toBe(true);
    expect(guard("agent-A", shared)).toBe(false); // 자기 자신은 충돌이 아니다
    expect(guard("agent-B", path.join(projectDir, "other.jsonl"))).toBe(false);
  });
});

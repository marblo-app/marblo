import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Mission feature 의 wiring 회귀 가드.
// 시나리오 1 (Quick Fix e2e) / 2 (Full Feature 60 초 데모) 는 실제 Electron + UI
// 실행이 필요해서 vitest 로는 못 잡지만, 다음의 wiring 만 깨지지 않으면 실제 실행
// 단계에서 첫 단계가 무조건 작동한다:
//   - main.ts 가 buildMissionEngine 을 호출하고 pickupPlanningMissions 를 실행
//   - bridge-server 의 dispatchTask 가 public 으로 노출
//   - missionService 가 5 메서드 (CRUD + subscribe + appendTimelineEvent...) export
//   - templates.ts 의 5 템플릿이 frontend / electron 양쪽 미러로 존재
//   - missions 탭이 TabBar / Layout 에 등록
//   - run_skill MCP tool 의 allowlist 가 mission-engine types.ts 와 동기화

function repoRoot(): string {
  const markers = ["electron/main.ts", "src/components/missions/templates.ts"];
  const tryDir = (d: string) =>
    markers.every((m) => fs.existsSync(path.join(d, m)));
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    if (tryDir(cur)) return cur;
    cur = path.dirname(cur);
  }
  if (tryDir(process.cwd())) return process.cwd();
  throw new Error("Could not locate v3 project root");
}
const ROOT = repoRoot();
const readFile = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

describe("Mission wiring (scenario 1+2 shape guard)", () => {
  it("main.ts 가 mission-engine wire 를 import + 호출", () => {
    const src = readFile("electron/main.ts");
    expect(src).toMatch(/from\s+["']\.\/mission-engine\/wire["']/);
    expect(src).toMatch(/buildMissionEngine\(/);
    expect(src).toMatch(/missionBundle/);
    expect(src).toMatch(/pickupPlanningMissions/);
    expect(src).toMatch(/forwarder\.start\(\)/);
  });

  it("main.ts 의 dispose 가 window-all-closed 와 before-quit 모두에 등록", () => {
    const src = readFile("electron/main.ts");
    const disposeCount = (src.match(/missionBundle\?\.dispose\(\)/g) ?? [])
      .length;
    expect(disposeCount).toBeGreaterThanOrEqual(2);
  });

  it("agent-status 콜백이 forwardAgentStatus 를 호출 (wake-from-sleep 신호)", () => {
    const src = readFile("electron/main.ts");
    expect(src).toMatch(/missionBundle\?\.forwardAgentStatus\(/);
  });

  it("bridge-server.dispatchTask 가 public + 타입 export", () => {
    const src = readFile("electron/bridge-server.ts");
    expect(src).toMatch(/export\s+interface\s+DispatchTaskRequest/);
    expect(src).toMatch(/export\s+interface\s+DispatchTaskResponse/);
    // public 메서드 — private 키워드가 없어야 함
    expect(src).not.toMatch(/private\s+dispatchTask\(/);
    expect(src).toMatch(/\n\s*dispatchTask\(/);
  });

  it("Mission run_skill allowlist 가 mission-engine types.ts 와 동기화", () => {
    const types = readFile("electron/mission-engine/types.ts");
    const tools = readFile("electron/mcp-server/tools.ts");
    const skills = [
      "/review",
      "/qa",
      "/ship",
      "/investigate",
      "/plan-ceo-review",
      "/plan-eng-review",
      "/plan-design-review",
      "/design-review",
      "/office-hours",
      "/autoplan",
    ];
    for (const s of skills) {
      expect(
        types.includes(`"${s}"`),
        `types.ts ALLOWED_SKILLS 에 ${s} 누락`,
      ).toBe(true);
      expect(
        tools.includes(`"${s}"`),
        `tools.ts ALLOWED_MISSION_SKILLS 에 ${s} 누락`,
      ).toBe(true);
    }
  });

  it("frontend templates.ts 와 electron templates.ts 의 템플릿 ID 동일", () => {
    const front = readFile("src/components/missions/templates.ts");
    const back = readFile("electron/mission-engine/templates.ts");
    const ids = ["quick-fix", "polish", "feature", "full-feature", "research"];
    for (const id of ids) {
      expect(front, `frontend templates.ts 에 ${id} 누락`).toMatch(
        new RegExp(`["']${id}["']`),
      );
      expect(back, `electron templates.ts 에 ${id} 누락`).toMatch(
        new RegExp(`["']${id}["']`),
      );
    }
  });

  it("missions 탭이 TabBar / Layout 에 등록", () => {
    const tabBar = readFile("src/components/TabBar.tsx");
    const layout = readFile("src/components/Layout.tsx");
    expect(tabBar).toMatch(/missions/i);
    expect(layout).toMatch(/MissionsTab/);
  });

  it("missionService 가 핵심 5 메서드 export", () => {
    const src = readFile("src/services/missionService.ts");
    for (const name of [
      "getMissions",
      "createMission",
      "updateMission",
      "subscribeToMissions",
      "appendTimelineEvent",
    ]) {
      expect(src, `${name} export 누락`).toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`),
      );
    }
  });

  it("missions 인덱스가 firestore.indexes.json 에 등록", () => {
    const idx = JSON.parse(readFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string; fields: unknown[] }>;
    };
    const missionsIdx = idx.indexes.find(
      (i) => i.collectionGroup === "missions",
    );
    expect(
      missionsIdx,
      "firestore.indexes.json 에 missions 인덱스 누락",
    ).toBeTruthy();
  });

  it("Quick Fix 템플릿 시퀀스 = investigate → fix → review → ship", () => {
    const back = readFile("electron/mission-engine/templates.ts");
    // electron 쪽 정의에서 quick-fix 영역만 잘라서 검증
    const start = back.indexOf('"quick-fix":');
    expect(start).toBeGreaterThan(-1);
    const region = back.slice(start, start + 800);
    expect(region).toMatch(/\/investigate/);
    expect(region).toMatch(/type:\s*["']fix["']/);
    expect(region).toMatch(/\/review/);
    expect(region).toMatch(/\/ship/);
  });

  it("Full Feature 템플릿이 10 step (60 초 데모용)", () => {
    const back = readFile("electron/mission-engine/templates.ts");
    const start = back.indexOf('"full-feature":');
    expect(start).toBeGreaterThan(-1);
    // 다음 템플릿 시작 전까지 잘라내기
    const region = back.slice(start, back.indexOf("research:"));
    const stepCount = (region.match(/\{\s*type:/g) ?? []).length;
    expect(stepCount).toBe(10);
  });
});

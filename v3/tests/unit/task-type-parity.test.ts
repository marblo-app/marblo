/**
 * P2-1 — `electron/mcp-server/task-type.ts` ↔ `src/lib/telemetry/taskType.ts`
 * **미러 패리티**.
 *
 * 왜 이 테스트가 미러의 안전장치인가: 두 구현이 갈라지면 같은 티켓이 렌더러에서는
 * `feature`, main 에서는 `chore` 로 분류되고, 그러면 지식그래프의 taskType 셀이
 * 조용히 쪼개지고 `task_outcomes.taskType` 과도 어긋난다. 그 드리프트는 어떤 런타임
 * 에러도 내지 않으므로 테스트만이 잡을 수 있다.
 *
 * 대조 방식은 두 겹이다 —
 *  1. **소스 대조**: 규칙 블록(RULES / CONVENTIONAL_*) 원문이 문자 단위로 같은지.
 *     한쪽만 정규식을 손대면 여기서 즉시 깨진다.
 *  2. **동작 대조**: 실제 마블로 티켓 코퍼스(한/영 혼용, conventional prefix 포함)로
 *     두 함수의 출력이 전부 일치하는지 + 라벨이 모든 카테고리를 실제로 덮는지.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  classifyTaskType as classifyMain,
  normalizeTaskTypeLabel,
  TASK_TYPES as TASK_TYPES_MAIN,
} from "../../electron/mcp-server/task-type";
import {
  classifyTaskType as classifyRenderer,
  TASK_TYPES as TASK_TYPES_RENDERER,
} from "../../src/lib/telemetry/taskType";

const MAIN_FILE = path.join(
  __dirname,
  "../../electron/mcp-server/task-type.ts",
);
const RENDERER_FILE = path.join(
  __dirname,
  "../../src/lib/telemetry/taskType.ts",
);

/** 규칙 블록만 떼어 온다(모듈 주석·헬퍼는 파일마다 다른 게 정상). */
function ruleBlock(file: string): string {
  const src = fs.readFileSync(file, "utf-8");
  const start = src.indexOf("const RULES:");
  const end = src.indexOf("/** Task fields the classifier reads.");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end).trim();
}

/**
 * 실제 보드에서 뽑은 형태의 제목들(이 repo 의 git log·티켓 제목 양식). 라벨을
 * 하드코딩하지 않는 항목이 대부분인 이유: 이 테스트의 주장은 "라벨이 무엇이다"가
 * 아니라 **"두 구현이 같다"** 이다.
 */
const CORPUS: ReadonlyArray<{
  title?: string;
  goal?: string;
  description?: string;
}> = [
  { title: "feat(routing): 난도→모델 사다리 데이터화 + max/ultra 승인게이트" },
  { title: "fix(v3): 오케 재시작 크래시" },
  { title: "docs(vendor): 구독형 모델 CLI 총서베이" },
  { title: "refactor: dispatch-scoring 정리" },
  { title: "test: 라우팅 그래프 회귀 커버리지" },
  { title: "chore: 의존성 업그레이드" },
  { title: "ci: mac 서명 파이프라인 복구" },
  { title: "perf: 그래프 읽기 경로 캐시" },
  { title: "style: prettier 재적용" },
  { title: "build: electron-builder 설정" },
  { title: "테스트 실패 수정" },
  { title: "텔레메트리 BQ 적재 배선" },
  { title: "지식그래프 cell key 해상도 model@effort" },
  { title: "워치독 오탐 조사" },
  { title: "TASK-1234" },
  { title: "" },
  { title: "   " },
  { title: "8wBiVzwIepKrjR9JRZJR", description: "결함 재현부터 시작" },
  {
    title: "라우팅 P2·측정",
    goal: "모델별 효과집계 산출",
    description: "task_outcomes ⋈ cost_logs 조인",
  },
  { title: "Add support for new provider profiles" },
  { title: "Investigate flaky PTY teardown" },
  { title: "Rename worktree coordinator" },
  { title: "Deploy canary to production" },
  { title: "README 갱신" },
  { title: "커버리지 회귀 테스트 추가" },
  { title: "비용 대시보드 신규 개발" },
  { title: "설정 파일 포매팅" },
  { title: "마이그레이션 스크립트 재작성" },
  { title: "크래시 로그 수집 인프라" },
  { title: "오케↔에이전트 신뢰성 감사" },
];

describe("taskType 미러 — 소스 대조", () => {
  it("규칙 블록(RULES/패턴)이 문자 단위로 같다", () => {
    expect(ruleBlock(MAIN_FILE)).toBe(ruleBlock(RENDERER_FILE));
  });

  it("CONVENTIONAL_PREFIX / CONVENTIONAL_MAP 블록이 같다", () => {
    const grab = (file: string) => {
      const src = fs.readFileSync(file, "utf-8");
      const start = src.indexOf("/** Conventional-commit style prefix");
      const end = src.indexOf("/** Task fields the classifier reads.");
      return src.slice(start, end).trim();
    };
    expect(grab(MAIN_FILE)).toBe(grab(RENDERER_FILE));
    expect(grab(MAIN_FILE)).toContain("CONVENTIONAL_MAP");
  });

  it("TASK_TYPES enum 이 같다", () => {
    expect([...TASK_TYPES_MAIN]).toEqual([...TASK_TYPES_RENDERER]);
  });

  it("★미러 표식이 양쪽 파일에 남아 있다(다음 사람이 한쪽만 고치지 않게)", () => {
    expect(fs.readFileSync(MAIN_FILE, "utf-8")).toContain(
      "src/lib/telemetry/taskType.ts",
    );
    expect(fs.readFileSync(RENDERER_FILE, "utf-8")).toContain(
      "electron/mcp-server/task-type.ts",
    );
  });
});

describe("taskType 미러 — 동작 대조", () => {
  it("코퍼스 전체에서 두 구현의 라벨이 일치한다", () => {
    for (const task of CORPUS) {
      expect(classifyMain(task), `mismatch on ${JSON.stringify(task)}`).toBe(
        classifyRenderer(task),
      );
    }
  });

  it("코퍼스가 모든 카테고리를 실제로 덮는다(패리티가 공허하지 않게)", () => {
    const seen = new Set(CORPUS.map((t) => classifyMain(t)));
    for (const type of TASK_TYPES_MAIN) expect(seen.has(type)).toBe(true);
    // 신호 없는 티켓은 null 이어야 한다 — 추측 라벨로 그래프를 오염시키지 않는다.
    expect(seen.has(null)).toBe(true);
    expect(classifyMain({ title: "TASK-1234" })).toBeNull();
    expect(classifyMain({ title: "   " })).toBeNull();
  });
});

describe("normalizeTaskTypeLabel", () => {
  it("셀 키가 대소문자·공백으로 쪼개지지 않게 정규화한다", () => {
    expect(normalizeTaskTypeLabel(" Bug-Fix ")).toBe("bug-fix");
    expect(normalizeTaskTypeLabel("bug-fix")).toBe("bug-fix");
  });

  it("빈 값은 undefined — 빈 factorValue 로 셀을 만들지 않는다", () => {
    expect(normalizeTaskTypeLabel("")).toBeUndefined();
    expect(normalizeTaskTypeLabel("   ")).toBeUndefined();
    expect(normalizeTaskTypeLabel(null)).toBeUndefined();
    expect(normalizeTaskTypeLabel(undefined)).toBeUndefined();
  });

  it("★enum 밖의 라벨도 통과시킨다 — merge 경로의 changeType 학습을 버리지 않는다", () => {
    expect(normalizeTaskTypeLabel("docs-only")).toBe("docs-only");
  });
});

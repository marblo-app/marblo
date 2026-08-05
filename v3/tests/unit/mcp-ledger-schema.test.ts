import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  buildLedgerEvent,
  deriveLedgerWorktreeId,
  deriveWorktreeId,
  hashInstruction,
  parseWorktreePath,
  readAgentRuntimeContext,
  taskIdFromParams,
  worktreeAttributionCwd,
  worktreesRoot,
  LEDGER_ENV,
  INSTRUCTION_HASH_PREFIX,
} from "../../electron/mcp-server/ledger";

const HOME = "/Users/tester";
const PROJECT = "GFB8JnJrrX6AgahqmGB3";
const TASK = "IEQFEEoWdhuRXZBRAYnF";
const wt = (...segs: string[]) => path.join(worktreesRoot(HOME), ...segs);

const baseInput = {
  projectId: PROJECT,
  agentId: "agent-1",
  toolName: "update_task_status",
  params: {} as Record<string, unknown>,
  result: "ok",
  duration: 12,
  success: true,
};

describe("parseWorktreePath — 경로 규약 역산 (§8)", () => {
  it("규약 경로에서 projectId/taskId 를 역산한다", () => {
    expect(parseWorktreePath(wt(PROJECT, TASK), { homeDir: HOME })).toEqual({
      projectId: PROJECT,
      taskId: TASK,
    });
  });

  it("워크트리 하위 디렉터리(cwd 가 <worktree>/v3 인 경우)도 같은 정체성으로 역산한다", () => {
    expect(
      parseWorktreePath(wt(PROJECT, TASK, "v3", "electron"), { homeDir: HOME }),
    ).toEqual({ projectId: PROJECT, taskId: TASK });
  });

  it("이중 등록된 다른 projectId 버킷은 그 경로 그대로 귀속된다 — 앱 상태로 덮어쓰지 않는다", () => {
    const other = "uVJL1vnoiCpqbCUbFxTd";
    expect(parseWorktreePath(wt(other, TASK), { homeDir: HOME })).toEqual({
      projectId: other,
      taskId: TASK,
    });
  });

  it("규약 밖 경로는 null — 억지 귀속하지 않는다", () => {
    for (const p of [
      "/tmp/scratch",
      "/Users/tester/Documents/programming/marblo",
      "",
      path.join(HOME, ".marblo"),
    ]) {
      expect(deriveWorktreeId(p, { homeDir: HOME })).toBeNull();
    }
  });

  it("풀 바로 아래(프로젝트 버킷)는 티켓 미상이므로 null", () => {
    expect(deriveWorktreeId(wt(PROJECT), { homeDir: HOME })).toBeNull();
  });

  it("이름이 겹치는 이웃 디렉터리를 접두사만 보고 잡지 않는다", () => {
    const neighbor = path.join(HOME, ".marblo", "worktrees-old", PROJECT, TASK);
    expect(deriveWorktreeId(neighbor, { homeDir: HOME })).toBeNull();
  });

  it("문서 id 로 볼 수 없는 조각은 거른다", () => {
    expect(
      deriveWorktreeId(wt("has space", TASK), { homeDir: HOME }),
    ).toBeNull();
    expect(
      deriveWorktreeId(wt(PROJECT, "task.with.dots"), { homeDir: HOME }),
    ).toBeNull();
  });

  it("deriveWorktreeId 는 <projectId>/<taskId> 문자열이다", () => {
    expect(deriveWorktreeId(wt(PROJECT, TASK), { homeDir: HOME })).toBe(
      `${PROJECT}/${TASK}`,
    );
  });

  it("결정적이다 — 같은 입력이면 항상 같은 값", () => {
    const a = deriveWorktreeId(wt(PROJECT, TASK), { homeDir: HOME });
    const b = deriveWorktreeId(wt(PROJECT, TASK) + path.sep, {
      homeDir: HOME,
    });
    expect(a).toBe(b);
  });
});

describe("worktreeAttributionCwd — 귀속 근거는 cwd 뿐 (회귀 가드)", () => {
  const PROJECT_ROOT = "/Users/tester/Documents/programming/marblo";

  it("MARBLO_PROJECT_ROOT 가 설정돼 있어도 cwd 를 근거로 삼는다", () => {
    expect(
      worktreeAttributionCwd(
        { MARBLO_PROJECT_ROOT: PROJECT_ROOT } as NodeJS.ProcessEnv,
        wt(PROJECT, TASK),
      ),
    ).toBe(wt(PROJECT, TASK));
  });

  it("★MARBLO_PROJECT_ROOT 가 워크트리 귀속을 조용히 죽이지 않는다", () => {
    // 이 env 는 '프로젝트 루트' 를 뜻하고 프로젝트 루트는 정의상 워크트리 규약
    // 밖이다. 폴백으로 쓰면 env 설정만으로 모든 이벤트의 worktreeId 가 null 이
    // 된다 — 귀속이 통째로 죽는데 신호가 없다.
    const event = buildLedgerEvent({
      ...baseInput,
      cwd: worktreeAttributionCwd(
        { MARBLO_PROJECT_ROOT: PROJECT_ROOT } as NodeJS.ProcessEnv,
        wt(PROJECT, TASK),
      ),
      homeDir: HOME,
    });
    expect(event.worktreeId).toBe(`${PROJECT}/${TASK}`);
  });

  it("env 가 비어 있어도 동작이 같다 — env 는 애초에 근거가 아니다", () => {
    expect(
      worktreeAttributionCwd({} as NodeJS.ProcessEnv, wt(PROJECT, TASK)),
    ).toBe(
      worktreeAttributionCwd(
        { MARBLO_PROJECT_ROOT: PROJECT_ROOT } as NodeJS.ProcessEnv,
        wt(PROJECT, TASK),
      ),
    );
  });

  it("cwd 가 규약 밖이면 그대로 null — env 로 억지 보정하지 않는다", () => {
    const event = buildLedgerEvent({
      ...baseInput,
      cwd: worktreeAttributionCwd(
        { MARBLO_PROJECT_ROOT: wt(PROJECT, TASK) } as NodeJS.ProcessEnv,
        PROJECT_ROOT,
      ),
      homeDir: HOME,
    });
    expect(event.worktreeId).toBeNull();
  });
});

describe("deriveLedgerWorktreeId — cwd 우선, taskId 근거 보강", () => {
  it("규약 cwd 가 있으면 경로에서 파생한 worktreeId 를 우선한다", () => {
    const pathProject = "uVJL1vnoiCpqbCUbFxTd";
    expect(
      deriveLedgerWorktreeId({
        cwd: wt(pathProject, TASK),
        homeDir: HOME,
        projectId: PROJECT,
        taskId: TASK,
      }),
    ).toBe(`${pathProject}/${TASK}`);
  });

  it("규약 밖 cwd 여도 taskId 근거가 있으면 projectId/taskId 로 귀속한다", () => {
    expect(
      deriveLedgerWorktreeId({
        cwd: "/tmp/manual-checkout",
        homeDir: HOME,
        projectId: PROJECT,
        taskId: TASK,
      }),
    ).toBe(`${PROJECT}/${TASK}`);
  });

  it("규약 밖 cwd 이고 taskId 근거도 없으면 null 을 유지한다", () => {
    expect(
      deriveLedgerWorktreeId({
        cwd: "/tmp/manual-checkout",
        homeDir: HOME,
        projectId: PROJECT,
        taskId: null,
      }),
    ).toBeNull();
  });
});

describe("hashInstruction — 원문 대신 해시 (§5)", () => {
  it("sha256 해시를 접두사와 함께 낸다", () => {
    const text = "티켓 IEQ… 작업 지시";
    expect(hashInstruction(text)).toBe(
      INSTRUCTION_HASH_PREFIX +
        createHash("sha256").update(text, "utf8").digest("hex"),
    );
  });

  it("원문이 해시 안에 남지 않는다", () => {
    const secret = "sk-live-do-not-log-this";
    expect(hashInstruction(`prompt with ${secret}`)).not.toContain(secret);
  });

  it("빈 값/공백뿐이면 null — '해시 있음'이 '지시문 있었음'을 뜻하게 유지", () => {
    expect(hashInstruction(undefined)).toBeNull();
    expect(hashInstruction("")).toBeNull();
    expect(hashInstruction("   \n")).toBeNull();
  });
});

describe("taskIdFromParams", () => {
  it("문자열 task_id 만 받는다", () => {
    expect(taskIdFromParams({ task_id: TASK })).toBe(TASK);
    expect(taskIdFromParams({ task_id: "  " })).toBeNull();
    expect(taskIdFromParams({ task_id: 42 })).toBeNull();
    expect(taskIdFromParams({})).toBeNull();
  });
});

describe("readAgentRuntimeContext — env 계약", () => {
  it("주입돼 있으면 읽는다", () => {
    expect(
      readAgentRuntimeContext({
        [LEDGER_ENV.model]: "claude",
        [LEDGER_ENV.tier]: "complex",
        [LEDGER_ENV.instructionHash]: "sha256:abc",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      model: "claude",
      tier: "complex",
      instructionHash: "sha256:abc",
    });
  });

  it("미주입/공백이면 null — 추측하지 않는다", () => {
    expect(
      readAgentRuntimeContext({
        [LEDGER_ENV.model]: "  ",
      } as NodeJS.ProcessEnv),
    ).toEqual({ model: null, tier: null, instructionHash: null });
  });
});

describe("buildLedgerEvent — 스키마 조립 (§5/§15)", () => {
  it("kind 기본값은 action — 기존 쓰기 경로가 필드를 몰라도 안 깨진다", () => {
    expect(buildLedgerEvent(baseInput).kind).toBe("action");
  });

  it("lifecycle/deploy 를 명시할 수 있다", () => {
    expect(buildLedgerEvent({ ...baseInput, kind: "lifecycle" }).kind).toBe(
      "lifecycle",
    );
    expect(buildLedgerEvent({ ...baseInput, kind: "deploy" }).kind).toBe(
      "deploy",
    );
  });

  it("기존 필드를 그대로 보존한다 (하위호환)", () => {
    const params = { task_id: TASK, note: "hi" };
    const event = buildLedgerEvent({ ...baseInput, params });
    expect(event).toMatchObject({
      projectId: PROJECT,
      agentId: "agent-1",
      toolName: "update_task_status",
      params,
      result: "ok",
      duration: 12,
      success: true,
    });
  });

  it("체인 필드(seq/prevHash/hash)는 이번 슬라이스에서 쓰지 않는다 — L3 담당", () => {
    const event = buildLedgerEvent(baseInput) as Record<string, unknown>;
    expect("seq" in event).toBe(false);
    expect("prevHash" in event).toBe(false);
    expect("hash" in event).toBe(false);
  });

  it("모르는 값은 생략이 아니라 명시적 null 로 박힌다 (질의 가능해야 하므로)", () => {
    const event = buildLedgerEvent(baseInput);
    expect(event).toMatchObject({
      actorUid: null,
      model: null,
      tier: null,
      instructionHash: null,
      taskId: null,
      worktreeId: null,
    });
    for (const key of ["actorUid", "model", "tier", "worktreeId"]) {
      expect(key in event).toBe(true);
    }
  });

  it("params 의 task_id 와 cwd 에서 귀속을 채운다", () => {
    const event = buildLedgerEvent({
      ...baseInput,
      params: { task_id: TASK },
      actorUid: "uid-123",
      runtime: {
        model: "claude",
        tier: "complex",
        instructionHash: "sha256:x",
      },
      cwd: wt(PROJECT, TASK),
      homeDir: HOME,
    });
    expect(event).toMatchObject({
      actorUid: "uid-123",
      model: "claude",
      tier: "complex",
      instructionHash: "sha256:x",
      taskId: TASK,
      worktreeId: `${PROJECT}/${TASK}`,
    });
  });

  it("규약 밖 cwd 여도 taskId 가 있으면 projectId/taskId 로 귀속한다", () => {
    const event = buildLedgerEvent({
      ...baseInput,
      params: { task_id: TASK },
      cwd: "/tmp/manual-checkout",
      homeDir: HOME,
    });
    expect(event.worktreeId).toBe(`${PROJECT}/${TASK}`);
  });

  it("규약 밖 cwd 이고 taskId 가 없으면 worktreeId 가 null 로 남는다", () => {
    const event = buildLedgerEvent({
      ...baseInput,
      cwd: "/tmp/manual-checkout",
      homeDir: HOME,
    });
    expect(event.worktreeId).toBeNull();
  });

  it("경로가 앱 상태와 다른 projectId 를 가리켜도 경로를 따른다 — 이중 등록 대응", () => {
    const pathProject = "uVJL1vnoiCpqbCUbFxTd";
    const event = buildLedgerEvent({
      ...baseInput,
      projectId: PROJECT, // 앱 상태
      cwd: wt(pathProject, TASK), // 경로
      homeDir: HOME,
    });
    // 두 근거가 어긋나는 사실이 원장에 그대로 남는다(숨기지 않는다).
    expect(event.projectId).toBe(PROJECT);
    expect(event.worktreeId).toBe(`${pathProject}/${TASK}`);
  });

  it("명시 taskId 가 params 파생보다 우선한다", () => {
    const event = buildLedgerEvent({
      ...baseInput,
      params: { task_id: TASK },
      taskId: "explicit-id",
    });
    expect(event.taskId).toBe("explicit-id");
  });

  it("지시문 원문을 담는 필드가 없다 — 해시만", () => {
    const event = buildLedgerEvent({
      ...baseInput,
      runtime: { instructionHash: hashInstruction("secret prompt") },
    });
    expect(JSON.stringify(event)).not.toContain("secret prompt");
    expect(event.instructionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

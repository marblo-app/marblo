/**
 * "이 터미널이 비어 있는 이유" 판정 — 티켓 r44KdZ4SJL4mZ2K8wC0P.
 *
 * 이 테스트가 지키는 것은 문구가 아니라 **거짓말 금지**다:
 *  - 근거(machineId 스탬프 / 이 기기 id / 에이전트 스냅샷)가 하나라도 없으면
 *    절대 "남의 것" 이라고 말하지 않는다 → 종전 "세션 만료" 문구로 떨어진다.
 *  - 남의 기기 것이라고 확정된 경우엔 **복구(재시작) 안내가 나가지 않는다.**
 */
import { describe, it, expect } from "vitest";
import type { Agent } from "../../src/types/agent";
import {
  classifyAgentMachine,
  classifyTerminalSessionOwnership,
  deadSessionNoticeCopy,
  isRunningElsewhere,
  resolveAgentIdForSession,
} from "../../src/lib/terminalSessionOwnership";

const MINE = "mac-mine-uuid";
const THEIRS = "win-theirs-uuid";
const ME = "uid-me";
const THEM = "uid-them";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    projectId: "p1",
    ownerId: ME,
    name: "frontend-claude",
    model: "claude",
    role: "frontend",
    status: "working",
    currentTaskId: null,
    command: "claude",
    skillFile: "",
    createdAt: new Date(0),
    machineId: MINE,
    ...overrides,
  };
}

function classify(overrides: {
  sessionId?: string;
  sessionIdByAgentId?: Record<string, string>;
  agents?: Agent[];
  agentsHydrated?: boolean;
  localMachineId?: string | null;
  localUserId?: string | null;
}) {
  return classifyTerminalSessionOwnership({
    sessionId: "agent-agent-1",
    sessionIdByAgentId: {},
    agents: [agent()],
    agentsHydrated: true,
    localMachineId: MINE,
    localUserId: ME,
    ...overrides,
  });
}

describe("resolveAgentIdForSession", () => {
  it("원장 매핑을 역인덱스로 푼다", () => {
    expect(resolveAgentIdForSession("pty-abc", { "agent-1": "pty-abc" })).toBe(
      "agent-1",
    );
  });

  it("결정적 fallback id(agent-<id>)도 푼다 — 티켓 상세가 여는 경로", () => {
    expect(resolveAgentIdForSession("agent-abc123", {})).toBe("abc123");
  });

  it("에이전트로 환원되지 않는 셸 탭은 null", () => {
    expect(resolveAgentIdForSession("d1f2-user-shell", {})).toBeNull();
    expect(resolveAgentIdForSession("agent-", {})).toBeNull();
    expect(resolveAgentIdForSession("", {})).toBeNull();
  });
});

describe("classifyTerminalSessionOwnership — 세 상태를 가른다", () => {
  it("① 내 기기가 띄운 에이전트 → own", () => {
    expect(classify({}).ownership).toBe("own");
  });

  it("② 다른 계정의 기기 → foreign-user", () => {
    const v = classify({
      agents: [agent({ machineId: THEIRS, ownerId: THEM })],
    });
    expect(v.ownership).toBe("foreign-user");
    expect(v.agent?.id).toBe("agent-1");
  });

  it("② 같은 계정의 다른 기기 → foreign-machine ('다른 팀원' 이라 하지 않는다)", () => {
    expect(
      classify({ agents: [agent({ machineId: THEIRS, ownerId: ME })] })
        .ownership,
    ).toBe("foreign-machine");
  });

  it("③ 에이전트 doc 자체가 없다 → agent-missing", () => {
    expect(classify({ agents: [] }).ownership).toBe("agent-missing");
  });
});

describe("근거가 없으면 안전한 쪽(unknown)으로 떨어진다", () => {
  it("에이전트 세션이 아니면(사용자 셸) unknown", () => {
    expect(classify({ sessionId: "plain-shell" }).ownership).toBe("unknown");
  });

  it("스냅샷 미도착이면 '없다' 를 주장하지 않는다", () => {
    expect(classify({ agents: [], agentsHydrated: false }).ownership).toBe(
      "unknown",
    );
  });

  it("machineId 스탬프가 없는 구 doc 은 unknown — 남의 것이라 단정 금지", () => {
    expect(
      classify({ agents: [agent({ machineId: undefined, ownerId: THEM })] })
        .ownership,
    ).toBe("unknown");
  });

  it("이 기기 machineId 가 아직 안 왔으면 unknown", () => {
    expect(
      classify({
        agents: [agent({ machineId: THEIRS, ownerId: THEM })],
        localMachineId: null,
      }).ownership,
    ).toBe("unknown");
  });

  it("로그인 uid 를 모르면 '다른 팀원' 대신 기기 축으로만 말한다", () => {
    expect(
      classify({
        agents: [agent({ machineId: THEIRS, ownerId: THEM })],
        localUserId: null,
      }).ownership,
    ).toBe("foreign-machine");
  });
});

describe("classifyAgentMachine — 세션 매핑 없이 doc 하나만 볼 때", () => {
  it("같은 기기 → own / 다른 계정 → foreign-user / 근거 없음 → unknown", () => {
    expect(classifyAgentMachine(agent(), MINE, ME)).toBe("own");
    expect(
      classifyAgentMachine(
        agent({ machineId: THEIRS, ownerId: THEM }),
        MINE,
        ME,
      ),
    ).toBe("foreign-user");
    expect(
      classifyAgentMachine(agent({ machineId: undefined }), MINE, ME),
    ).toBe("unknown");
  });
});

describe("deadSessionNoticeCopy — 복구 안내가 나가는 조건", () => {
  const RESTART_HINT = "terminal.session.restartHint";

  it("① own 은 종전 문구 + 복구 안내 그대로", () => {
    const copy = deadSessionNoticeCopy("own");
    expect(copy.titleKey).toBe("terminal.session.expired");
    expect(copy.hintKey).toBe(RESTART_HINT);
  });

  it("판정 불가(unknown)도 종전 문구 그대로 — 안전한 쪽", () => {
    expect(deadSessionNoticeCopy("unknown")).toEqual(
      deadSessionNoticeCopy("own"),
    );
  });

  it("② 남의 기기에서 도는 상태에는 복구 안내를 절대 넣지 않는다", () => {
    for (const ownership of ["foreign-user", "foreign-machine"] as const) {
      const copy = deadSessionNoticeCopy(ownership);
      expect(isRunningElsewhere(ownership)).toBe(true);
      expect(copy.hintKey).not.toBe(RESTART_HINT);
      expect(copy.hintKey).toBe("terminal.session.remoteHint");
      // 고장이 아니라 정상 — 경고색(33)이 아니다.
      expect(copy.color).toBe("36");
    }
  });

  it("②의 두 갈래는 서로 다른 문구다", () => {
    expect(deadSessionNoticeCopy("foreign-user").titleKey).not.toBe(
      deadSessionNoticeCopy("foreign-machine").titleKey,
    );
  });

  it("③ 에이전트 없음도 복구 안내 없이 자기 문구를 쓴다", () => {
    const copy = deadSessionNoticeCopy("agent-missing");
    expect(copy.titleKey).toBe("terminal.session.agentMissing");
    expect(copy.hintKey).not.toBe(RESTART_HINT);
  });

  it("세 상태의 제목 키가 모두 다르다", () => {
    const titles = (["own", "foreign-user", "agent-missing"] as const).map(
      (o) => deadSessionNoticeCopy(o).titleKey,
    );
    expect(new Set(titles).size).toBe(3);
  });
});

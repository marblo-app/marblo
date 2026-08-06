import { describe, it, expect } from "vitest";

/**
 * 감사 로그 뷰 파생 계층(src/lib/projectAuditView.ts) 계약.
 *
 * lib/projectAudit.test.ts 와 같은 이유로 이 파일은 firebase 를 타지 않는다 —
 * 타면 VITE_FIREBASE_* 부재로 모듈 로드 시점에 죽는다.
 */
import {
  AUDIT_TOOL_LABEL_KEYS,
  AUDIT_TYPE_LABEL_KEYS,
  auditBadgeKind,
  auditTypeLabelKey,
  auditToolLabelKey,
  auditMetadataSummary,
  auditSealStatus,
  auditStatusTarget,
  auditToolParamSummary,
  resolveActorLabel,
  resolveTaskLabel,
  isPermissionDenied,
  auditStateFromError,
  auditEmptyKind,
  agentAuditRow,
  agentTypeFilterValue,
  auditLedgerDetail,
  auditSourceNotices,
  buildAuditRows,
  buildTicketLedgerRows,
  foldAuditRows,
  humanAuditRow,
  isAuditLoading,
  isFullyDenied,
  isLowSignalAuditRow,
  ledgerFieldValue,
  mergeAuditActors,
  mergeAuditRows,
  parseAuditTypeFilter,
  taskIdFromCreateTaskResult,
  type UnifiedAuditRow,
} from "../../src/lib/projectAuditView";
import type { AuditLog } from "../../src/types/audit";
import type { ProjectAuditEvent } from "../../src/types/projectAudit";
import {
  PROJECT_AUDIT_EVENT_TYPES,
  PROJECT_AUDIT_SINCE_VERSION,
} from "../../src/lib/projectAudit";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

describe("auditTypeLabelKey — 라벨", () => {
  it("알려진 종류 전부에 라벨 키가 있다", () => {
    // 새 type 을 추가하고 라벨을 빼먹으면 화면에 raw 키가 찍힌다.
    for (const type of PROJECT_AUDIT_EVENT_TYPES) {
      expect(AUDIT_TYPE_LABEL_KEYS[type]).toBeTruthy();
      expect(auditTypeLabelKey(type)).toBe(AUDIT_TYPE_LABEL_KEYS[type]);
    }
  });

  it("모르는 종류도 행을 떨구지 않고 '알 수 없음' 으로 접는다", () => {
    // 새 클라이언트가 쓴 type 을 옛 클라이언트가 읽는 경우. 숨기면 조용한 누락.
    expect(auditTypeLabelKey("task.exploded")).toBe(
      "project.audit.type.unknown"
    );
  });
});

describe("resolveActorLabel — 이름 메꿈", () => {
  it("기록된 actorName 을 그대로 쓴다", () => {
    expect(resolveActorLabel({ actorUid: "u1", actorName: "John" })).toBe(
      "John"
    );
  });

  it("actorName 이 비면 현재 멤버 목록으로 메꾼다", () => {
    expect(
      resolveActorLabel({ actorUid: "u1", actorName: null }, { u1: "Jane" })
    ).toBe("Jane");
    // 공백만 있는 이름도 비어 있는 것으로 본다.
    expect(
      resolveActorLabel({ actorUid: "u1", actorName: "   " }, { u1: "Jane" })
    ).toBe("Jane");
  });

  it("둘 다 없으면 uid 앞자리 — 빈 칸으로 두지 않는다", () => {
    expect(
      resolveActorLabel({ actorUid: "abcdefghijkl", actorName: null })
    ).toBe("abcdefgh");
  });
});

describe("auditMetadataSummary — 메타 요약", () => {
  it("상태 전이는 양끝을 보여준다", () => {
    expect(
      auditMetadataSummary("task.status_changed", {
        from: "TODO",
        to: "IN_PROGRESS",
      })
    ).toBe("TODO → IN_PROGRESS");
  });

  it("한쪽만 있으면 있는 쪽만", () => {
    expect(auditMetadataSummary("task.status_changed", { to: "DONE" })).toBe(
      "DONE"
    );
  });

  it("스폰은 이름·모델·역할을 잇는다", () => {
    expect(
      auditMetadataSummary("agent.spawned", {
        agentName: "frontend-1",
        model: "claude",
        role: "frontend",
      })
    ).toBe("frontend-1 · claude · frontend");
  });

  it("빈 메타·모르는 종류·비스칼라 값에도 터지지 않고 null", () => {
    expect(auditMetadataSummary("agent.spawned", {})).toBeNull();
    expect(auditMetadataSummary("task.claimed", { taskId: "t1" })).toBeNull();
    expect(auditMetadataSummary("chat.message.sent", undefined)).toBeNull();
    // 숫자만 있는 채팅 메타(길이) — 본문이 없으니 요약도 없다.
    expect(
      auditMetadataSummary("chat.message.sent", { contentLength: 12 })
    ).toBeNull();
  });
});

describe("권한 분기 — denied 와 error 는 다른 값", () => {
  it("FirebaseError code 로 권한 거부를 잡는다", () => {
    expect(isPermissionDenied({ code: "permission-denied" })).toBe(true);
    expect(isPermissionDenied({ code: "unauthenticated" })).toBe(true);
  });

  it("code 를 잃고 메시지만 남은 래핑 에러도 잡는다", () => {
    expect(
      isPermissionDenied(
        new Error("FirebaseError: Missing or insufficient permissions.")
      )
    ).toBe(true);
  });

  it("권한과 무관한 실패는 denied 가 아니다", () => {
    // 인덱스 누락은 owner 도 겪는다 — '권한 없음' 으로 안내하면 진짜 원인을 가린다.
    expect(isPermissionDenied({ code: "failed-precondition" })).toBe(false);
    expect(isPermissionDenied(new Error("network error"))).toBe(false);
  });

  it("auditStateFromError 가 두 갈래를 서로 다른 상태로 접는다", () => {
    expect(auditStateFromError({ code: "permission-denied" })).toEqual({
      status: "denied",
    });

    const state = auditStateFromError(new Error("index required"));
    expect(state.status).toBe("error");
    // 원문 메시지를 남긴다 — 인덱스 누락 같은 원인이 여기 말고는 안 드러난다.
    expect(state).toMatchObject({ message: "index required" });
  });

  it("★권한 거부를 '기록 없음'(빈 배열)으로 위장하지 않는다", () => {
    // 감사에서 "못 본다"와 "없다"가 같은 화면이면 안 된다.
    const denied = auditStateFromError({ code: "permission-denied" });
    expect(denied).not.toMatchObject({ status: "ready" });
  });
});

describe("auditEmptyKind — 빈 화면이 '왜' 비었는지", () => {
  it("필터가 없으면 진짜 0건(noRecordsYet)", () => {
    expect(auditEmptyKind({})).toBe("noRecordsYet");
    expect(auditEmptyKind({ actorUid: undefined, type: undefined })).toBe(
      "noRecordsYet"
    );
  });

  it("구성원/종류 어느 쪽이든 걸려 있으면 filtered", () => {
    expect(auditEmptyKind({ actorUid: "u1" })).toBe("filtered");
    expect(auditEmptyKind({ type: "chat.message.sent" })).toBe("filtered");
    expect(auditEmptyKind({ actorUid: "u1", type: "agent.spawned" })).toBe(
      "filtered"
    );
  });

  it("★필터 탓인 빈 화면을 '아직 기록 없음'으로 뭉개지 않는다", () => {
    // 필터를 걸어놓고 "이 버전부터 쌓입니다"를 읽으면 owner 는 "기록이 통째로
    // 없다"는 엉뚱한 결론에 도달한다. 전체로는 기록이 있을 수 있다.
    expect(auditEmptyKind({ actorUid: "u1" })).not.toBe(auditEmptyKind({}));
  });
});

describe("빈 화면 안내 문구 — 감사에서 '없음'과 '못 봄'을 가른다", () => {
  const KEYS = [
    "project.audit.emptyTitle",
    "project.audit.emptyDesc",
    "project.audit.emptyAgentNote",
    "project.audit.emptyFilteredTitle",
    "project.audit.emptyFilteredDesc",
  ] as const;

  it("ko/en 양쪽에 문구가 다 있다", () => {
    for (const key of KEYS) {
      expect(ko[key]?.trim()).toBeTruthy();
      expect(en[key]?.trim()).toBeTruthy();
    }
  });

  it("emptyDesc 는 {version} 을 치환받는다 — 하드코딩 금지", () => {
    // 버전을 문구에 직접 박으면 ko/en 한쪽만 고치는 드리프트가 난다.
    expect(ko["project.audit.emptyDesc"]).toContain("{version}");
    expect(en["project.audit.emptyDesc"]).toContain("{version}");
    expect(PROJECT_AUDIT_SINCE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("★안내가 '에이전트 행위는 여기 안 잡힌다'를 말한다", () => {
    // 이 패널이 정상 운영 중에도 자주 비는 진짜 이유. 말해주지 않으면
    // 기능 고장으로 접수된다(이 티켓이 그렇게 시작됐다).
    expect(ko["project.audit.emptyAgentNote"]).toContain("에이전트");
    expect(en["project.audit.emptyAgentNote"].toLowerCase()).toContain("agent");
  });

  it("★'권한 없음' 문구와 '기록 없음' 문구가 서로 다르다", () => {
    expect(ko["project.audit.emptyTitle"]).not.toBe(ko["project.audit.denied"]);
    expect(en["project.audit.emptyTitle"]).not.toBe(en["project.audit.denied"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 통합 뷰 — 사람(projectAuditLog) + 오케(audit_logs 원장) 읽기병합
// ═══════════════════════════════════════════════════════════════════

function humanEvent(over: Partial<ProjectAuditEvent> = {}): ProjectAuditEvent {
  return {
    id: "h1",
    projectId: "p1",
    actorUid: "u1",
    actorName: "John",
    type: "chat.message.sent",
    taskId: null,
    targetId: "m1",
    metadata: { messageType: "text" },
    createdAt: new Date("2026-08-01T10:00:00Z"),
    ...over,
  };
}

function ledgerEvent(over: Partial<AuditLog> = {}): AuditLog {
  return {
    id: "a1",
    projectId: "p1",
    agentId: "agent-1",
    toolName: "update_task_status",
    params: { task_id: "t1", secret: "should-never-render" },
    result: "ok",
    duration: 12,
    success: true,
    createdAt: new Date("2026-08-01T11:00:00Z"),
    kind: "action",
    actorUid: "u1",
    model: "claude",
    tier: "complex",
    instructionHash: "sha256:deadbeef",
    taskId: "t1",
    worktreeId: "p1/t1",
    ...over,
  };
}

describe("humanAuditRow / agentAuditRow — 소스 태깅", () => {
  it("사람 행은 actorKind='human' 이고 모델이 없다", () => {
    const row = humanAuditRow(humanEvent());

    expect(row.actorKind).toBe("human");
    expect(row.model).toBeNull();
    expect(row.failed).toBe(false);
    expect(row.label).toEqual({
      kind: "i18n",
      key: "project.audit.type.chatMessageSent",
    });
  });

  it("오케 행은 actorKind='agent' 이고 아는 툴은 사람이 읽는 라벨로 번역된다", () => {
    // ★#730 방침을 이 티켓(사장님 도그푸딩 피드백)이 뒤집는다 — raw toolName
    // 은 감사 뷰로선 의미가 안 보인다. 원문은 버리지 않고 라벨에 같이 싣는다
    // (kind:"tool" — 화면은 title/hover 로 대조).
    const row = agentAuditRow(ledgerEvent());

    expect(row.actorKind).toBe("agent");
    expect(row.label).toEqual({
      kind: "tool",
      key: "project.audit.tool.updateTaskStatus",
      toolName: "update_task_status",
    });
    expect(row.model).toBe("claude");
    expect(row.taskId).toBe("t1");
  });

  it("모르는 툴은 예전처럼 raw 그대로 — 새 MCP 툴이 추가돼도 행이 숨지 않는다", () => {
    const row = agentAuditRow(ledgerEvent({ toolName: "some_future_tool" }));

    expect(row.label).toEqual({ kind: "raw", text: "some_future_tool" });
  });

  it("★오케 행의 이름은 '에이전트'가 아니라 **발주한 사람**이다", () => {
    // 원장의 actorUid = 그 에이전트를 발주한 사람의 uid. 이게 두 소스가
    // 같은 구성원 축으로 병합될 수 있는 이유다.
    const row = agentAuditRow(ledgerEvent({ actorUid: "u2" }), {
      u2: "Jane",
    });

    expect(row.actorUid).toBe("u2");
    expect(row.actorLabel).toBe("Jane");
  });

  it("이름을 못 메꾸면 uid 앞자리로 떨어진다 — 사람 쪽과 같은 규칙", () => {
    // 같은 사람이 두 소스에서 다른 이름으로 보이면 안 된다.
    const uid = "abcdefghijklmnop";
    expect(agentAuditRow(ledgerEvent({ actorUid: uid })).actorLabel).toBe(
      humanAuditRow(humanEvent({ actorUid: uid, actorName: null })).actorLabel
    );
  });

  it("★귀속 불가(actorUid 없음) 행도 버리지 않는다", () => {
    // 원장 확장 이전 문서엔 actorUid 필드가 아예 없다. 행을 떨구면 오래된
    // 기록이 조용히 사라진다 — 감사에서 가장 나쁜 실패.
    const row = agentAuditRow(ledgerEvent({ actorUid: undefined }));

    expect(row.actorUid).toBeNull();
    expect(row.actorLabel).toBeNull(); // 호출부가 "귀속 불가"를 그린다
    expect(row.label).toEqual({
      kind: "tool",
      key: "project.audit.tool.updateTaskStatus",
      toolName: "update_task_status",
    });
  });

  it("실패한 툴 호출을 표시한다 — 단, success 부재를 실패로 단정하지 않는다", () => {
    expect(agentAuditRow(ledgerEvent({ success: false })).failed).toBe(true);
    expect(
      agentAuditRow(ledgerEvent({ success: undefined as never })).failed
    ).toBe(false);
  });

  it("★두 소스의 key 가 문서 id 가 같아도 충돌하지 않는다", () => {
    // 컬렉션이 다르면 id 네임스페이스도 다르다. 충돌하면 React 가 행을 조용히
    // 덮어써서 감사 기록이 화면에서 사라진다.
    const same = "SAME_ID";
    expect(humanAuditRow(humanEvent({ id: same })).key).not.toBe(
      agentAuditRow(ledgerEvent({ id: same })).key
    );
  });
});

describe("★프라이버시 경계 — 원장 원문은 뷰로 새지 않는다", () => {
  it("params 원문도 instructionHash 도 행에 담기지 않는다", () => {
    // 툴 인자에는 지시문·경로·티켓 본문이 그대로 들어오고 거기 자격증명이
    // 섞일 수 있다. 원장은 불변이라 한번 새면 되돌릴 수 없다.
    const row = agentAuditRow(
      ledgerEvent({ params: { token: "sk-live-super-secret" } })
    );

    expect(JSON.stringify(row)).not.toContain("sk-live-super-secret");
    expect(JSON.stringify(row)).not.toContain("deadbeef");
  });

  it("detail 은 티어만 싣는다(model·toolName·taskId 는 전용 칸)", () => {
    expect(auditLedgerDetail({ tier: "complex" })).toBe("complex");
    expect(auditLedgerDetail({ tier: null })).toBeNull();
    expect(auditLedgerDetail({ tier: "   " })).toBeNull();
  });
});

describe("mergeAuditRows / buildAuditRows — 병합", () => {
  it("★두 소스를 하나의 최신순 타임라인으로 접는다", () => {
    // 이어붙이기만 하면 경계에서 시간이 뒤섞인다(사람 3건 뒤에 오케 100건).
    const rows = buildAuditRows(
      [
        humanEvent({ id: "h1", createdAt: new Date("2026-08-01T09:00:00Z") }),
        humanEvent({ id: "h2", createdAt: new Date("2026-08-01T12:00:00Z") }),
      ],
      [
        ledgerEvent({ id: "a1", createdAt: new Date("2026-08-01T10:00:00Z") }),
        ledgerEvent({ id: "a2", createdAt: new Date("2026-08-01T13:00:00Z") }),
      ]
    );

    expect(rows.map((r) => r.key)).toEqual([
      "agent:a2",
      "human:h2",
      "agent:a1",
      "human:h1",
    ]);
  });

  it("한쪽이 비어도 나머지가 그대로 나온다", () => {
    expect(buildAuditRows([humanEvent()], [])).toHaveLength(1);
    expect(buildAuditRows([], [ledgerEvent()])).toHaveLength(1);
    expect(buildAuditRows([], [])).toEqual([]);
  });

  it("createdAt 이 깨져도 터지지 않고 맨 뒤로 간다", () => {
    const broken = {
      key: "x",
      actorKind: "agent",
      createdAt: new Date("nope"),
      actorLabel: null,
      actorUid: null,
      label: { kind: "raw", text: "t" },
      detail: null,
      taskId: null,
      model: null,
      failed: false,
    } as UnifiedAuditRow;

    const rows = mergeAuditRows([broken], [humanAuditRow(humanEvent())]);
    expect(rows.at(-1)!.key).toBe("x");
  });
});

// ── 티켓 원장 상세(티켓 U6ITRR38Z3c4MGLyg2PU) ───────────────────────

/** §5 확장 필드가 아예 없는 문서 — 원장 확장 이전에 쓰인 기록의 실제 모양. */
function preLedgerEvent(over: Partial<AuditLog> = {}): AuditLog {
  const event = ledgerEvent(over);
  const {
    kind: _kind,
    actorUid: _actorUid,
    model: _model,
    tier: _tier,
    instructionHash: _instructionHash,
    taskId: _taskId,
    worktreeId: _worktreeId,
    ...rest
  } = event;
  return rest as AuditLog;
}

describe("ledgerFieldValue — preLedger vs 규약 밖 vs 값 있음", () => {
  it("필드 자체가 없으면 preLedger", () => {
    expect(ledgerFieldValue(preLedgerEvent(), "worktreeId")).toEqual({
      state: "preLedger",
    });
  });

  it("필드는 있는데 null 이면 outOfConvention", () => {
    expect(
      ledgerFieldValue(ledgerEvent({ worktreeId: null }), "worktreeId")
    ).toEqual({ state: "outOfConvention" });
  });

  it("값이 있으면 그대로 싣는다", () => {
    expect(
      ledgerFieldValue(ledgerEvent({ worktreeId: "p1/t1" }), "worktreeId")
    ).toEqual({ state: "value", value: "p1/t1" });
  });

  it("preLedger 와 outOfConvention 을 같은 값으로 접지 않는다", () => {
    // "확실한 척 금지" — 둘 다 "없음"으로 보이면 안 된다(스펙 요구사항).
    const a = ledgerFieldValue(preLedgerEvent(), "worktreeId");
    const b = ledgerFieldValue(ledgerEvent({ worktreeId: null }), "worktreeId");
    expect(a).not.toEqual(b);
  });
});

describe("auditSealStatus — 체인 봉인 상태", () => {
  it("seq/prevHash/hash 가 셋 다 있어야 sealed", () => {
    expect(auditSealStatus({ seq: 1, prevHash: "aa", hash: "bb" })).toBe(
      "sealed"
    );
  });

  it("★L3 미배선이라 지금은 항상 unsealed — 지어내지 않는다", () => {
    expect(auditSealStatus(ledgerEvent())).toBe("unsealed");
    expect(auditSealStatus({ seq: 1 })).toBe("unsealed");
    expect(auditSealStatus({ prevHash: "aa", hash: "bb" })).toBe("unsealed");
  });
});

describe("buildTicketLedgerRows — 티켓 상세 병합", () => {
  it("사람 행은 sealStatus/worktree 가 null(체인·워크트리 개념이 없다)", () => {
    const [row] = buildTicketLedgerRows([humanEvent()], []);
    expect(row.sealStatus).toBeNull();
    expect(row.worktree).toBeNull();
  });

  it("오케 행은 sealStatus/worktree 가 채워진다", () => {
    const [row] = buildTicketLedgerRows(
      [],
      [ledgerEvent({ worktreeId: "p1/t1" })]
    );
    expect(row.sealStatus).toBe("unsealed");
    expect(row.worktree).toEqual({ state: "value", value: "p1/t1" });
  });

  it("preLedger 오케 행도 버리지 않고 표시 상태만 preLedger 로 싣는다", () => {
    const [row] = buildTicketLedgerRows([], [preLedgerEvent()]);
    expect(row.worktree).toEqual({ state: "preLedger" });
  });

  it("최신순 병합은 buildAuditRows 와 같은 규칙을 따른다", () => {
    const rows = buildTicketLedgerRows(
      [humanEvent({ id: "h1", createdAt: new Date("2026-08-01T09:00:00Z") })],
      [ledgerEvent({ id: "a1", createdAt: new Date("2026-08-01T10:00:00Z") })]
    );
    expect(rows.map((r) => r.key)).toEqual(["agent:a1", "human:h1"]);
  });
});

describe("parseAuditTypeFilter — 종류 필터가 소스를 가른다", () => {
  it("빈 값은 두 소스 모두", () => {
    expect(parseAuditTypeFilter(undefined)).toEqual({ source: "both" });
    expect(parseAuditTypeFilter("")).toEqual({ source: "both" });
  });

  it("사람 종류를 고르면 사람 소스만", () => {
    expect(parseAuditTypeFilter("agent.spawned")).toEqual({
      source: "human",
      type: "agent.spawned",
    });
  });

  it("툴 이름을 고르면 원장 소스만", () => {
    expect(parseAuditTypeFilter(agentTypeFilterValue("spawn_agent"))).toEqual({
      source: "agent",
      toolName: "spawn_agent",
    });
  });

  it("★두 네임스페이스가 섞여도 갈린다", () => {
    // 사람 종류 'agent.spawned' 와 툴 이름 'spawn_agent' 는 서로 다른 축이다.
    expect(parseAuditTypeFilter("agent.spawned").source).toBe("human");
    expect(parseAuditTypeFilter("tool:agent.spawned").source).toBe("agent");
  });

  it("모르는 값은 '아무것도 안 보임'이 아니라 전체로 접는다", () => {
    // 옛 선택값이 남으면 화면이 영구히 0건이 되고 사용자는 기록 없음으로 읽는다.
    expect(parseAuditTypeFilter("task.exploded")).toEqual({ source: "both" });
    expect(parseAuditTypeFilter("tool:")).toEqual({ source: "both" });
  });
});

describe("★소스별 에러 격리 — 한 소스가 다른 소스를 죽이지 않는다", () => {
  const ready = { status: "ready", count: 3 } as const;
  const denied = { status: "denied" } as const;
  const failed = { status: "error", message: "index missing" } as const;

  it("한쪽만 거부면 전체 거부 화면이 아니다", () => {
    // 원장은 멤버 전원 read 인데 사람 쪽 거부 하나로 통째로 가리면,
    // 볼 수 있는 것을 못 보게 만드는 회귀가 된다.
    expect(isFullyDenied({ human: denied, agent: ready })).toBe(false);
    expect(isFullyDenied({ human: ready, agent: denied })).toBe(false);
    expect(isFullyDenied({ human: denied, agent: denied })).toBe(true);
  });

  it("거부와 에러가 섞이면 전체 거부가 아니다", () => {
    // 서로 다른 사실이라 한 문장으로 뭉개면 권한 문제를 장애로 읽는다.
    expect(isFullyDenied({ human: denied, agent: failed })).toBe(false);
  });

  it("죽은 소스마다 안내를 하나씩 남긴다 — 조용한 부분 목록 금지", () => {
    const notices = auditSourceNotices({ human: denied, agent: failed });

    expect(notices).toEqual([
      { source: "human", state: { status: "denied" } },
      { source: "agent", state: { status: "error", message: "index missing" } },
    ]);
  });

  it("살아 있는/건너뛴 소스는 안내를 만들지 않는다", () => {
    expect(
      auditSourceNotices({ human: ready, agent: { status: "skipped" } })
    ).toEqual([]);
  });

  it("skipped 는 ready(0) 과 다른 값이다", () => {
    // 조회조차 안 한 소스를 "0건"이라 말하면 없는 사실을 단정하게 된다.
    const skipped = { status: "skipped" } as const;
    expect(isAuditLoading({ human: skipped, agent: ready })).toBe(false);
    expect(auditSourceNotices({ human: skipped, agent: skipped })).toEqual([]);
  });

  it("한 소스라도 로딩 중이면 로딩이다", () => {
    expect(isAuditLoading({ human: { status: "loading" }, agent: ready })).toBe(
      true
    );
    expect(isAuditLoading({ human: ready, agent: ready })).toBe(false);
  });
});

describe("mergeAuditActors — 구성원 축은 하나다", () => {
  it("★같은 사람의 사람 행위 + 오케 발주를 한 줄로 합산한다", () => {
    // 두 줄로 갈리면 고르는 순간 반쪽 타임라인이 나온다.
    const merged = mergeAuditActors(
      [{ actorUid: "u1", actorName: "John", count: 3 }],
      [{ actorUid: "u1", actorName: null, count: 40 }]
    );

    expect(merged).toEqual([{ actorUid: "u1", actorName: "John", count: 43 }]);
  });

  it("이름이 있는 쪽이 이긴다(원장엔 이름이 없다)", () => {
    const merged = mergeAuditActors(
      [{ actorUid: "u2", actorName: null, count: 1 }],
      [{ actorUid: "u2", actorName: "Jane", count: 2 }]
    );

    expect(merged[0].actorName).toBe("Jane");
  });

  it("건수 내림차순으로 정렬한다", () => {
    const merged = mergeAuditActors(
      [{ actorUid: "u1", actorName: null, count: 1 }],
      [{ actorUid: "u2", actorName: null, count: 9 }]
    );

    expect(merged.map((a) => a.actorUid)).toEqual(["u2", "u1"]);
  });
});

describe("통합 뷰 i18n — ko/en 짝이 맞는가", () => {
  const KEYS = [
    "project.audit.filterTypeHumanGroup",
    "project.audit.filterTypeAgentGroup",
    "project.audit.actor.human",
    "project.audit.actor.agentHint",
    "project.audit.actor.agentModelUnknown",
    "project.audit.actor.orchestrator",
    "project.audit.actor.orchestratorHint",
    "project.audit.actor.unknown",
    "project.audit.failed",
    "project.audit.notice.humanDenied",
    "project.audit.notice.agentDenied",
    "project.audit.notice.humanError",
    "project.audit.notice.agentError",
    "project.audit.lowSignalToggle",
    "project.audit.lowSignalHiddenCount",
    "project.audit.lowSignalOnlyEmpty",
  ] as const;

  it("ko/en 양쪽에 문구가 다 있다", () => {
    for (const key of KEYS) {
      expect(ko[key]?.trim()).toBeTruthy();
      expect(en[key]?.trim()).toBeTruthy();
    }
  });

  it("★부분 실패 안내가 '거부'와 '장애'를 다른 문구로 말한다", () => {
    expect(ko["project.audit.notice.humanDenied"]).not.toBe(
      ko["project.audit.notice.humanError"]
    );
    expect(en["project.audit.notice.agentDenied"]).not.toBe(
      en["project.audit.notice.agentError"]
    );
  });

  it("★빈 화면 안내가 더 이상 '에이전트 행위는 여기 안 잡힌다'고 말하지 않는다", () => {
    // 이제 잡힌다. 옛 문구를 그대로 두면 안내 자체가 거짓이 된다.
    expect(ko["project.audit.emptyAgentNote"]).not.toContain(
      "액티비티 스트림에 남습니다"
    );
    expect(en["project.audit.emptyAgentNote"]).not.toContain("not here");
    // 대신 여전히 안 잡히는 것을 말한다.
    expect(ko["project.audit.emptyAgentNote"]).toContain("MCP");
    expect(en["project.audit.emptyAgentNote"]).toContain("MCP");
  });
});

describe("auditToolLabelKey / AUDIT_TOOL_LABEL_KEYS — 오케 툴 라벨", () => {
  it("★티켓이 예로 든 4개 툴에 라벨이 있다", () => {
    for (const tool of [
      "create_task",
      "submit_for_review",
      "update_task_status",
      "add_activity",
    ]) {
      expect(auditToolLabelKey(tool)).toBeTruthy();
    }
  });

  it("모르는 툴은 null — 호출부가 raw 로 떨어진다", () => {
    expect(auditToolLabelKey("some_future_tool")).toBeNull();
  });

  it("등록된 라벨 키 전부가 ko/en 에 실제로 존재한다", () => {
    for (const key of Object.values(AUDIT_TOOL_LABEL_KEYS)) {
      expect(ko[key]?.trim()).toBeTruthy();
      expect(en[key]?.trim()).toBeTruthy();
    }
  });
});

describe("auditStatusTarget — update_task_status 목표 상태만 화이트리스트로", () => {
  it("update_task_status + 유효 enum 이면 목표 상태를 뽑는다", () => {
    expect(
      auditStatusTarget({
        toolName: "update_task_status",
        params: { status: "DONE" },
      })
    ).toBe("DONE");
  });

  it("다른 툴이면 params 에 status 가 있어도 null", () => {
    expect(
      auditStatusTarget({
        toolName: "create_task",
        params: { status: "DONE" },
      })
    ).toBeNull();
  });

  it("enum 밖 값은 null — 지어내지 않는다", () => {
    expect(
      auditStatusTarget({
        toolName: "update_task_status",
        params: { status: "banana" },
      })
    ).toBeNull();
  });

  it("★params 의 다른 필드(자유 텍스트일 수 있는 comment 등)는 절대 새지 않는다", () => {
    const row = agentAuditRow(
      ledgerEvent({
        toolName: "update_task_status",
        params: { status: "DONE", comment: "sk-live-super-secret" },
      })
    );
    expect(row.detail).toContain("DONE");
    expect(JSON.stringify(row)).not.toContain("sk-live-super-secret");
  });
});

describe("auditToolParamSummary — 행 상단 핵심 요약", () => {
  it("create_task 는 티켓 제목을 보여준다", () => {
    expect(
      auditToolParamSummary({
        toolName: "create_task",
        params: { title: "감사뷰 정리" },
        result: "ok",
        model: null,
        tier: null,
      })
    ).toBe("감사뷰 정리");
  });

  it("dispatch_task 는 모델과 역할을 보여준다", () => {
    expect(
      auditToolParamSummary({
        toolName: "dispatch_task",
        params: { model: "codex", role: "frontend" },
        result: "ok",
        model: "codex",
        tier: null,
      })
    ).toBe("codex · frontend");
  });

  it("update_task_status 는 상태 전이를 보여준다", () => {
    expect(
      auditToolParamSummary({
        toolName: "update_task_status",
        params: { from: "REVIEW", status: "DONE" },
        result: "ok",
        model: "codex",
        tier: null,
      })
    ).toBe("REVIEW → DONE");
  });

  it("submit_for_review 는 PR 또는 요약을 보여준다", () => {
    expect(
      auditToolParamSummary({
        toolName: "submit_for_review",
        params: { pr_url: "https://github.com/acme/repo/pull/1" },
        result: "ok",
        model: "codex",
        tier: null,
      })
    ).toBe("https://github.com/acme/repo/pull/1");
  });
});

describe("AuditRowEvidence — raw JSON 대신 정제 텍스트", () => {
  it("params 는 주요 필드 우선 key:value 텍스트로 정렬하고 scrub 한다", () => {
    const row = agentAuditRow(
      ledgerEvent({
        toolName: "submit_for_review",
        params: {
          zeta: "last",
          task_id: "t1",
          summary: { changes: "완료", verification: "tsc" },
          OPENAI_API_KEY: "sk-live-super-secret",
        },
      })
    );

    expect(row.evidence?.paramsJson).toContain("Ticket: t1");
    expect(row.evidence?.paramsJson).toContain("Summary:");
    expect(row.evidence?.paramsJson).toContain("changes: 완료");
    expect(row.evidence?.paramsJson).toContain("OPENAI_API_KEY: <REDACTED>");
    expect(row.evidence?.paramsJson).not.toContain('"task_id"');
    expect(JSON.stringify(row)).not.toContain("sk-live-super-secret");
  });

  it("result 가 JSON 문자열이면 정제 텍스트로 펼친다", () => {
    const row = agentAuditRow(
      ledgerEvent({
        result: JSON.stringify({
          ok: true,
          token: "sk-live-super-secret",
        }),
      })
    );

    expect(row.evidence?.resultText).toContain("ok: true");
    expect(row.evidence?.resultText).toContain("token: <REDACTED>");
    expect(row.evidence?.resultText).not.toContain('"ok"');
  });
});

describe("resolveTaskLabel — 티켓 제목 조인", () => {
  it("제목이 있으면 제목", () => {
    expect(resolveTaskLabel("t1", { t1: "Foo" })).toBe("Foo");
  });

  it("★없으면(물리 삭제 등) 해시로 떨어진다 — 조용히 사라지지 않는다", () => {
    expect(resolveTaskLabel("abcdefghijkl", {})).toBe("#abcdefgh");
  });

  it("taskId 가 없으면 null — 호출부가 칸을 비운다", () => {
    expect(resolveTaskLabel(null, { t1: "Foo" })).toBeNull();
  });
});

describe("auditBadgeKind — 사람 / 오케(모델) / 오케(컨트롤플레인) 3분류", () => {
  it("사람 행은 항상 human", () => {
    expect(auditBadgeKind({ actorKind: "human", model: null })).toBe("human");
  });

  it("모델이 있는 오케 행은 agentModel", () => {
    expect(auditBadgeKind({ actorKind: "agent", model: "claude" })).toBe(
      "agentModel"
    );
  });

  it("★모델이 없는 오케 행은 '모델 미상'이 아니라 orchestratorControlPlane", () => {
    // 스폰된 에이전트 없이 오케 자신이 MCP 툴을 직접 호출한 정상 케이스다 —
    // 오류처럼 읽히는 분류에 섞이면 안 된다.
    expect(auditBadgeKind({ actorKind: "agent", model: null })).toBe(
      "orchestratorControlPlane"
    );
  });
});

describe("foldAuditRows — 같은 티켓의 연속 add_activity 접기", () => {
  it("2건 이상 연속되면 한 그룹으로 접는다", () => {
    const rows = [
      agentAuditRow(
        ledgerEvent({ id: "m3", toolName: "add_activity", taskId: "t1" })
      ),
      agentAuditRow(
        ledgerEvent({ id: "m2", toolName: "add_activity", taskId: "t1" })
      ),
      agentAuditRow(
        ledgerEvent({ id: "m1", toolName: "add_activity", taskId: "t1" })
      ),
    ];

    const display = foldAuditRows(rows);

    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({ kind: "group", taskId: "t1" });
    if (display[0].kind === "group") {
      expect(display[0].rows).toHaveLength(3);
    }
  });

  it("1건뿐이면 접지 않는다 — 접어봐야 화면만 복잡해진다", () => {
    const rows = [
      agentAuditRow(
        ledgerEvent({ id: "m1", toolName: "add_activity", taskId: "t1" })
      ),
    ];

    expect(foldAuditRows(rows)).toEqual([{ kind: "row", row: rows[0] }]);
  });

  it("★다른 티켓이 끼면 그룹이 갈린다 — 연속성은 같은 티켓 안에서만", () => {
    const rows = [
      agentAuditRow(
        ledgerEvent({ id: "a1", toolName: "add_activity", taskId: "t1" })
      ),
      agentAuditRow(
        ledgerEvent({ id: "a2", toolName: "add_activity", taskId: "t2" })
      ),
      agentAuditRow(
        ledgerEvent({ id: "a3", toolName: "add_activity", taskId: "t1" })
      ),
    ];

    const display = foldAuditRows(rows);
    // 셋 다 1건짜리 "그룹"이라 접히지 않고 낱개 행 3개로 남는다.
    expect(display.every((d) => d.kind === "row")).toBe(true);
  });

  it("사람 행·다른 툴은 접기 대상이 아니다", () => {
    const rows = [
      humanAuditRow(humanEvent({ id: "h1", taskId: "t1" })),
      humanAuditRow(humanEvent({ id: "h2", taskId: "t1" })),
      agentAuditRow(
        ledgerEvent({ id: "s1", toolName: "spawn_agent", taskId: "t1" })
      ),
      agentAuditRow(
        ledgerEvent({ id: "s2", toolName: "spawn_agent", taskId: "t1" })
      ),
    ];

    expect(foldAuditRows(rows).every((d) => d.kind === "row")).toBe(true);
  });

  it("★캡처는 그대로다 — 그룹을 펼치면 원본 행 값이 그대로 다시 나온다", () => {
    const original = [
      agentAuditRow(
        ledgerEvent({ id: "m2", toolName: "add_activity", taskId: "t1" })
      ),
      agentAuditRow(
        ledgerEvent({ id: "m1", toolName: "add_activity", taskId: "t1" })
      ),
    ];

    const [display] = foldAuditRows(original);
    expect(display.kind).toBe("group");
    if (display.kind === "group") {
      expect(display.rows).toEqual(original);
    }
  });
});

describe("isLowSignalAuditRow — 텔레그램 발송·메모는 저신호", () => {
  it("send_telegram_message 는 저신호", () => {
    const row = agentAuditRow(
      ledgerEvent({ toolName: "send_telegram_message" })
    );
    expect(isLowSignalAuditRow(row)).toBe(true);
  });

  it("add_activity 는 저신호", () => {
    const row = agentAuditRow(ledgerEvent({ toolName: "add_activity" }));
    expect(isLowSignalAuditRow(row)).toBe(true);
  });

  it("다른 오케 툴은 저신호가 아니다", () => {
    const row = agentAuditRow(ledgerEvent({ toolName: "update_task_status" }));
    expect(isLowSignalAuditRow(row)).toBe(false);
  });

  it("사람 행은 저신호 판정 대상이 아니다(항상 false)", () => {
    const row = humanAuditRow(humanEvent());
    expect(isLowSignalAuditRow(row)).toBe(false);
  });
});

describe("taskIdFromCreateTaskResult — create_task 결과에서 새 태스크 id 메꿈", () => {
  it("★캡처 갭: create_task 는 params 에 task_id 가 없어 원장 taskId 가 항상 null", () => {
    // taskIdFromParams(ledger.ts)가 params.task_id 만 읽는데 create_task 호출
    // 시점엔 그 필드 자체가 없다 — 이 갭이 감사 뷰에서 제목이 안 뜨던 원인.
    const row = agentAuditRow(
      ledgerEvent({
        toolName: "create_task",
        taskId: null,
        params: { title: "새 태스크", role: "frontend" },
        result: "ok",
      })
    );
    expect(row.taskId).toBeNull();
  });

  it("성공 결과 텍스트의 'ID: <id>' 줄에서 id 를 뽑는다", () => {
    const result =
      "Task created successfully!\nID: abc123\nTitle: 새 태스크\nRole: frontend\nPriority: 0\nProject: p1";
    expect(taskIdFromCreateTaskResult(result)).toBe("abc123");
  });

  it("agentAuditRow 가 create_task 행의 taskId 를 result 에서 메꾼다", () => {
    const row = agentAuditRow(
      ledgerEvent({
        toolName: "create_task",
        taskId: null,
        params: { title: "새 태스크", role: "frontend" },
        result:
          "Task created successfully!\nID: abc123\nTitle: 새 태스크\nRole: frontend\nPriority: 0\nProject: p1",
      })
    );
    expect(row.taskId).toBe("abc123");
  });

  it("원장에 taskId 가 이미 있으면 그대로 쓰고 result 는 보지 않는다", () => {
    const row = agentAuditRow(
      ledgerEvent({
        toolName: "create_task",
        taskId: "t1",
        result: "Task created successfully!\nID: abc123\n",
      })
    );
    expect(row.taskId).toBe("t1");
  });

  it("create_task 가 아닌 툴은 result 에 'ID:' 가 있어도 뽑지 않는다", () => {
    const row = agentAuditRow(
      ledgerEvent({
        toolName: "update_task_status",
        taskId: null,
        result: "ID: abc123",
      })
    );
    expect(row.taskId).toBeNull();
  });

  it("실패 결과 등 'ID:' 가 없으면 null — 지어내지 않는다", () => {
    expect(taskIdFromCreateTaskResult("Error: No project context.")).toBeNull();
  });
});

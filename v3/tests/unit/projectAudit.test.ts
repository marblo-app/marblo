import { describe, it, expect } from "vitest";

/**
 * 협업 감사 로그 순수 계층(src/lib/projectAudit.ts) 계약.
 *
 * 이 파일이 `lib/firebase` 를 타지 않는다는 것 자체가 계약의 일부다 — 타면
 * VITE_FIREBASE_* 부재로 모듈 로드 시점에 throw 해서 테스트가 통째로 죽는다.
 */
import {
  buildProjectAuditEvent,
  chatAuditMetadata,
  taskStatusAuditMetadata,
  agentSpawnAuditMetadata,
  normalizeAuditLimit,
  sortAuditEventsDesc,
  isProjectAuditEventType,
  PROJECT_AUDIT_EVENT_TYPES,
  PROJECT_AUDIT_DEFAULT_LIMIT,
  PROJECT_AUDIT_MAX_LIMIT,
} from "../../src/lib/projectAudit";

describe("buildProjectAuditEvent — 귀속", () => {
  it("projectId + actorUid 가 있으면 레코드를 조립한다", () => {
    const event = buildProjectAuditEvent({
      projectId: "p1",
      actorUid: "u1",
      actorName: "John",
      type: "chat.message.sent",
      taskId: "t1",
      targetId: "m1",
      metadata: { contentLength: 12 },
    });

    expect(event).toEqual({
      projectId: "p1",
      actorUid: "u1",
      actorName: "John",
      type: "chat.message.sent",
      taskId: "t1",
      targetId: "m1",
      metadata: { contentLength: 12 },
    });
  });

  it("actorUid 가 없으면 null — 귀속 불가한 감사 기록은 만들지 않는다", () => {
    // 룰이 actorUid == request.auth.uid 를 강제하므로 어차피 거부된다.
    // 조립 단계에서 명시적으로 떨궈 호출부가 warn 을 남길 수 있게 한다.
    expect(
      buildProjectAuditEvent({
        projectId: "p1",
        actorUid: null,
        type: "agent.spawned",
      }),
    ).toBeNull();

    expect(
      buildProjectAuditEvent({
        projectId: "p1",
        actorUid: undefined,
        type: "agent.spawned",
      }),
    ).toBeNull();
  });

  it("공백뿐인 actorUid/projectId 도 귀속 불가로 본다", () => {
    expect(
      buildProjectAuditEvent({
        projectId: "p1",
        actorUid: "   ",
        type: "agent.spawned",
      }),
    ).toBeNull();

    expect(
      buildProjectAuditEvent({
        projectId: "  ",
        actorUid: "u1",
        type: "agent.spawned",
      }),
    ).toBeNull();
  });

  it("빈 옵셔널 필드는 undefined 가 아니라 null 로 박는다", () => {
    // Firestore 는 없는 필드를 질의할 수 없다. "값 없음"과 "이 필드가 생기기 전
    // 기록"을 구분하려면 null 이 실제로 저장돼 있어야 한다(원장 §8 과 동일 방침).
    const event = buildProjectAuditEvent({
      projectId: "p1",
      actorUid: "u1",
      type: "agent.spawned",
    });

    expect(event).not.toBeNull();
    expect(event!.taskId).toBeNull();
    expect(event!.targetId).toBeNull();
    expect(event!.actorName).toBeNull();
    expect(event!.metadata).toEqual({});
  });

  it("주변 공백을 다듬어 같은 행위자가 두 사람으로 갈리지 않게 한다", () => {
    const event = buildProjectAuditEvent({
      projectId: " p1 ",
      actorUid: " u1 ",
      actorName: " John ",
      type: "task.claimed",
    });

    expect(event!.projectId).toBe("p1");
    expect(event!.actorUid).toBe("u1");
    expect(event!.actorName).toBe("John");
  });
});

describe("메타데이터 — 프라이버시 경계", () => {
  it("채팅 메타에 본문이 절대 들어가지 않는다", () => {
    const secret = "내 비밀번호는 hunter2 이고 카드번호는 4111-1111-1111-1111";
    const meta = chatAuditMetadata("user", secret);

    expect(meta).toEqual({ messageType: "user", contentLength: secret.length });
    // 어떤 값에도 본문 조각이 실리지 않아야 한다(미리보기 필드 추가 회귀 방지).
    for (const value of Object.values(meta)) {
      if (typeof value === "string") {
        expect(secret.includes(value)).toBe(false);
      }
    }
    expect(JSON.stringify(meta)).not.toContain("hunter2");
    expect(JSON.stringify(meta)).not.toContain("4111");
  });

  it("빈 채팅 본문도 길이 0 으로 기록된다", () => {
    expect(chatAuditMetadata("user", "")).toEqual({
      messageType: "user",
      contentLength: 0,
    });
  });

  it("태스크 전이는 양끝을 남긴다", () => {
    expect(taskStatusAuditMetadata("IN_PROGRESS", "REVIEW")).toEqual({
      from: "IN_PROGRESS",
      to: "REVIEW",
    });
  });

  it("스폰 메타는 벤더/역할/이름만 남긴다(지시문 원문 없음)", () => {
    expect(agentSpawnAuditMetadata("backend-1", "claude", "backend")).toEqual({
      agentName: "backend-1",
      model: "claude",
      role: "backend",
    });
  });
});

describe("normalizeAuditLimit", () => {
  it("미지정이면 기본값", () => {
    expect(normalizeAuditLimit(undefined)).toBe(PROJECT_AUDIT_DEFAULT_LIMIT);
  });

  it("0·음수·NaN 은 기본값으로 접는다", () => {
    // 0 을 그대로 넘기면 Firestore 가 throw 하고, 감사 뷰가 통째로 빈다.
    expect(normalizeAuditLimit(0)).toBe(PROJECT_AUDIT_DEFAULT_LIMIT);
    expect(normalizeAuditLimit(-5)).toBe(PROJECT_AUDIT_DEFAULT_LIMIT);
    expect(normalizeAuditLimit(Number.NaN)).toBe(PROJECT_AUDIT_DEFAULT_LIMIT);
    expect(normalizeAuditLimit(Number.POSITIVE_INFINITY)).toBe(
      PROJECT_AUDIT_DEFAULT_LIMIT,
    );
  });

  it("상한을 넘으면 상한으로 자른다", () => {
    expect(normalizeAuditLimit(10_000)).toBe(PROJECT_AUDIT_MAX_LIMIT);
  });

  it("정상 범위는 그대로, 소수는 내림", () => {
    expect(normalizeAuditLimit(25)).toBe(25);
    expect(normalizeAuditLimit(25.7)).toBe(25);
  });
});

describe("sortAuditEventsDesc", () => {
  it("최신순으로 정렬하고 입력 배열을 변형하지 않는다", () => {
    const input = [
      { createdAt: new Date("2026-01-01T00:00:00Z"), id: "old" },
      { createdAt: new Date("2026-03-01T00:00:00Z"), id: "new" },
      { createdAt: new Date("2026-02-01T00:00:00Z"), id: "mid" },
    ];
    const sorted = sortAuditEventsDesc(input);

    expect(sorted.map((e) => e.id)).toEqual(["new", "mid", "old"]);
    expect(input.map((e) => e.id)).toEqual(["old", "new", "mid"]);
  });
});

describe("이벤트 종류 집합", () => {
  it("알려진 종류만 통과한다", () => {
    for (const type of PROJECT_AUDIT_EVENT_TYPES) {
      expect(isProjectAuditEventType(type)).toBe(true);
    }
    // 오타가 조용히 새 종류를 만들면 필터가 영원히 0건을 돌려준다.
    expect(isProjectAuditEventType("chat.message.send")).toBe(false);
    expect(isProjectAuditEventType(undefined)).toBe(false);
    expect(isProjectAuditEventType(42)).toBe(false);
  });
});

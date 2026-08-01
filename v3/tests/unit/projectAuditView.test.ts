import { describe, it, expect } from "vitest";

/**
 * 감사 로그 뷰 파생 계층(src/lib/projectAuditView.ts) 계약.
 *
 * lib/projectAudit.test.ts 와 같은 이유로 이 파일은 firebase 를 타지 않는다 —
 * 타면 VITE_FIREBASE_* 부재로 모듈 로드 시점에 죽는다.
 */
import {
  AUDIT_TYPE_LABEL_KEYS,
  auditTypeLabelKey,
  auditMetadataSummary,
  resolveActorLabel,
  isPermissionDenied,
  auditStateFromError,
  auditEmptyKind,
} from "../../src/lib/projectAuditView";
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
      "project.audit.type.unknown",
    );
  });
});

describe("resolveActorLabel — 이름 메꿈", () => {
  it("기록된 actorName 을 그대로 쓴다", () => {
    expect(resolveActorLabel({ actorUid: "u1", actorName: "John" })).toBe(
      "John",
    );
  });

  it("actorName 이 비면 현재 멤버 목록으로 메꾼다", () => {
    expect(
      resolveActorLabel({ actorUid: "u1", actorName: null }, { u1: "Jane" }),
    ).toBe("Jane");
    // 공백만 있는 이름도 비어 있는 것으로 본다.
    expect(
      resolveActorLabel({ actorUid: "u1", actorName: "   " }, { u1: "Jane" }),
    ).toBe("Jane");
  });

  it("둘 다 없으면 uid 앞자리 — 빈 칸으로 두지 않는다", () => {
    expect(
      resolveActorLabel({ actorUid: "abcdefghijkl", actorName: null }),
    ).toBe("abcdefgh");
  });
});

describe("auditMetadataSummary — 메타 요약", () => {
  it("상태 전이는 양끝을 보여준다", () => {
    expect(
      auditMetadataSummary("task.status_changed", {
        from: "TODO",
        to: "IN_PROGRESS",
      }),
    ).toBe("TODO → IN_PROGRESS");
  });

  it("한쪽만 있으면 있는 쪽만", () => {
    expect(auditMetadataSummary("task.status_changed", { to: "DONE" })).toBe(
      "DONE",
    );
  });

  it("스폰은 이름·모델·역할을 잇는다", () => {
    expect(
      auditMetadataSummary("agent.spawned", {
        agentName: "frontend-1",
        model: "claude",
        role: "frontend",
      }),
    ).toBe("frontend-1 · claude · frontend");
  });

  it("빈 메타·모르는 종류·비스칼라 값에도 터지지 않고 null", () => {
    expect(auditMetadataSummary("agent.spawned", {})).toBeNull();
    expect(auditMetadataSummary("task.claimed", { taskId: "t1" })).toBeNull();
    expect(auditMetadataSummary("chat.message.sent", undefined)).toBeNull();
    // 숫자만 있는 채팅 메타(길이) — 본문이 없으니 요약도 없다.
    expect(
      auditMetadataSummary("chat.message.sent", { contentLength: 12 }),
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
        new Error("FirebaseError: Missing or insufficient permissions."),
      ),
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
      "noRecordsYet",
    );
  });

  it("구성원/종류 어느 쪽이든 걸려 있으면 filtered", () => {
    expect(auditEmptyKind({ actorUid: "u1" })).toBe("filtered");
    expect(auditEmptyKind({ type: "chat.message.sent" })).toBe("filtered");
    expect(auditEmptyKind({ actorUid: "u1", type: "agent.spawned" })).toBe(
      "filtered",
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

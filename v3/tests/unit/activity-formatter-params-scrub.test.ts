/**
 * ActivityStreamPanel 포매터 — params 에서 꺼낸 값에 자격증명·PII 가 실리지 않는다
 * (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★여기는 감사 뷰와 **다르게 다룬다.** 감사 뷰(AuditTimeline·ProjectAuditRow)는
 * 정책 표식 없는 옛 문서의 자유 텍스트를 통째로 끊지만, 이 패널은 옛 문서가
 * 대부분인 상시 스트림이라 끊으면 패널이 죽는다(이전 티켓
 * Ciriq5ASEvAlA8TnKxhW 가 못 박은 회귀 금지선). 대신 여기는
 *  (1) 애초에 키 화이트리스트로만 읽고,
 *  (2) 꺼낸 값을 표시 직전에 스크럽한다.
 * 이 파일이 (2) 를 고정한다.
 */
import { describe, expect, it } from "vitest";
import { formatActivity } from "../../src/services/activityFormatters";
import type { ActivityEntry } from "../../src/services/activityStreamService";

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "a1",
    type: "activity:note",
    toolName: "add_activity",
    agentId: "agent-1",
    projectId: "p1",
    params: {},
    result: "ok",
    duration: 1,
    success: true,
    createdAt: new Date("2026-08-01T11:00:00Z"),
    ...over,
  } as ActivityEntry;
}

const t = ((key: string) => key) as never;

describe("formatActivity — params 값 스크럽", () => {
  it("메시지에 섞인 API 키가 화면 문자열로 나가지 않는다", () => {
    const formatted = formatActivity(
      entry({
        params: {
          message: "배포는 sk-ant-abcdefghijklmnopqrstuvwxyz012345 로 했다",
        },
      }),
      t,
    );

    expect(JSON.stringify(formatted)).not.toContain(
      "sk-ant-abcdefghijklmnopqrstuvwxyz012345",
    );
    expect(JSON.stringify(formatted)).toContain("<API_KEY>");
  });

  it("메시지에 섞인 메일 주소가 화면 문자열로 나가지 않는다", () => {
    const formatted = formatActivity(
      entry({ params: { message: "owner@example.com 에게 전달" } }),
      t,
    );

    expect(JSON.stringify(formatted)).not.toContain("owner@example.com");
    expect(JSON.stringify(formatted)).toContain("<EMAIL>");
  });
});

// 티켓 r2rrPsblZPlUOTCWzc3Z — "오케가 자기가 배정한 티켓을 닫지도 기록하지도 못한다".
//
// 이 테스트가 지키는 것은 셋이다:
//   1. 오케는 자기 프로젝트 티켓을 넘을 수 있다(상태·기록 둘 다).
//   2. ★살아 있는 claim 은 여전히 보호된다 — 그게 claim 제약의 존재 이유다.
//   3. 넘은 것에는 반드시 사유가 붙고, 감사 문장으로 재구성된다.

import { describe, expect, it } from "vitest";
import {
  DEAD_CLAIM_AGENT_STATUSES,
  SILENT_CLAIM_THRESHOLD_MS,
  assessClaimHolder,
  decideClaimAuthority,
  formatClaimOverrideAudit,
} from "../../electron/mcp-server/claim-authority";

const NOW = 1_750_000_000_000;

describe("assessClaimHolder — 죽은 claim 판정", () => {
  it("플릿에 문서조차 없으면 absent, 회수 가능", () => {
    // 실사례: fable5-spawn-probe(28일) / grok-usage-verify(25일).
    const a = assessClaimHolder({ found: false, lookupFailed: false });
    expect(a.verdict).toBe("absent");
    expect(a.reclaimable).toBe(true);
    expect(a.why).toContain("플릿에 문서조차 없습니다");
  });

  it.each(DEAD_CLAIM_AGENT_STATUSES)(
    "PTY status=%s 면 stopped, 회수 가능",
    (status) => {
      const a = assessClaimHolder({ found: true, lookupFailed: false, status });
      expect(a.verdict).toBe("stopped");
      expect(a.reclaimable).toBe(true);
    },
  );

  it("status 대소문자/공백은 정규화해서 본다", () => {
    expect(
      assessClaimHolder({
        found: true,
        lookupFailed: false,
        status: " Stopped ",
      }).verdict,
    ).toBe("stopped");
  });

  it("★조회 실패는 absent 가 아니라 unknown — 절대 회수하지 않는다", () => {
    // 증거의 부재는 부재의 증거가 아니다. 브리지가 잠깐 흔들릴 때마다 살아있는
    // 에이전트의 티켓이 강탈되면 그건 되돌릴 수 없는 오판이다.
    const a = assessClaimHolder({ found: false, lookupFailed: true });
    expect(a.verdict).toBe("unknown");
    expect(a.reclaimable).toBe(false);
  });

  it("살아 있고 최근 활동이 있으면 alive", () => {
    const a = assessClaimHolder({
      found: true,
      lookupFailed: false,
      status: "working",
      lastActivityAtMs: NOW - 60_000,
      nowMs: NOW,
    });
    expect(a.verdict).toBe("alive");
    expect(a.reclaimable).toBe(false);
  });

  it("★무활동이 길어도 silent 일 뿐 — 회수 대상이 아니다", () => {
    // 정상 장시간 작업(대형 리팩터, 벤치, 버그 재현)이 정확히 이렇게 보인다.
    // 시간은 가시화의 신호이지 권한의 근거가 아니다.
    const a = assessClaimHolder({
      found: true,
      lookupFailed: false,
      status: "working",
      lastActivityAtMs: NOW - SILENT_CLAIM_THRESHOLD_MS - 1,
      nowMs: NOW,
    });
    expect(a.verdict).toBe("silent");
    expect(a.reclaimable).toBe(false);
    expect(a.why).toContain("오케스트레이터의 판단이 필요합니다");
  });

  it("시각 정보가 없으면 무활동 판정을 건너뛴다(alive)", () => {
    expect(
      assessClaimHolder({ found: true, lookupFailed: false, status: "idle" })
        .verdict,
    ).toBe("alive");
  });
});

describe("decideClaimAuthority — 권한 판정", () => {
  const orch = {
    actorAgentId: "",
    actorIsOrchestrator: true,
    actorProjectId: "proj-1",
    taskProjectId: "proj-1",
  };

  it("claim 이 없으면 누구나 쓸 수 있고 override 가 아니다", () => {
    const d = decideClaimAuthority({ claimedBy: null, actorAgentId: "w1" });
    expect(d.allowed).toBe(true);
    expect(d.grant).toBe("unclaimed");
    expect(d.override).toBe(false);
  });

  it("본인 claim 은 지금까지와 똑같이 통과하고 사유를 요구하지 않는다", () => {
    const d = decideClaimAuthority({ claimedBy: "w1", actorAgentId: "w1" });
    expect(d.allowed).toBe(true);
    expect(d.grant).toBe("self");
    expect(d.override).toBe(false);
  });

  it("오케는 자기 프로젝트 티켓을 사유와 함께 넘을 수 있다", () => {
    const d = decideClaimAuthority({
      ...orch,
      claimedBy: "dead-worker",
      reason: "PR #1120 머지 완료, 담당 idle",
    });
    expect(d.allowed).toBe(true);
    expect(d.grant).toBe("orchestrator");
    expect(d.override).toBe(true);
    // 오케 판정은 플릿 조회 없이 끝난다 — 신원만으로 성립한다.
    expect(d.needsHolderEvidence).toBe(false);
  });

  it("★사유가 없으면 오케라도 거부한다 — 근거 없는 상태 변경을 만들지 않는다", () => {
    const d = decideClaimAuthority({ ...orch, claimedBy: "dead-worker" });
    expect(d.allowed).toBe(false);
    expect(d.error).toContain("사유");
  });

  it("공백만 있는 사유는 사유가 아니다", () => {
    const d = decideClaimAuthority({
      ...orch,
      claimedBy: "dead-worker",
      reason: "   ",
    });
    expect(d.allowed).toBe(false);
  });

  it("★오케 권한은 프로젝트를 넘지 않는다", () => {
    const d = decideClaimAuthority({
      ...orch,
      taskProjectId: "proj-2",
      claimedBy: "w1",
      reason: "정리",
    });
    expect(d.allowed).toBe(false);
    expect(d.error).toContain("does not cross projects");
  });

  it("워커는 증거 없이는 판정이 끝나지 않는다(플릿 조회 요구)", () => {
    const d = decideClaimAuthority({ claimedBy: "w1", actorAgentId: "w2" });
    expect(d.needsHolderEvidence).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.error).toBeNull();
  });

  it("죽은 claim 은 워커도 사유와 함께 회수할 수 있다", () => {
    const d = decideClaimAuthority({
      claimedBy: "ghost",
      actorAgentId: "cleanup-worker",
      reason: "28일 CLAIMED, activity 0 — 정리",
      holder: assessClaimHolder({ found: false, lookupFailed: false }),
    });
    expect(d.allowed).toBe(true);
    expect(d.grant).toBe("dead-claim");
    expect(d.override).toBe(true);
    expect(d.overrideWhy).toContain("문서조차 없습니다");
  });

  it("★살아 있는 claim 은 워커가 넘지 못한다 — 제약은 그대로다", () => {
    const d = decideClaimAuthority({
      claimedBy: "busy-worker",
      actorAgentId: "other-worker",
      reason: "내가 대신 하겠다",
      holder: assessClaimHolder({
        found: true,
        lookupFailed: false,
        status: "working",
      }),
    });
    expect(d.allowed).toBe(false);
    expect(d.error).toContain("only the claiming agent can update it");
    expect(d.error).toContain("오케스트레이터");
  });

  it("★silent 도 워커에게는 거부다 — 무활동은 권한의 근거가 아니다", () => {
    const d = decideClaimAuthority({
      claimedBy: "stuck-worker",
      actorAgentId: "other-worker",
      reason: "멈춘 것 같다",
      holder: assessClaimHolder({
        found: true,
        lookupFailed: false,
        status: "working",
        lastActivityAtMs: NOW - 30 * 24 * 60 * 60 * 1000,
        nowMs: NOW,
      }),
    });
    expect(d.allowed).toBe(false);
  });

  it("★조회 실패(unknown)는 fail-closed", () => {
    const d = decideClaimAuthority({
      claimedBy: "w1",
      actorAgentId: "w2",
      reason: "정리",
      holder: assessClaimHolder({ found: false, lookupFailed: true }),
    });
    expect(d.allowed).toBe(false);
  });
});

describe("formatClaimOverrideAudit — 누가·무엇을·왜·어떤 근거로", () => {
  it("override 한 줄에서 네 가지가 전부 복원된다", () => {
    const msg = formatClaimOverrideAudit({
      grant: "orchestrator",
      actorAgentId: "orchestrator-proj-1",
      claimedBy: "90b38577",
      action: "status CLAIMED → DONE",
      reason: "PR #1120 머지 완료, 담당 idle",
      overrideWhy: "오케스트레이터 권한 — 자기 프로젝트 보드의 티켓입니다.",
    });
    expect(msg).toContain("orchestrator-proj-1"); // 누가
    expect(msg).toContain("90b38577"); // 누구의 claim 을
    expect(msg).toContain("status CLAIMED → DONE"); // 무엇을
    expect(msg).toContain("PR #1120 머지 완료"); // 왜
    expect(msg).toContain("오케스트레이터 권한"); // 어떤 근거로
  });

  it("죽은 claim 회수도 근거 문장을 그대로 싣는다", () => {
    const holder = assessClaimHolder({ found: false, lookupFailed: false });
    const msg = formatClaimOverrideAudit({
      grant: "dead-claim",
      actorAgentId: "cleanup-worker",
      claimedBy: "ghost",
      action: "activity 기록",
      reason: "직전 보고의 오류 정정",
      overrideWhy: holder.why,
    });
    expect(msg).toContain("죽은 claim 회수");
    expect(msg).toContain("플릿에 문서조차 없습니다");
  });
});

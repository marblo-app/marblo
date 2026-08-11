/**
 * 스폰 차단 '사유' 귀속 계약 (티켓 iyxb4KsJpgPgoKYUBPsu).
 *
 * 온보딩이 cli_setup_step(30일 531명) → multi_agent_success(21명)로 ~96% 이탈하는데
 * **왜** 멈추는지 셀 수 없었다. 이 테스트가 못박는 것:
 *
 *   1) 차단 사유가 5칸 정규 어휘로 접힌다 — 모르는 값은 반드시 `other` 다
 *      (조용히 기존 칸에 섞이면 그 칸의 수치가 오염된다).
 *   2) ★플랜 캡의 free/유료 구분이 no_subscription vs quota_exhausted 로 갈린다.
 *      이 둘은 정반대의 조치(결제 유도 vs 한도 상향)로 이어지므로 한 칸에 두면
 *      데이터가 있어도 아무 결정을 못 한다.
 *   3) `onboarding:spawn_blocked` 페이로드가 원어휘(errorCategory)와 정규 어휘
 *      (metadata.reason)를 **둘 다** 싣는다 — 기존 대시보드 쿼리는 안 깨진다.
 *   4) ★#907 익명 불변식 — 계정 식별자(accountUserId/uid/email/…)가 한 바이트도
 *      실리지 않는다. 상관키는 익명 clientId(렌더러가 붙이는 events.userId) 하나다.
 */
import { describe, expect, it, vi } from "vitest";

// electron 은 이 테스트에서 필요 없다 — telemetry.ts 가 BrowserWindow 를 타입으로만
// 쓰므로 빈 클래스로 충분하다(agent-lifecycle.test.ts 규약).
vi.mock("electron", () => ({ BrowserWindow: class {} }));

import {
  SPAWN_BLOCK_REASONS,
  normalizeSpawnBlockReason,
  planCapErrorCategory,
} from "../../electron/spawn-block-reason";
import { mainTelemetry } from "../../electron/telemetry";

/** 계정 식별자로 읽힐 수 있는 키 — 하나라도 나타나면 #907 회귀다. */
const ACCOUNT_IDENTIFIER_KEYS = [
  "accountUserId",
  "uid",
  "userId",
  "email",
  "phone",
  "senderId",
  "plan",
  "ownerId",
];

/** sendTelemetry 가 실제로 태우는 IPC 를 가로채는 최소 창 더블. */
function fakeWindow() {
  const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: Record<string, unknown>) => {
        sent.push({ channel, payload });
      },
    },
  };
  return { win, sent };
}

function emit(payload: Parameters<typeof mainTelemetry.spawnBlocked>[1]) {
  const { win, sent } = fakeWindow();
  mainTelemetry.spawnBlocked(
    win as unknown as Parameters<typeof mainTelemetry.spawnBlocked>[0],
    payload,
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].channel).toBe("telemetry:event");
  return sent[0].payload;
}

describe("normalizeSpawnBlockReason", () => {
  it("게이트 원어휘를 정규 어휘로 접는다", () => {
    expect(normalizeSpawnBlockReason("not-installed")).toBe("no_cli");
    expect(normalizeSpawnBlockReason("not-authenticated")).toBe("needs_auth");
  });

  it("플랜 캡은 free=구독공백 / 유료=한도소진 으로 갈린다", () => {
    expect(normalizeSpawnBlockReason("plan-cap-free")).toBe("no_subscription");
    expect(normalizeSpawnBlockReason("plan-cap-paid")).toBe("quota_exhausted");
  });

  it("★벤더키 미설정은 no_subscription 이 아니라 other 다 — 조치가 다르다", () => {
    // 마블로 구독을 팔아도 안 풀린다(사용자가 자기 벤더 키를 등록해야 한다).
    // 구독 공백에 섞으면 온램프 투자 판단의 입력값이 그만큼 부풀려진다.
    expect(normalizeSpawnBlockReason("vendor-not-configured")).toBe("other");
  });

  it("모르는 값·빈 값은 반드시 other 로 떨어진다(기존 칸 오염 금지)", () => {
    for (const raw of [
      undefined,
      "",
      "  ",
      "mcp-unavailable",
      "누가봐도새사유",
    ]) {
      expect(normalizeSpawnBlockReason(raw)).toBe("other");
    }
  });

  it("어휘는 5칸뿐이다 — 화면/쿼리가 이 목록을 계약으로 쓴다", () => {
    expect([...SPAWN_BLOCK_REASONS]).toEqual([
      "no_subscription",
      "needs_auth",
      "no_cli",
      "quota_exhausted",
      "other",
    ]);
  });
});

describe("planCapErrorCategory", () => {
  it("free / 미해석 plan 은 free 칸 — 알 수 없는 값을 유료로 세지 않는다", () => {
    // 미해석을 유료로 세면 '구독 공백' 이 과소계상되고, 그건 이 티켓이 세려는
    // 바로 그 수치를 낙관 편향시킨다.
    expect(planCapErrorCategory("free")).toBe("plan-cap-free");
    expect(planCapErrorCategory(undefined)).toBe("plan-cap-free");
    expect(planCapErrorCategory("  ")).toBe("plan-cap-free");
    expect(planCapErrorCategory("FREE")).toBe("plan-cap-free");
  });

  it("유료 플랜은 paid 칸", () => {
    for (const plan of ["pro", "team", "team_plus", "enterprise"]) {
      expect(planCapErrorCategory(plan)).toBe("plan-cap-paid");
    }
  });
});

describe("onboarding:spawn_blocked 페이로드", () => {
  it("원어휘(errorCategory)와 정규 어휘(metadata.reason)를 둘 다 싣는다", () => {
    const payload = emit({
      surface: "agent_launch",
      model: "claude",
      reason: "not-authenticated",
      installed: true,
    });

    expect(payload.event).toBe("onboarding:spawn_blocked");
    // 기존 대시보드(stallReasonQuery)가 읽는 축은 그대로 유지된다.
    expect(payload.errorCategory).toBe("not-authenticated");
    expect((payload.metadata as Record<string, unknown>).reason).toBe(
      "needs_auth",
    );
    expect(payload.success).toBe(false);
  });

  it("플랜 캡 차단이 구독 공백으로 귀속된다 — 이 티켓이 세려던 수치", () => {
    const payload = emit({
      surface: "dispatch",
      model: "unknown",
      reason: planCapErrorCategory("free"),
      installed: true,
    });

    expect((payload.metadata as Record<string, unknown>).reason).toBe(
      "no_subscription",
    );
  });

  it("★#907 — 계정 식별자를 한 바이트도 싣지 않는다(익명 clientId 만)", () => {
    const payload = emit({
      surface: "spawn",
      model: "claude",
      reason: "vendor-not-configured",
      installed: true,
      vendor: "zai",
      missingEnvKeyCount: 2,
    });

    const flat = JSON.stringify(payload);
    for (const key of ACCOUNT_IDENTIFIER_KEYS) {
      expect(key in payload).toBe(false);
      expect(payload.metadata as Record<string, unknown>).not.toHaveProperty(
        key,
      );
      expect(flat).not.toContain(key);
    }
  });

  it("벤더 축은 키 **개수**만 싣는다 — 키 이름도 값도 나가지 않는다", () => {
    const payload = emit({
      surface: "spawn",
      model: "claude",
      reason: "vendor-not-configured",
      installed: true,
      vendor: "zai",
      missingEnvKeyCount: 2,
    });

    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.missingEnvKeyCount).toBe(2);
    expect(meta.vendor).toBe("zai");
    expect(JSON.stringify(payload)).not.toMatch(/_KEY|_TOKEN|_SECRET/);
  });
});

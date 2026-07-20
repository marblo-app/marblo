import { describe, it, expect } from "vitest";
import {
  resolveEntitledPlan as rendererResolve,
  isCanceledButStillEntitled,
  RENEWAL_GRACE_MS,
} from "../../src/lib/entitlement";
import { resolveEntitledPlan as functionsResolve } from "../../functions/src/entitlement";

// ─────────────────────────────────────────────────────────────────────
// P0 과금 버그 회귀 테스트 (티켓 HUETzRj97oSJOGNULro8)
//
// 증상: 토스 구독자가 결제 2일차에 해지하면 즉시 free 강등 + 잔여 29일 소멸 +
// 환불 없음. 화면은 currentPeriodEnd 를 "이용 종료일"로 표시하는데 실제 동작이
// 정반대였다.
//
// 이 파일은 두 가지를 못박는다:
//  1) 자발 해지 후 잔여 기간 동안 유료 접근이 유지된다
//  2) 렌더러(src/lib)와 functions 의 판정이 **같은 케이스표에서 완전히 일치**한다
//     — 한쪽만 고치면 판정이 갈라지므로 그걸 red 로 만든다.
// ─────────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0); // 고정 기준시각(Date.now() 미사용)
const DAY = 24 * 60 * 60 * 1000;

/** 두 구현 모두에 같은 입력을 넣고, 일치를 강제한 뒤 그 값을 돌려준다.
 *  모든 케이스가 이 헬퍼를 지나므로 drift 는 어느 케이스에서든 잡힌다. */
function resolve(sub: unknown, nowMs: number = NOW): string {
  const a = rendererResolve(sub as never, nowMs);
  const b = functionsResolve(sub as never, nowMs);
  expect(
    b,
    `렌더러/functions 판정 불일치: ${JSON.stringify(
      sub,
    )} → 렌더러=${a}, functions=${b}`,
  ).toBe(a);
  return a;
}

describe("resolveEntitledPlan — 자발 해지는 기간 말 종료 (P0 회귀)", () => {
  it("★해지 직후: 잔여 기간이 남아 있으면 유료가 유지된다 (이 티켓의 버그)", () => {
    // 결제 2일차 해지 → 29일 남음. 예전 규칙은 여기서 "free" 를 돌려줬다.
    expect(
      resolve({
        status: "canceled",
        planType: "pro",
        currentPeriodEndMs: NOW + 29 * DAY,
      }),
    ).toBe("pro");
  });

  it("기간 말 직전(1분 전)까지 유료", () => {
    expect(
      resolve({
        status: "canceled",
        planType: "pro",
        currentPeriodEndMs: NOW + 60_000,
      }),
    ).toBe("pro");
  });

  it("★기간 경과 직후 free — 해지자에겐 유예를 주지 않는다", () => {
    expect(
      resolve({
        status: "canceled",
        planType: "pro",
        currentPeriodEndMs: NOW - 1,
      }),
    ).toBe("free");
  });

  it("경계값: currentPeriodEnd === now 는 만료로 본다(exclusive)", () => {
    expect(
      resolve({ status: "canceled", planType: "pro", currentPeriodEndMs: NOW }),
    ).toBe("free");
  });

  it("해지자에게는 갱신 유예가 적용되지 않는다 (유예 한복판이어도 free)", () => {
    expect(
      resolve({
        status: "canceled",
        planType: "pro",
        currentPeriodEndMs: NOW - RENEWAL_GRACE_MS / 2,
      }),
    ).toBe("free");
  });

  it("plan 등급은 그대로 보존된다 (pro 가 아닌 상위 플랜도)", () => {
    for (const plan of ["team", "team_plus", "enterprise"]) {
      expect(
        resolve({
          status: "canceled",
          planType: plan,
          currentPeriodEndMs: NOW + DAY,
        }),
      ).toBe(plan);
    }
  });
});

describe("resolveEntitledPlan — 레거시/누락 데이터", () => {
  it("★레거시: active 인데 currentPeriodEnd 가 없으면 유료 유지(현행 무회귀)", () => {
    // 기간을 모른다고 유료 사용자를 강등시키면 그게 새 P0 이다.
    expect(resolve({ status: "active", planType: "pro" })).toBe("pro");
    expect(
      resolve({ status: "active", planType: "pro", currentPeriodEndMs: null }),
    ).toBe("pro");
  });

  it("★레거시: canceled 인데 기간이 없으면 free — 없는 기간을 지어내지 않는다", () => {
    expect(resolve({ status: "canceled", planType: "pro" })).toBe("free");
    expect(
      resolve({
        status: "canceled",
        planType: "pro",
        currentPeriodEndMs: null,
      }),
    ).toBe("free");
  });

  it("구독 문서 자체가 없으면 free", () => {
    expect(resolve(null)).toBe("free");
    expect(resolve(undefined)).toBe("free");
  });

  it("NaN/Infinity 같은 깨진 기간값은 '기간 미상'으로 처리한다", () => {
    expect(
      resolve({ status: "canceled", planType: "pro", currentPeriodEndMs: NaN }),
    ).toBe("free");
    expect(
      resolve({
        status: "active",
        planType: "pro",
        currentPeriodEndMs: Infinity,
      }),
    ).toBe("pro");
  });
});

describe("resolveEntitledPlan — planType:'free' 하드 킬스위치 (환불/청구실패/Paddle 무회귀)", () => {
  // 접근을 즉시 끊어야 하는 경로는 모두 status=canceled + planType:"free" 를 쓴다.
  // 이 변경이 그 사용자들을 되살리면 안 된다.
  it("토스 환불 웹훅 형태(canceled + free)는 잔여 기간이 남아 있어도 free", () => {
    expect(
      resolve({
        status: "canceled",
        planType: "free",
        currentPeriodEndMs: NOW + 29 * DAY,
      }),
    ).toBe("free");
  });

  it("청구 3회 실패 해지 형태(canceled + free)도 free", () => {
    expect(
      resolve({
        status: "canceled",
        planType: "free",
        currentPeriodEndMs: NOW + DAY,
      }),
    ).toBe("free");
  });

  it("Paddle subscription.canceled 형태(canceled + free)도 free — Paddle 경로 무회귀", () => {
    expect(
      resolve({
        status: "canceled",
        planType: "free",
        currentPeriodEndMs: NOW + 10 * DAY,
      }),
    ).toBe("free");
  });

  it("planType 누락도 free", () => {
    expect(resolve({ status: "active", currentPeriodEndMs: NOW + DAY })).toBe(
      "free",
    );
  });
});

describe("resolveEntitledPlan — active 갱신 유예", () => {
  it("정상 활성(기간 미경과)은 유료", () => {
    expect(
      resolve({
        status: "active",
        planType: "pro",
        currentPeriodEndMs: NOW + DAY,
      }),
    ).toBe("pro");
  });

  it("★만료 직후에도 유예 안에서는 유료 — 갱신 크론은 하루 1회라 시차가 정상이다", () => {
    // 이 유예가 없으면 정상 결제자 전원이 매달 최대 ~24h 동안 free 로 떨어진다.
    expect(
      resolve({
        status: "active",
        planType: "pro",
        currentPeriodEndMs: NOW - 12 * 60 * 60 * 1000,
      }),
    ).toBe("pro");
  });

  it("★유예를 넘기면 free — 재결제 없이 영구 유료는 없다", () => {
    expect(
      resolve({
        status: "active",
        planType: "pro",
        currentPeriodEndMs: NOW - RENEWAL_GRACE_MS - 1,
      }),
    ).toBe("free");
  });

  it("유예 경계값(정확히 유예 끝)은 만료로 본다", () => {
    expect(
      resolve({
        status: "active",
        planType: "pro",
        currentPeriodEndMs: NOW - RENEWAL_GRACE_MS,
      }),
    ).toBe("free");
  });
});

describe("resolveEntitledPlan — 그 외 상태는 현행 동작 유지", () => {
  it("past_due 는 free (기존 getPlan 과 동일)", () => {
    expect(
      resolve({
        status: "past_due",
        planType: "pro",
        currentPeriodEndMs: NOW + DAY,
      }),
    ).toBe("free");
  });

  it("trialing / 알 수 없는 상태 / 상태 누락도 free", () => {
    for (const status of ["trialing", "bogus", undefined, null]) {
      expect(
        resolve({ status, planType: "pro", currentPeriodEndMs: NOW + DAY }),
      ).toBe("free");
    }
  });
});

describe("isCanceledButStillEntitled — UI 배지용", () => {
  it("해지 + 잔여 기간 → true", () => {
    expect(
      isCanceledButStillEntitled(
        { status: "canceled", planType: "pro", currentPeriodEndMs: NOW + DAY },
        NOW,
      ),
    ).toBe(true);
  });

  it("정상 활성은 false (해지한 게 아니다)", () => {
    expect(
      isCanceledButStillEntitled(
        { status: "active", planType: "pro", currentPeriodEndMs: NOW + DAY },
        NOW,
      ),
    ).toBe(false);
  });

  it("해지 + 기간 경과 → false", () => {
    expect(
      isCanceledButStillEntitled(
        { status: "canceled", planType: "pro", currentPeriodEndMs: NOW - DAY },
        NOW,
      ),
    ).toBe(false);
  });

  it("환불로 planType 이 free 가 된 경우 → false", () => {
    expect(
      isCanceledButStillEntitled(
        { status: "canceled", planType: "free", currentPeriodEndMs: NOW + DAY },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("렌더러 ↔ functions 판정 일치 (drift 알람)", () => {
  // 위 모든 테스트가 resolve() 헬퍼를 거치며 이미 일치를 강제하지만, 조합 폭발을
  // 한 번 더 훑어 어느 한쪽만 수정되는 drift 를 확실히 잡는다.
  it("상태 × 플랜 × 기간 전조합에서 두 구현이 같은 답을 낸다", () => {
    const statuses = [
      "active",
      "canceled",
      "past_due",
      "trialing",
      "",
      undefined,
    ];
    const plans = ["free", "pro", "team", "team_plus", "enterprise", undefined];
    const ends = [
      null,
      undefined,
      NOW - 400 * DAY,
      NOW - RENEWAL_GRACE_MS - 1,
      NOW - RENEWAL_GRACE_MS,
      NOW - DAY,
      NOW,
      NOW + 1,
      NOW + 29 * DAY,
    ];

    let checked = 0;
    for (const status of statuses) {
      for (const planType of plans) {
        for (const currentPeriodEndMs of ends) {
          // resolve() 내부에서 두 구현 일치를 assert 한다.
          resolve({ status, planType, currentPeriodEndMs });
          checked++;
        }
      }
    }
    expect(checked).toBe(statuses.length * plans.length * ends.length);
  });
});

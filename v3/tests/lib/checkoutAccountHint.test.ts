import { describe, expect, it } from "vitest";

import {
  ACCOUNT_HINT_PARAM,
  createAccountHint,
  verifyAccountHint,
} from "../../src/lib/checkoutAccountHint";

/**
 * 데스크톱 → 웹 체크아웃 계정 핸드오프 힌트 (티켓 3Notu54M).
 *
 * 데스크톱 Firebase 세션과 OS 브라우저 세션은 별개다. 앱이 A 로, 브라우저가
 * B 로 로그인된 채 결제하면 서버는 subscriptions/B 에 쓰고 앱은 A 를 듣는다 —
 * 앱은 영원히 Free 다. 그래서 링크에 "앱은 누구인가" 를 실어야 하는데,
 * ★원시 uid·이메일은 싣지 않는다(브라우저 이력·리퍼러·어깨너머).
 *
 * 힌트 = `1.<nonce 16hex>.<sha256("marblo-checkout-account:<nonce>:<uid>") 앞 32hex>`
 *   - 웹은 로그인된 uid 로 같은 값을 재계산해 대조한다(검증 가능).
 *   - uid 는 28자 난수라 해시에서 되돌릴 수 없다(불투명).
 *   - nonce 가 링크마다 달라 이력에 남아도 서로 이어지지 않는다.
 *
 * ★이 테스트 벡터는 marblo-web/src/lib/checkoutAccountHint.test.ts 와 **같은
 * 값**이어야 한다 — 두 저장소의 구현이 서로 어긋나면 웹이 항상 "불일치" 를
 * 띄워 결제가 막힌다. 한쪽을 바꾸면 다른 쪽도 같이 바꿔라.
 */
const NONCE = "0123456789abcdef";
const HINT_A = `1.${NONCE}.56317b4a5d2e5ef436750eaeb319aebd`;
const HINT_B = `1.${NONCE}.2400349bb386a6d9f5f6baf41cb99d45`;

describe("createAccountHint", () => {
  it("★공유 벡터: nonce 가 같으면 uid 별 값이 결정적이다(웹과 같은 값)", async () => {
    expect(await createAccountHint("user-A", NONCE)).toBe(HINT_A);
    expect(await createAccountHint("user-B", NONCE)).toBe(HINT_B);
  });

  it("★uid 원문이 힌트에 들어 있지 않다 — 링크에 실려도 계정이 드러나지 않는다", async () => {
    const hint = await createAccountHint("some-firebase-uid-28chars00", NONCE);
    expect(hint).not.toContain("some-firebase-uid");
    expect(hint).toMatch(/^1\.[0-9a-f]{16}\.[0-9a-f]{32}$/);
  });

  it("nonce 를 안 주면 매번 새로 뽑는다 — 링크마다 값이 달라 이력이 이어지지 않는다", async () => {
    const a = await createAccountHint("user-A");
    const b = await createAccountHint("user-A");
    expect(a).not.toBe(b);
    // 그래도 둘 다 같은 uid 로 검증된다.
    expect(await verifyAccountHint(a, "user-A")).toBe("match");
    expect(await verifyAccountHint(b, "user-A")).toBe("match");
  });

  it("쿼리 파라미터 이름은 acct 로 고정이다(웹과의 계약)", () => {
    expect(ACCOUNT_HINT_PARAM).toBe("acct");
  });
});

describe("verifyAccountHint", () => {
  it("같은 계정이면 match, 다른 계정이면 mismatch", async () => {
    expect(await verifyAccountHint(HINT_A, "user-A")).toBe("match");
    expect(await verifyAccountHint(HINT_A, "user-B")).toBe("mismatch");
    expect(await verifyAccountHint(HINT_B, "user-B")).toBe("match");
  });

  it("★깨진 힌트는 invalid — mismatch 로 오판해 결제를 막지도, match 로 통과시키지도 않는다", async () => {
    for (const bad of [
      "",
      "garbage",
      "1.short.56317b4a5d2e5ef436750eaeb319aebd",
      `2.${NONCE}.56317b4a5d2e5ef436750eaeb319aebd`, // 모르는 버전
      `1.${NONCE}.zz317b4a5d2e5ef436750eaeb319aebd`, // hex 아님
      `1.${NONCE}`, // 다이제스트 없음
    ]) {
      expect(await verifyAccountHint(bad, "user-A")).toBe("invalid");
    }
  });

  it("null/undefined 힌트는 none — 웹에 직접 들어온 경우라 검사 대상이 아니다", async () => {
    expect(await verifyAccountHint(null, "user-A")).toBe("none");
    expect(await verifyAccountHint(undefined, "user-A")).toBe("none");
  });
});

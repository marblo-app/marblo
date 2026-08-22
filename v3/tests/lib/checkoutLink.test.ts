import { describe, expect, it } from "vitest";

import {
  buildWebCheckoutUrl,
  WEB_CHECKOUT_BASE_URL,
} from "../../src/lib/checkoutLink";

/**
 * 데스크톱 → 웹 체크아웃 URL 계약 (티켓 ZVg1OC3C).
 *
 * 이 URL 이 앱이 결제에 대해 지는 **전부**다. 앱은 결제를 처리하지 않고,
 * 이미 검증된 웹 체크아웃(포트원·KG이니시스)으로 데려다주기만 한다.
 * 그래서 여기서 못박는 건 "링크가 생긴다"가 아니라 **무엇이 실려 가는가** 다.
 */
describe("buildWebCheckoutUrl", () => {
  it("★provider=portone 을 항상 명시한다 — 웹 기본값에 기대지 않는다", () => {
    // 웹의 기본 결제사는 운영 env(NEXT_PUBLIC_PAYMENT_PROVIDER)가 정한다.
    // 앱은 그 값을 알 수 없으므로, 국내 결제를 포트원으로 못 박아 보낸다.
    // 이게 빠지면 앱 사용자가 토스 경로로 흘러들어갈 수 있다.
    const url = buildWebCheckoutUrl({ plan: "pro", locale: "ko" });
    expect(url).toBe(
      `${WEB_CHECKOUT_BASE_URL}/checkout?plan=pro&provider=portone&billing=monthly`,
    );
  });

  it("★ko 는 접두사가 없고 en 은 /en 아래로 간다 (localePrefix: as-needed)", () => {
    // 웹 routing.ts 규약: defaultLocale=ko + localePrefix="as-needed".
    // /ko/checkout 도 301 로 살아나지만, 결제 진입에 리다이렉트를 얹지 않는다.
    expect(buildWebCheckoutUrl({ plan: "pro", locale: "ko" })).toContain(
      `${WEB_CHECKOUT_BASE_URL}/checkout?`,
    );
    expect(buildWebCheckoutUrl({ plan: "team", locale: "en" })).toBe(
      `${WEB_CHECKOUT_BASE_URL}/en/checkout?plan=team&provider=portone&billing=monthly`,
    );
  });

  it("알 수 없는 로케일은 기본 로케일(ko)로 접는다 — 접두사 없이 나간다", () => {
    // ja 는 웹이 서비스하지만 앱 로케일은 ko/en 뿐이다. 모르는 값은 ko 로 접는다.
    expect(buildWebCheckoutUrl({ plan: "pro", locale: "ja" })).toBe(
      `${WEB_CHECKOUT_BASE_URL}/checkout?plan=pro&provider=portone&billing=monthly`,
    );
  });

  it("청구 주기를 넘기면 그대로 실리고, 안 넘기면 monthly 다", () => {
    expect(
      buildWebCheckoutUrl({ plan: "pro", locale: "ko", billing: "annual" }),
    ).toContain("billing=annual");
    expect(buildWebCheckoutUrl({ plan: "pro", locale: "ko" })).toContain(
      "billing=monthly",
    );
  });

  it("team_plus 도 결제 가능한 플랜이다(웹 가격표에 있다)", () => {
    expect(buildWebCheckoutUrl({ plan: "team_plus", locale: "ko" })).toContain(
      "plan=team_plus",
    );
  });

  it("★free·enterprise 는 null — 링크를 만들면 금액 0 짜리 빈 결제창이 뜬다", () => {
    // enterprise 는 별도 협의(Contact Sales)라 웹 가격표에 아예 없다.
    expect(buildWebCheckoutUrl({ plan: "free", locale: "ko" })).toBeNull();
    expect(
      buildWebCheckoutUrl({ plan: "enterprise", locale: "ko" }),
    ).toBeNull();
  });

  it("baseUrl 오버라이드는 끝 슬래시를 먹는다(스테이징 오타 방어)", () => {
    expect(
      buildWebCheckoutUrl({
        plan: "pro",
        locale: "ko",
        baseUrl: "https://staging.marblo.app/",
      }),
    ).toBe(
      "https://staging.marblo.app/checkout?plan=pro&provider=portone&billing=monthly",
    );
  });

  it("★accountHint 를 acct 로 싣는다 — 앱이 누구인지 웹이 검증할 수 있어야 한다 (티켓 3Notu54M)", () => {
    // 데스크톱 세션(A)과 브라우저 세션(B)은 별개다. 힌트가 없으면 서버는 B 에
    // 쓰고 앱은 A 를 듣는다 — 앱은 영원히 Free 다. 힌트는 원시 uid 가 아니라
    // lib/checkoutAccountHint 가 만든 불투명·검증 가능 값이다.
    const url = buildWebCheckoutUrl({
      plan: "pro",
      locale: "ko",
      accountHint: "1.0123456789abcdef.56317b4a5d2e5ef436750eaeb319aebd",
    });
    expect(url).toBe(
      `${WEB_CHECKOUT_BASE_URL}/checkout?plan=pro&provider=portone&billing=monthly&acct=1.0123456789abcdef.56317b4a5d2e5ef436750eaeb319aebd`,
    );
  });

  it("accountHint 를 안 주면 acct 파라미터 자체가 없다(기존 호출부 호환)", () => {
    expect(buildWebCheckoutUrl({ plan: "pro", locale: "ko" })).not.toContain(
      "acct=",
    );
  });

  it("★successUrl 류의 앱 로컬 오리진을 절대 싣지 않는다", () => {
    // 회귀 방지: 예전 인앱 토스 경로가 successUrl 을
    // `${window.location.origin}/settings/billing?toss_success=true` 로 줬고,
    // Electron 에서 그 origin 은 앱 자신의 로더(file:// 또는 127.0.0.1)라
    // PG 리다이렉트가 앱으로 돌아오지 않았다. 웹 체크아웃 경로에는 앱 오리진이
    // 등장할 자리가 없어야 한다 — 복귀는 리다이렉트가 아니라 구독 문서로 온다.
    const url = buildWebCheckoutUrl({ plan: "pro", locale: "ko" }) ?? "";
    expect(url).not.toContain("localhost");
    expect(url).not.toContain("127.0.0.1");
    expect(url).not.toContain("file:");
    expect(url).not.toContain("successUrl");
    expect(url).not.toContain("toss");
  });
});

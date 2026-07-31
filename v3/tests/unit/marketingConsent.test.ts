/**
 * 앱 마케팅 수신동의 — 렌더러 순수 로직.
 *
 * 지켜야 할 것은 UI 픽셀이 아니라 **동의를 만들어내지 않는 규칙**이다:
 *   1. 재동의 배너는 "아직 아무 결정도 안 한 파운더"(status=unknown)에게만 뜬다.
 *      granted/pending/revoked/no_contact 는 물론, 수신거부자에게는 절대 안 뜬다 —
 *      수신거부한 사람을 다시 조르면 unsubscribe 왕복이 무의미해진다.
 *   2. 서버 조회 실패(null)를 "동의 안 했음" 으로 접지 않는다 — 모르면 미노출.
 *   3. pre-sign-in 파킹은 체크한 경우에만 남고, 문안 버전이 다르면 버려진다
 *      (사용자가 본 적 없는 문안으로 동의를 만들지 않기 위해).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  shouldShowReconsentBanner,
  hasDismissedReconsent,
  rememberReconsentDismissed,
  dismissKeyFor,
  rememberPendingMarketingOptIn,
  readPendingMarketingOptIn,
  clearPendingMarketingOptIn,
  MARKETING_CONSENT_VERSION,
  type MarketingConsentStatusView,
  type MarketingContactStatus,
} from "../../src/services/marketingConsent";

/** Minimal localStorage — the vitest env is `node`, which has none. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

const PENDING_KEY = "marblo:pendingMarketingConsent";

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = (
  over: Partial<MarketingConsentStatusView> = {},
): MarketingConsentStatusView => ({
  status: "unknown",
  unsubscribed: false,
  isFounder: true,
  ...over,
});

describe("재동의 배너 노출 판정", () => {
  it("아직 결정하지 않은 파운더(status=unknown)에게 노출한다", () => {
    expect(shouldShowReconsentBanner({ view: view(), dismissed: false })).toBe(
      true,
    );
  });

  it("★이미 결정한 사람에게는 노출하지 않는다 (granted/pending/revoked/no_contact)", () => {
    const decided: MarketingContactStatus[] = [
      "granted",
      "pending",
      "revoked",
      "no_contact",
    ];
    for (const status of decided) {
      expect(
        shouldShowReconsentBanner({ view: view({ status }), dismissed: false }),
      ).toBe(false);
    }
  });

  it("★수신거부자에게는 status 와 무관하게 노출하지 않는다", () => {
    expect(
      shouldShowReconsentBanner({
        view: view({ unsubscribed: true }),
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("파운더가 아니면 노출하지 않는다 — 신규 가입자는 온보딩에서 이미 물었다", () => {
    expect(
      shouldShowReconsentBanner({
        view: view({ isFounder: false }),
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("★조회 실패(null)를 '미동의' 로 접지 않는다 — 모르면 안 띄운다", () => {
    expect(shouldShowReconsentBanner({ view: null, dismissed: false })).toBe(
      false,
    );
  });

  it("'다시 안 보기' 를 누른 사람에게는 노출하지 않는다", () => {
    expect(shouldShowReconsentBanner({ view: view(), dismissed: true })).toBe(
      false,
    );
  });
});

describe("'다시 안 보기' 기록", () => {
  it("uid 별로 기록된다 — 한 계정의 dismiss 가 다른 계정에 새지 않는다", () => {
    rememberReconsentDismissed("uid-a");

    expect(hasDismissedReconsent("uid-a")).toBe(true);
    expect(hasDismissedReconsent("uid-b")).toBe(false);
    expect(storage.getItem(dismissKeyFor("uid-a"))).toBe("1");
  });

  it("빈 uid 는 기록하지도, true 로 답하지도 않는다", () => {
    rememberReconsentDismissed("");

    expect(hasDismissedReconsent("")).toBe(false);
    expect(storage.length).toBe(0);
  });
});

describe("가입 전 마케팅 opt-in 파킹", () => {
  it("체크한 답만 현재 문안 버전으로 park 된다", () => {
    rememberPendingMarketingOptIn("en");

    expect(readPendingMarketingOptIn()).toEqual({
      locale: "en",
      version: MARKETING_CONSENT_VERSION,
    });
  });

  it("★park 된 게 없으면 null — 미체크는 아무것도 남기지 않는다", () => {
    expect(readPendingMarketingOptIn()).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("★지난 문안 버전의 답은 버린다(그리고 지운다) — 본 적 없는 문안으로 동의를 만들지 않는다", () => {
    storage.setItem(
      PENDING_KEY,
      JSON.stringify({ locale: "ko", version: "1999-01-01" }),
    );

    expect(readPendingMarketingOptIn()).toBeNull();
    expect(storage.getItem(PENDING_KEY)).toBeNull();
  });

  it("깨진 레코드는 throw 하지 않고 없는 것으로 본다", () => {
    storage.setItem(PENDING_KEY, "{not json");

    expect(() => readPendingMarketingOptIn()).not.toThrow();
    expect(readPendingMarketingOptIn()).toBeNull();
  });

  it("flush 후 clear 하면 다시 읽히지 않는다 — 같은 동의가 재적용되지 않는다", () => {
    rememberPendingMarketingOptIn("ko");
    clearPendingMarketingOptIn();

    expect(readPendingMarketingOptIn()).toBeNull();
  });
});

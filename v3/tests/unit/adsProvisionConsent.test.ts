/**
 * ★해시 이메일의 Google Ads 제3자 제공 동의 판정 — fail-closed 규약.
 *
 * 이 파일이 막는 사고는 하나다: **구글 제공 문구를 본 적 없는 사람이 구글로
 * 나가는 것.** 문구만 바꾸고 배포하면 새 동의자와 기존 199명이 둘 다
 * `granted` 가 되어 영영 구분되지 않는다(티켓 Bz4qVDSRY4QQ7XmONZK4).
 *
 * 판정 규약 셋:
 *   1. ★허용목록이다. 날짜 문자열 크기 비교가 아니다 — 빈 값·미지 값·오타가
 *      true 쪽으로 새는 방향을 만들지 않는다. 모르는 것은 전부 false.
 *   2. `status === "granted"` 와 `legalBasis === "explicit_opt_in"` 을 **둘 다**
 *      요구한다. 백필로 들어온 컨택트가 우연히 새 버전 문자열을 갖더라도
 *      근거 없는 동의를 제공에 쓰지 않는다.
 *   3. 수신거부자는 `isAdsAudienceEligible` 에서 한 겹 더 걸린다.
 *
 * ★기존 동의자를 마이그레이션하지 않는다는 결정이 여기서 테스트로 고정된다.
 *   그들의 version 은 ""·"2026-07-14"·"2026-07-31" 이고 셋 다 목록에 없다.
 */
import { describe, it, expect } from "vitest";
import {
  ADS_PROVISION_CONSENT_VERSIONS,
  consentCoversAdsProvision,
  isAdsAudienceEligible,
  type EmailMarketingConsent,
} from "../../functions/src/marketingContacts";

/** 새 문구로 동의한 사람 — 유일하게 true 가 나와야 하는 모양. */
function newConsent(
  overrides: Partial<EmailMarketingConsent> = {},
): EmailMarketingConsent {
  return {
    status: "granted",
    source: "web_privacy_consent",
    version: ADS_PROVISION_CONSENT_VERSIONS[0],
    consentedAt: null,
    revokedAt: null,
    legalBasis: "explicit_opt_in",
    ...overrides,
  };
}

describe("허용목록 자체", () => {
  it("★비어 있지 않다 — 비면 아무도 광고 대상이 안 되어 조용히 기능이 죽는다", () => {
    expect(ADS_PROVISION_CONSENT_VERSIONS.length).toBeGreaterThan(0);
  });

  it("★구 문구 버전이 목록에 들어가 있지 않다", () => {
    for (const old of ["", "2026-07-14", "2026-07-31"]) {
      expect(ADS_PROVISION_CONSENT_VERSIONS).not.toContain(old);
    }
  });
});

describe("★기존 199명이 새 버전으로 오인되지 않는다", () => {
  // 마이그레이션을 하지 않기로 한 결정(§8-1(2))의 직접적 귀결.
  const legacyVersions = [
    "", // 버전 필드 자체가 없던 컨택트
    "2026-07-14", // 웹 정책 봉투 버전
    "2026-07-31", // 앱·대기자 폼 마케팅 문안 버전
  ];

  for (const version of legacyVersions) {
    it(`granted + version=${JSON.stringify(
      version,
    )} 는 광고 제공 대상이 아니다`, () => {
      const consent = newConsent({ version });
      expect(consent.status).toBe("granted"); // ★발송은 여전히 가능하다
      expect(consentCoversAdsProvision(consent)).toBe(false); // ★제공은 불가
    });
  }

  it("★'발송 가능'과 '광고 제공 가능'이 서로 다른 판정이다", () => {
    const legacy = newConsent({ version: "2026-07-31" });
    const fresh = newConsent();
    // 둘 다 granted 지만
    expect(legacy.status).toBe(fresh.status);
    // 광고 제공 여부는 갈린다 — 이 갈림이 이 티켓의 전부다.
    expect(consentCoversAdsProvision(legacy)).toBe(false);
    expect(consentCoversAdsProvision(fresh)).toBe(true);
  });
});

describe("fail-closed — 모르는 입력은 전부 false", () => {
  it("null·undefined", () => {
    expect(consentCoversAdsProvision(null)).toBe(false);
    expect(consentCoversAdsProvision(undefined)).toBe(false);
  });

  it("★미래의 알 수 없는 버전 문자열도 false — 날짜 비교였다면 true 로 샜을 값", () => {
    for (const v of ["2099-01-01", "2026-09-09-ads", "9999", "latest"]) {
      expect(consentCoversAdsProvision(newConsent({ version: v }))).toBe(false);
    }
  });

  it("★대소문자·공백이 다르면 다른 값이다 — 느슨하게 매칭하지 않는다", () => {
    const v = ADS_PROVISION_CONSENT_VERSIONS[0];
    for (const near of [` ${v}`, `${v} `, v.toUpperCase()]) {
      expect(consentCoversAdsProvision(newConsent({ version: near }))).toBe(
        false,
      );
    }
  });

  it("granted 가 아니면 버전이 맞아도 false", () => {
    for (const status of ["pending", "revoked", "unknown"] as const) {
      expect(consentCoversAdsProvision(newConsent({ status }))).toBe(false);
    }
  });

  it("★legalBasis 가 explicit_opt_in 이 아니면 false — 근거 없는 동의를 제공에 안 쓴다", () => {
    expect(consentCoversAdsProvision(newConsent({ legalBasis: "none" }))).toBe(
      false,
    );
  });

  it("정상 경로는 통한다 — 가드가 전부를 막아 기능이 죽는 것도 실패다", () => {
    expect(consentCoversAdsProvision(newConsent())).toBe(true);
  });
});

describe("isAdsAudienceEligible — 수신거부 한 겹 더", () => {
  it("수신거부자는 새 문구로 동의했어도 제외된다", () => {
    expect(
      isAdsAudienceEligible({
        emailMarketingConsent: newConsent(),
        unsubscribe: {
          status: "unsubscribed",
          tokenHash: null,
          unsubscribedAt: null,
        },
      }),
    ).toBe(false);
  });

  it("구독 중 + 새 문구 동의면 대상이다", () => {
    expect(
      isAdsAudienceEligible({
        emailMarketingConsent: newConsent(),
        unsubscribe: {
          status: "subscribed",
          tokenHash: null,
          unsubscribedAt: null,
        },
      }),
    ).toBe(true);
  });

  it("컨택트가 없으면 false", () => {
    expect(isAdsAudienceEligible(null)).toBe(false);
    expect(isAdsAudienceEligible(undefined)).toBe(false);
  });
});

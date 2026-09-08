/**
 * ★버전을 **어디서 쓰는가** — 문구를 바꾸는 것과 버전을 기록하는 것은 다른 자리다.
 *
 * 문구 테스트만 있으면 **쓰기 누락이 조용히 지나간다.** 한 경로에서 버전을
 * 안 쓰면 그 경로로 들어온 동의자는 영영 구분 불가가 된다 — 문구는 새것을
 * 봤는데 기록은 구 문구와 똑같아서, 나중에 누가 광고 리스트를 뽑을 때
 * 딸려 나오거나(사고) 영영 빠진다(손실). 둘 다 나쁘다.
 *
 * 그래서 이 파일은 **소스를 읽어** 동의를 부여하는 모든 쓰기 지점이
 * `marketingVersion` 을 싣는지 확인한다. 렌더가 아니라 편집으로 들어오는
 * 회귀라, 렌더 테스트로는 못 잡는다.
 *
 * 검사하는 쓰기 지점(2026-09-08 기준 전수):
 *   웹  marblo-web/src/lib/privacyConsent.ts  consentWritePayload
 *        └ 가입 폼 · 필수동의 모달 · /my/privacy 설정 토글이 전부 여기로 온다
 *   앱  v3/src/services/marketingConsentService.ts  saveMarketingOptIn
 *   앱  v3/src/auth/AuthProvider.tsx               가입 화면 마케팅 체크박스
 *
 * ★대기자 폼(marblo-web BetaTester50SignupForm)은 **의도적으로 제외**한다.
 *   그 경로는 `betatester50_waitlist` 문서에 쓰고 `webPrivacyConsent` 를
 *   건드리지 않으며, 문구도 구글 제공을 담지 않아 버전을 올리지 않는다.
 *   그 결과 대기자 경로 동의는 계속 "구 문구"로 남는다 — 안전한 쪽이다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

/** `webPrivacyConsent: { ... }` 객체 리터럴 본문만 뽑는다(중괄호 균형). */
function webPrivacyConsentBlocks(src: string): string[] {
  const out: string[] = [];
  const marker = "webPrivacyConsent: {";
  let from = 0;
  for (;;) {
    const start = src.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start, i + 1));
    from = i + 1;
  }
  return out;
}

const WRITE_SITES: Array<{ label: string; file: string }> = [
  {
    label: "웹 — 가입 폼·필수동의 모달·설정 토글 공통 경로",
    file: "marblo-web/src/lib/privacyConsent.ts",
  },
  {
    label: "앱 — 재동의 배너(saveMarketingOptIn)",
    file: "v3/src/services/marketingConsentService.ts",
  },
  {
    label: "앱 — 가입 화면 마케팅 체크박스",
    file: "v3/src/auth/AuthProvider.tsx",
  },
];

describe("★동의를 쓰는 모든 자리가 marketingVersion 을 싣는다", () => {
  for (const { label, file } of WRITE_SITES) {
    it(`${label} (${file})`, () => {
      const blocks = webPrivacyConsentBlocks(read(file));
      expect(
        blocks.length,
        `${file} 에서 webPrivacyConsent 쓰기 블록을 못 찾았다 — 경로가 바뀌었으면 이 목록을 갱신해라`,
      ).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(
          block.includes("marketingVersion"),
          `${file} 의 webPrivacyConsent 쓰기에 marketingVersion 이 없다:\n${block}`,
        ).toBe(true);
      }
    });
  }
});

describe("웹 — marketingVersion 이 마케팅 동의 여부에 묶여 있다", () => {
  const src = read("marblo-web/src/lib/privacyConsent.ts");

  it("★marketing 이 true 일 때만 현재 버전을 싣는다", () => {
    // 껐는데 버전만 남으면 "동의 안 했는데 새 문구 버전을 가진 사람"이 생긴다.
    expect(src).toMatch(
      /marketingVersion:\s*flags\.marketing\s*\?\s*MARKETING_CONSENT_VERSION\s*:\s*""/,
    );
  });

  it("★읽기 기본값이 빈 문자열이다 — 없는 필드를 현재 버전으로 채우지 않는다", () => {
    expect(src).toMatch(
      /marketingVersion:\s*raw\.marketingVersion\s*\?\?\s*""/,
    );
  });

  it("★정책 봉투 버전은 안 올렸다 — 올리면 전 사용자 재동의 모달이 뜬다(§8-1(2) 위반)", () => {
    expect(src).toMatch(/CURRENT_POLICY_VERSION\s*=\s*"2026-07-14"/);
  });
});

describe("웹 상수와 백엔드 허용목록이 같은 문자열을 본다", () => {
  it("★두 곳이 갈라지면 새 동의자가 아무도 광고 대상이 안 된다", async () => {
    const web = read("marblo-web/src/lib/privacyConsent.ts");
    const m = web.match(/MARKETING_CONSENT_VERSION\s*=\s*"([^"]+)"/);
    expect(m, "웹에서 MARKETING_CONSENT_VERSION 을 못 읽었다").toBeTruthy();
    const { ADS_PROVISION_CONSENT_VERSIONS } =
      await import("../../functions/src/marketingContacts");
    expect(ADS_PROVISION_CONSENT_VERSIONS).toContain(m![1]);
  });
});

describe("백엔드가 정책 봉투 버전이 아니라 마케팅 문안 버전을 읽는다", () => {
  const src = read("v3/functions/src/marketingContacts.ts");

  it("★decideMarketingConsentSync 가 marketingVersion 을 본다", () => {
    // `version` 을 읽으면 정책 개정만 해도 광고 제공 동의를 새로 받은 것처럼 보인다.
    expect(src).toMatch(/afterConsent\.marketingVersion/);
    expect(src).toMatch(/beforeConsent\?\.marketingVersion/);
  });

  it("★앱 쪽 구 문구 버전은 허용목록에 없다", async () => {
    const { ADS_PROVISION_CONSENT_VERSIONS } =
      await import("../../functions/src/marketingContacts");
    const app = read("v3/src/services/marketingConsent.ts");
    const m = app.match(/MARKETING_CONSENT_VERSION\s*=\s*"([^"]+)"/);
    expect(m).toBeTruthy();
    expect(ADS_PROVISION_CONSENT_VERSIONS).not.toContain(m![1]);
  });
});

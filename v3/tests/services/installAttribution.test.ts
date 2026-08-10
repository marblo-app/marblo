import { describe, expect, it } from "vitest";
import { buildInstallLinkUrl } from "../../src/lib/attributionLink";

/**
 * 앱 → 웹 익명 링크백 URL 계약(티켓 rPVkmOKG).
 *
 * 이 URL 이 실어 나르는 것은 **익명 설치 ID 뿐**이다. GA4 client_id 와 유입
 * 채널은 웹 페이지가 자기 브라우저에서 읽는다 — 앱은 그것들을 알지도 못한다.
 */
describe("buildInstallLinkUrl", () => {
  const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("설치 ID·플랫폼·버전을 담은 로케일별 링크를 만든다", () => {
    const url = buildInstallLinkUrl({
      installId: UUID,
      locale: "ko",
      platform: "MacIntel",
      appVersion: "3.0.22",
    });
    expect(url).toBe(
      `https://marblo.app/ko/link?i=${UUID}&p=MacIntel&v=3.0.22`
    );
  });

  it("영어 로케일은 /en 아래로 간다", () => {
    const url = buildInstallLinkUrl({
      installId: UUID,
      locale: "en",
      platform: "Win32",
    });
    expect(url).toBe(`https://marblo.app/en/link?i=${UUID}&p=Win32`);
  });

  it("알 수 없는 로케일은 ko 로 접는다(앱이 지원하는 로케일은 둘뿐)", () => {
    const url = buildInstallLinkUrl({
      installId: UUID,
      locale: "fr",
      platform: "",
    });
    expect(url).toBe(`https://marblo.app/ko/link?i=${UUID}`);
  });

  it("'anon' 폴백 설치 ID 로는 링크를 만들지 않는다", () => {
    // 스토리지를 못 쓰는 설치가 공유하는 값이라 조인키가 될 수 없다 —
    // 열어 봐야 모든 설치가 한 사람으로 뭉친 쓰레기 행만 남는다.
    expect(
      buildInstallLinkUrl({ installId: "anon", locale: "ko", platform: "x" })
    ).toBeNull();
  });

  it("UUID 가 아닌 설치 ID 는 거부한다", () => {
    expect(
      buildInstallLinkUrl({ installId: "", locale: "ko", platform: "x" })
    ).toBeNull();
    expect(
      buildInstallLinkUrl({
        installId: "not-a-uuid",
        locale: "ko",
        platform: "x",
      })
    ).toBeNull();
  });

  it("계정 식별자를 실어 나를 자리가 없다(쿼리 키는 i/p/v 뿐)", () => {
    const url = buildInstallLinkUrl({
      installId: UUID,
      locale: "ko",
      platform: "MacIntel",
      appVersion: "3.0.22",
    })!;
    const keys = Array.from(new URL(url).searchParams.keys()).sort();
    expect(keys).toEqual(["i", "p", "v"]);
  });
});

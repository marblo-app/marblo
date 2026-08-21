import { describe, expect, it } from "vitest";
import {
  buildInstallLinkUrl,
  resolveBuildChannel,
} from "../../src/lib/attributionLink";

/**
 * 앱 → 웹 익명 링크백 URL 계약(티켓 rPVkmOKG).
 *
 * 이 URL 이 실어 나르는 것은 **익명 설치 ID 뿐**이다. GA4 client_id 와 유입
 * 채널은 웹 페이지가 자기 브라우저에서 읽는다 — 앱은 그것들을 알지도 못한다.
 */
describe("buildInstallLinkUrl", () => {
  const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("빌드 채널을 주면 `c` 파라미터로 실린다(개발 재실행 구분 표식)", () => {
    // 이 표식이 없던 동안 install_attribution 550행이 전부 개발 루프의 재실행
    // 이었는데 행만 봐서는 실사용자 유입과 나눌 수 없었다.
    const url = buildInstallLinkUrl({
      installId: UUID,
      locale: "ko",
      platform: "MacIntel",
      appVersion: "3.0.34",
      buildChannel: "dev",
    });
    expect(url).toBe(
      `https://marblo.app/ko/link?i=${UUID}&p=MacIntel&v=3.0.34&c=dev`
    );
  });

  it("빌드 채널을 안 주면 `c` 를 붙이지 않는다(구버전 웹/서버 호환)", () => {
    const url = buildInstallLinkUrl({
      installId: UUID,
      locale: "ko",
      platform: "MacIntel",
    });
    expect(url).toBe(`https://marblo.app/ko/link?i=${UUID}&p=MacIntel`);
  });

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

/**
 * 빌드 채널 판정 — "이 행이 개발 재실행인가 실사용자 첫 실행인가".
 *
 * 관측된 550행은 전부 소스에서 띄운 개발 루프였다(gaClientId 3개, 10~30초
 * 간격, appVersion 이 그날의 package.json HEAD 를 추종). 그 모양을 가르는 게
 * 이 함수의 일이다.
 */
describe("resolveBuildChannel", () => {
  it("vite dev 로 띄운 소스 실행은 dev", () => {
    expect(resolveBuildChannel({ dev: true, protocol: "http:" })).toBe("dev");
  });

  it("패키징된 앱(file: origin)만 prod", () => {
    expect(resolveBuildChannel({ dev: false, protocol: "file:" })).toBe("prod");
  });

  it("빌드 결과를 dev 서버로 얹어 띄운 경우도 dev 로 잡는다", () => {
    // import.meta.env.DEV 는 false 지만 origin 이 file: 이 아니다 — 첫 신호
    // 하나만 보면 이 재실행이 실유입으로 섞인다.
    expect(resolveBuildChannel({ dev: false, protocol: "http:" })).toBe("dev");
    expect(resolveBuildChannel({ dev: false, protocol: "https:" })).toBe("dev");
  });
});

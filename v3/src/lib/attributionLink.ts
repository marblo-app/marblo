/**
 * 어트리뷰션 링크백 URL — 순수 계산만(의존성 0). 단위 테스트 진입점이다.
 *
 * services/installAttribution.ts 는 이 모듈을 감싸 부수효과(스토리지 마커,
 * 브라우저 열기, 텔레메트리 게이트)를 담당한다. 둘을 나눈 이유는 서비스 쪽이
 * firebase 를 끌어오기 때문 — URL 계약 하나를 검증하려고 Auth 를 초기화할 이유가
 * 없다.
 */

/** 설치당 1회 마커. app:first_run 마커와 같은 규약(App.tsx 참조). */
export const INSTALL_LINK_SENT_KEY = "marblo.attribution.linkOpened";

const WEB_BASE_URL = "https://marblo.app";

/**
 * 링크백 URL 을 만든다(순수 — 단위 테스트 진입점).
 *
 * @returns 설치 ID 가 조인키로 못 쓰는 값(`anon`)이면 null — 열지 않는다.
 */
export function buildInstallLinkUrl(args: {
  installId: string;
  locale: string;
  platform: string;
  appVersion?: string;
  baseUrl?: string;
}): string | null {
  const installId = args.installId?.trim().toLowerCase() ?? "";
  // 스토리지를 못 쓰는 설치의 폴백값. 모든 설치가 공유하므로 조인키가 못 된다.
  if (!installId || installId === "anon") return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      installId
    )
  ) {
    return null;
  }
  const locale = args.locale === "en" ? "en" : "ko";
  const params = new URLSearchParams({ i: installId });
  if (args.platform) params.set("p", args.platform);
  if (args.appVersion) params.set("v", args.appVersion);
  const base = args.baseUrl ?? WEB_BASE_URL;
  return `${base}/${locale}/link?${params.toString()}`;
}

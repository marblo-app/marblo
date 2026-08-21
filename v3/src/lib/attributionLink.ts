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

/**
 * 이 행이 **개발/테스트 재실행**인지 **배포된 앱의 첫 실행**인지 가르는 표식.
 *
 * 왜 필요한가: `install_attribution` 첫 550행이 **브라우저 3대에서 나온 첫 실행
 * 550회**(개발 루프에서 프로필을 지우고 다시 띄운 것)였는데, 행만 봐서는
 * 실사용자 유입과 나눌 수 없었다 — appVersion 이 그날의 package.json HEAD 를
 * 따라간다는 **정황**으로 사후 추정할 수 있을 뿐이었고, gaClientId 가 null 인
 * 행(광고차단)에는 그 정황조차 없다. 그래서 행 자체에 표식을 싣는다.
 *
 * ★비식별이다 — 기기·사람·환경에 대한 어떤 정보도 아니고, "이 번들이 소스에서
 *   떴는가" 라는 빌드 사실 하나다.
 * ★신뢰경계: 클라이언트가 보내는 값이라 위조 가능하다. 보안 통제가 아니라
 *   **집계 위생용 표식**이다 — 이걸로 권한을 가르지 않는다.
 */
export type AttributionBuildChannel = "dev" | "prod";

/**
 * 빌드 채널 판정(순수 — 단위 테스트 진입점).
 *
 * 두 신호를 OR 로 묶는다:
 *   · `import.meta.env.DEV` — vite dev 서버로 띄운 소스 실행.
 *   · 렌더러 origin 이 `file:` 이 아님 — 패키징된 앱만 `file:` 에서 뜬다.
 *     `vite build` 결과를 dev 서버/프리뷰로 얹어 띄운 경우를 여기서 잡는다
 *     (그때 `import.meta.env.DEV` 는 false 라 첫 신호만으로는 놓친다).
 *
 * ★한계(정직하게 적어 둔다): **로컬에서 패키징해 설치한 뒤 돌린 재실행은
 *   `prod` 로 잡힌다.** 그 경우까지 나누려면 앱 밖의 신호(설치 출처)가 필요한데
 *   지금 경로엔 없다. 관측된 550행은 전부 소스 실행이라 이 판정으로 갈린다.
 */
export function resolveBuildChannel(env: {
  dev: boolean;
  protocol: string;
}): AttributionBuildChannel {
  if (env.dev) return "dev";
  return env.protocol === "file:" ? "prod" : "dev";
}

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
  buildChannel?: AttributionBuildChannel;
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
  // `c` = build channel. 없으면 웹/서버가 null 로 접는다(구버전 앱과의 호환).
  if (args.buildChannel) params.set("c", args.buildChannel);
  const base = args.baseUrl ?? WEB_BASE_URL;
  return `${base}/${locale}/link?${params.toString()}`;
}

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

// ── ★언제 발화하는가 (2026-08-29 조사 `ZLbWocCSYAd6IVVuXmeT` 의 후속 수리) ──
//
// ── 무엇이 고장나 있었나 ────────────────────────────────────────────────────
//   `notifyInstallAttribution()` 의 호출 지점이 `App.tsx` 의
//   `FirstRunFlow.onComplete` **한 곳뿐**이었다. 그런데 `isFirstRunFlowPending()`
//   은 주석 그대로 *"False for every existing install — deliberately"* 다.
//   → **2026-08-10(링크백 배포 #906) 이전에 첫 실행을 마친 설치는 링크백을
//     영원히 못 보낸다.** 재설치·스토리지 삭제 말고는 복구 경로가 없었다.
//   실측: 텔레메트리를 보낸 설치 42개 중 **39개**가 이 구멍에 걸려 있었다.
//
// ── ★소급 백필이 아니다 ────────────────────────────────────────────────────
//   우리는 과거 데이터를 **만들지 않는다.** 없는 행을 서버에 써 넣는 것도,
//   과거 시각을 지어내는 것도 아니다. 하는 일은 발화 조건을 넓히는 것 하나뿐이고,
//   그 설치들은 **자기가 다음에 실행될 때 스스로** 링크백을 보낸다. 안 켜는
//   설치는 영원히 안 보낸다 — 그것도 사실 그대로다.
//   ★이 구분이 중요한 이유: 백필이면 "우리가 만든 숫자" 이고, 이것은 "설치가
//     보고한 사실" 이다. 전자는 지표로 못 쓴다.
//
// ── ★정확히 1회 ────────────────────────────────────────────────────────────
//   마커는 **여는 시도 직전에 쓰고, 던지면 되돌린다**(installAttribution.ts).
//   왜 "전송 성공 후" 가 아닌가: 성공을 관측할 방법이 없다. `window.open` 은
//   main 의 `setWindowOpenHandler` 가 `shell.openExternal` 로 넘기며 보통
//   `null` 을 돌려주므로 반환값은 성공/실패 신호가 아니다. 관측 가능한 실패는
//   **던진 예외 하나뿐**이다.
//   왜 "쓰기를 먼저" 인가: 스토리지가 망가진 설치에서 열기를 먼저 하면 마커를
//   못 남긴 채 창만 열려 **매 실행마다 브라우저가 튄다.** 쓰기가 먼저면 그런
//   설치는 아예 발화하지 않는다. 되돌리기는 그 안전성을 잃지 않고 재시도를
//   되찾는 유일한 순서다.

/** 발화를 접은 이유. ★`null` 이 아니면 **왜 안 보냈는지**가 항상 남는다. */
export type LinkbackSkipReason =
  | "already_sent"
  | "telemetry_declined"
  | "first_run_flow_pending"
  | "detached_window";

/** 실행 시점 발화 판정에 필요한 사실. 전부 렌더러가 읽어 오는 값이다. */
export interface LaunchLinkbackFacts {
  /** 설치당 1회 마커가 이미 찍혀 있나. */
  readonly alreadySent: boolean;
  /** ★텔레메트리 동의 상태인가. 미동의면 어떤 경우에도 열지 않는다. */
  readonly telemetryEnabled: boolean;
  /**
   * 최초 실행 플로우가 아직 떠 있나.
   *
   * ★떠 있으면 **여기서 열지 않는다.** 그 경로는 동의 화면을 통과한 직후에
   *   `FirstRunFlow.onComplete` 가 연다 — 동의를 묻기도 전에 외부 요청이 나가고
   *   모달 위로 창이 튀는 것을 막으려고 일부러 그 자리에 둔 순서다.
   */
  readonly firstRunFlowPending: boolean;
  /** 떼어낸 팝아웃 창인가. 첫 실행이 아니라 본창 세션에 얹혀 있는 창이다. */
  readonly detachedWindow: boolean;
}

/**
 * 실행 시점에 링크백을 열까? ★`null` 이면 연다.
 *
 * 순수 함수다 — 이 판정이 단위 테스트의 진입점이고, 마커 × 동의 × 첫실행 ×
 * 팝아웃의 조합이 여기서 전수로 잠긴다.
 */
export function decideLaunchLinkback(
  f: LaunchLinkbackFacts
): LinkbackSkipReason | null {
  // ★팝아웃이 먼저다. 본창의 판정을 팝아웃이 대신 내리면 안 된다.
  if (f.detachedWindow) return "detached_window";
  // ★동의가 그 다음이다. 마커보다 앞에 두는 이유: 미동의 설치에서는 마커를
  //   읽었다는 사실조차 발화 경로에 들어가지 않는 게 맞다.
  if (!f.telemetryEnabled) return "telemetry_declined";
  if (f.alreadySent) return "already_sent";
  if (f.firstRunFlowPending) return "first_run_flow_pending";
  return null;
}

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

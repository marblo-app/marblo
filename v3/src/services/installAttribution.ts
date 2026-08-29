/**
 * 설치 어트리뷰션 링크백 — 앱 → 웹 통지 (티켓 rPVkmOKG).
 *
 * 무엇을 하나: 설치 후 **최초 실행 플로우가 끝난 직후 한 번**, 기본 브라우저로
 * `https://marblo.app/<locale>/link?i=<익명 설치 ID>` 를 연다. 그 브라우저는
 * 보통 설치 파일을 내려받은 그 브라우저이므로, 웹 페이지가 자기 `_ga` 쿠키에서
 * GA4 client_id 를 읽어 설치 ID 와 묶어 서버에 보고한다.
 *
 * 왜 이 방향인가(#901 §6 대비):
 *   · 우리 다운로드는 GitHub 릴리스 **직링크**라 서버가 다운로드를 보지 못하고,
 *     바이너리는 서명·공증되어 있어 사용자별 토큰을 심을 수 없다.
 *   · 클립보드 핸드오프는 **조용히** 실패한다. 이 방식은 성공/실패가 눈에 보이고
 *     (환영 페이지가 상태를 말한다) 결정론적이다.
 *
 * ★보내는 것: 익명 설치 ID(UUID), 플랫폼, 앱 버전. **그게 전부다** — 나머지
 *   (GA4 client_id, 유입 채널)는 웹이 자기 브라우저에서 읽는다. uid·이메일은
 *   이 경로에 존재하지 않는다(티켓 woXp2c70 과 정합).
 * ★게이트: 텔레메트리 옵트아웃 상태면 열지 않는다. 설치당 1회만 연다.
 * ★빌드 채널(dev/prod)도 함께 보낸다 — 개발 루프의 재실행이 실사용자 유입과
 *   같은 행으로 섞이면 유입 수를 못 믿게 된다(첫 550행이 정확히 그랬다).
 *   비식별 빌드 사실 하나이고 사람·기기에 대한 정보가 아니다.
 */
import { getClientId, isTelemetryEnabled } from "./telemetryService";
import { useLocaleStore } from "../lib/i18n";
import {
  INSTALL_LINK_SENT_KEY,
  buildInstallLinkUrl,
  decideLaunchLinkback,
  resolveBuildChannel,
  type LaunchLinkbackFacts,
  type LinkbackSkipReason,
} from "../lib/attributionLink";

export {
  INSTALL_LINK_SENT_KEY,
  buildInstallLinkUrl,
  decideLaunchLinkback,
  resolveBuildChannel,
};

/** 설치당 1회 마커가 이미 찍혀 있나. 스토리지를 못 읽으면 "찍혔다" 로 본다. */
export function hasSentInstallLink(): boolean {
  try {
    return localStorage.getItem(INSTALL_LINK_SENT_KEY) === "true";
  } catch {
    // ★못 읽으면 보수적으로 "보냈다" 로 답한다. 이 값이 발화를 여는 열쇠라
    //   모르는 쪽으로 열면 매 부팅마다 브라우저가 튄다.
    return true;
  }
}

/**
 * 설치당 1회 마커를 **여는 시도 직전에** 찍는다. 이미 찍혀 있으면 false.
 *
 * ★쓰기가 열기보다 먼저인 이유는 attributionLink.ts 머리말 "정확히 1회" 절에
 *   있다 — 스토리지가 망가진 설치에서 매 실행마다 창이 튀는 것을 막는다.
 */
function markAttempt(): boolean {
  try {
    if (localStorage.getItem(INSTALL_LINK_SENT_KEY) === "true") return false;
    localStorage.setItem(INSTALL_LINK_SENT_KEY, "true");
    return true;
  } catch {
    // 스토리지를 못 쓰면 "매 부팅마다 브라우저 열림" 위험이 있으므로 아예 안 연다.
    return false;
  }
}

/**
 * 열기가 **던졌을 때만** 마커를 되돌린다 — 다음 실행에서 재시도할 수 있게.
 *
 * ★`window.open` 의 반환값(보통 null)은 실패 신호가 아니다. main 의
 *   `setWindowOpenHandler` 가 외부 브라우저로 넘기며 창 핸들을 주지 않기
 *   때문이다. 그래서 되돌리는 조건은 오직 예외다.
 */
function rollbackAttempt(): void {
  try {
    localStorage.removeItem(INSTALL_LINK_SENT_KEY);
  } catch {
    // 되돌리기에 실패하면 재시도를 잃을 뿐, 중복 발화는 없다(안전한 쪽).
  }
}

/**
 * 링크백을 실제로 연다. ★동의 게이트 · 마커 · 되돌리기가 전부 여기 한 곳이다 —
 * 첫 실행 경로와 실행 시점 경로가 같은 몸통을 쓴다.
 */
function openLinkbackOnce(): void {
  if (!isTelemetryEnabled()) return;
  const url = buildInstallLinkUrl({
    installId: getClientId(),
    locale: useLocaleStore.getState().locale,
    platform:
      (typeof navigator !== "undefined" && navigator.platform) || "unknown",
    appVersion:
      typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
    buildChannel: resolveBuildChannel({
      dev: import.meta.env.DEV,
      protocol:
        typeof window !== "undefined" ? window.location.protocol : "file:",
    }),
  });
  if (!url) return;
  if (!markAttempt()) return;
  try {
    // main 의 setWindowOpenHandler 가 외부 https + _blank 를 shell.openExternal
    // 로 넘긴다(새 IPC 없음 — WorktreeTab/ModelFactSheet 과 같은 경로).
    window.open(url, "_blank");
  } catch (err) {
    // ★던졌다 = 못 열었다. 마커를 되돌려 다음 실행에서 다시 시도한다.
    rollbackAttempt();
    throw err;
  }
}

/**
 * 최초 실행 플로우(언어 → 개인정보 동의) 완료 직후 1회 호출한다.
 *
 * 동의 화면 **뒤에** 두는 이유: 그 전에 브라우저를 열면 동의를 묻기도 전에
 * 외부 요청이 나가고, 사용자가 동의 모달을 보는 도중 창이 튀어 흐름이 끊긴다.
 *
 * 실패는 전부 조용히 삼킨다 — 어트리뷰션 때문에 앱 첫 실행이 깨지면 안 된다.
 */
export function notifyInstallAttribution(): void {
  try {
    openLinkbackOnce();
  } catch {
    // 링크백은 부수효과다. 여기서 던지면 첫 실행이 죽는다.
  }
}

/**
 * ★기존 설치를 위한 발화 경로 — **아무 실행에서든 1회**(티켓 VfWJtnAl).
 *
 * 위 `notifyInstallAttribution()` 은 최초 실행 플로우 안에서만 불린다. 그런데
 * `isFirstRunFlowPending()` 은 이미 로케일을 고른 설치에 **항상 false** 이므로,
 * 링크백 배포(2026-08-10) 이전에 첫 실행을 마친 설치는 그 호출을 영원히 못 만난다
 * — 이벤트를 보낸 설치 42개 중 39개가 그 상태였다.
 *
 * ★소급 백필이 아니다. 우리가 과거 행을 만드는 게 아니라, 그 설치들이 **다음에
 *   켜질 때 스스로** 보낸다. 자세한 근거는 lib/attributionLink.ts 머리말에 있다.
 *
 * ★동의 판정의 시점 한계(정직하게 적어 둔다): 이 호출은 로그인 **전**에 일어나고,
 *   그때 `isTelemetryEnabled()` 가 읽는 것은 localStorage 에 남은 값이다.
 *   `PrivacyConsentGate` 와 `PrivacySettings` 가 동의가 바뀔 때마다 그 값을
 *   저장하므로 **같은 기기에서의 옵트아웃은 정확히 반영된다.** 반영이 늦는
 *   경우는 하나뿐이다 — 다른 기기에서 방금 옵트아웃하고 이 기기에서는 아직 한
 *   번도 로그인하지 않은 경우. 그 창은 텔레메트리 flush 게이트가 이미 가진
 *   것과 **같은 창**이고, 여기서만 다르게 굴면 두 게이트가 갈린다.
 *
 * @returns 접었으면 그 사유, 열었으면 null. ★사유를 돌려주는 이유: 호출부가
 *   "안 열렸다" 를 관측할 수 있어야 테스트가 조합을 잠글 수 있다.
 */
export function notifyInstallAttributionOnLaunch(ctx: {
  firstRunFlowPending: boolean;
  detachedWindow: boolean;
}): LinkbackSkipReason | null {
  try {
    const facts: LaunchLinkbackFacts = {
      alreadySent: hasSentInstallLink(),
      telemetryEnabled: isTelemetryEnabled(),
      firstRunFlowPending: ctx.firstRunFlowPending,
      detachedWindow: ctx.detachedWindow,
    };
    const skip = decideLaunchLinkback(facts);
    if (skip) return skip;
    openLinkbackOnce();
    return null;
  } catch {
    // 링크백은 부수효과다. 앱 부팅을 여기서 죽이지 않는다.
    return null;
  }
}

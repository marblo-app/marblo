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
  resolveBuildChannel,
} from "../lib/attributionLink";

export { INSTALL_LINK_SENT_KEY, buildInstallLinkUrl, resolveBuildChannel };

/** 설치당 1회 마커를 찍는다. 이미 찍혀 있으면 false. */
function markOnce(): boolean {
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
 * 최초 실행 플로우(언어 → 개인정보 동의) 완료 직후 1회 호출한다.
 *
 * 동의 화면 **뒤에** 두는 이유: 그 전에 브라우저를 열면 동의를 묻기도 전에
 * 외부 요청이 나가고, 사용자가 동의 모달을 보는 도중 창이 튀어 흐름이 끊긴다.
 *
 * 실패는 전부 조용히 삼킨다 — 어트리뷰션 때문에 앱 첫 실행이 깨지면 안 된다.
 */
export function notifyInstallAttribution(): void {
  try {
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
    if (!markOnce()) return;
    // main 의 setWindowOpenHandler 가 외부 https + _blank 를 shell.openExternal
    // 로 넘긴다(새 IPC 없음 — WorktreeTab/ModelFactSheet 과 같은 경로).
    window.open(url, "_blank");
  } catch {
    // 링크백은 부수효과다. 여기서 던지면 첫 실행이 죽는다.
  }
}

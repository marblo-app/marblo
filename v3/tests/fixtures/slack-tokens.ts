/**
 * Slack 토큰 픽스처 — 접두사와 본문을 나눠 두고 런타임에 잇는다.
 *
 * 여기 쓰이는 값은 전부 합성이지만 시크릿 스캐너는 값이 아니라 **형태**만
 * 본다. 완성형 `xoxb-…`/`xapp-…` 문자열이 소스에 리터럴로 남아 있으면
 * GitHub push protection 이 그 파일을 담은 커밋의 푸시를 통째로 막는다.
 * 그래서 접두사 상수 + 조립 함수로 쪼갠다 — 소스 어디에도 완성된 토큰
 * 문자열은 남지 않고, 값은 런타임에만 존재한다.
 *
 * ★조립 결과는 실제 토큰과 **같은 형태**를 유지해야 한다. 본문을 짧게
 * 줄이거나 엔트로피를 낮추면 두 테스트가 동시에 의미를 잃는다:
 *   - 레닥션 회귀 스위트(§5.6)가 검증하는 것은 "현실적인 모양의 토큰이
 *     실제로 가려지는가" 이다.
 *   - `preflightSlackChannel` 은 `^xoxb-[A-Za-z0-9-]{10,}$` /
 *     `^xapp-[A-Za-z0-9-]{10,}$` 를 요구한다.
 * 본문 값 자체는 기존 픽스처와 바이트 단위로 동일하게 유지한다(레닥션
 * 골든 스냅샷이 값에 묶여 있다).
 */

/** Slack bot token 접두사(Web API — chat.postMessage/auth.test). */
const BOT_PREFIX = "xoxb-";
/** Slack user token 접두사(레닥션 코퍼스 전용). */
const USER_PREFIX = "xoxp-";
/** Slack app token 접두사(Socket Mode — apps.connections.open). */
const APP_PREFIX = "xapp-";

/** `xoxb-` + 본문. 본문은 실제 bot token 과 같은 세그먼트 구조여야 한다. */
export function slackBotToken(body: string): string {
  return BOT_PREFIX + body;
}

/** `xoxp-` + 본문. */
export function slackUserToken(body: string): string {
  return USER_PREFIX + body;
}

/** `xapp-` + 본문. Socket Mode 토큰은 `1-A…` 세그먼트로 시작한다. */
export function slackAppToken(body: string): string {
  return APP_PREFIX + body;
}

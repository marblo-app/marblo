/**
 * ★`user_key` 배선점 — **한 곳뿐이다.**
 *
 * analytics_purchase(ticket 6EnTiEzL7T2NpjOnTTSj)는 **계정축** 테이블이고, 그
 * 축에서 같은 사람을 잇는 공용 키가 `user_key` 다. 그 키를 만드는 HMAC 함수는
 * **한 벌만** 있어야 하고, 웹·앱·백필·어드민이 전부 그 한 벌을 쓴다.
 *
 * ── ★배선 완료(2026-08-21) ─────────────────────────────────────────────────
 * 공용 함수는 사람 축 구현(PR #1084)이 넣었다 — `analyticsPseudonym` 의
 * `user` kind, 즉 `us_` + HMAC(salt, "user:" + uid)(설계 §3.3). 그래서 이 파일은
 * **더 이상 아무것도 기다리지 않는다.** 이 모듈이 하는 일은 그 한 벌을 계정축
 * 적재 경로에 이어 주는 것뿐이고, 자체 HMAC 은 여전히 만들지 않는다.
 *
 * ★여기서 새 해시를 만들지 마라(임시든 아니든). 두 벌이 생기면 언젠가 갈라지고,
 * 갈라지면 **계정축 안**의 조인이 조용히 깨진다 — 행은 그대로 있고 JOIN 결과만
 * 0 이 되므로 표가 비어 보일 뿐 아무도 원인을 못 찾는다.
 *
 * ── ★"미배선이면 적재 거부" 는 그대로 남긴다 ───────────────────────────────
 * 지금은 배선이 있으니 이 게이트가 발화하지 않는다. 그래도 반환 타입의 `null`
 * 과 호출측 게이트(backfill / loadAnalyticsPurchaseInternal)는 **지우지 않는다.**
 * 공용 함수가 언젠가 옮겨지거나 빠지면 그때 조용히 임시 키로 적재되는 대신
 * 시끄럽게 멈춰야 한다. 행 단위로도 같은 규율이다 — 키를 못 만든 행은
 * `no_user_key` 로 세어 버리고 만들지 않는다.
 *
 * ── ★익명축과 조인하지 않는다 ──────────────────────────────────────────────
 * `user_key` 로 `analytics_identity`(익명축: install_key / ga_key) 와 직접 잇지
 * 마라. 두 축을 잇는 자리는 `marblo_identity.analytics_user_install` **하나뿐**
 * 이고(personAxis.ts), 그 자리는 `PERSON_AXIS_EFFECTIVE_FROM` 게이트가 열려
 * 있을 때만 채워진다. 근거: 배포된 처리방침
 * v3/src/components/legal/privacyContent.tsx 의 항목 "사용량·비용 기록 (계정
 * 연결)" — "연결한 결과는 통계 분석에만 쓰이고, 특정 개인을 알아보거나 특정
 * 계정이 무엇을 했는지 되짚는 데는 쓰지 않습니다".
 * ★2026-08-29(ticket O9iJMtgGy5glQ2oESvRN): 원래 인용은 "두 기록이 공유하는
 * 조인 키는 없습니다" 였다. 결합 고지(B안)로 **교체**됐다 — 근거 문장이 바뀐
 * 것이고 축 경계 규칙 자체는 그대로다. ★행 번호로 인용하지 마라(항목 이름으로
 * 가리킨다). 처리방침을 손대면 이 인용부터 다시 맞춰라.
 *
 * ★그 게이트는 **이 파일의 조건이 아니다.** 게이트가 닫혀 있으면 사람 축(링크표
 * ·뷰)이 0행이라는 사실은 그대로지만, analytics_purchase 는 성격상 익명일 수
 * 없는 계정축 기록이라 처리방침이 명시적으로 허용한다("이 기록만은 성격상
 * 익명일 수 없습니다"). 계정축 **안에서의** 조인은 금지가 아니다. 그래서
 * 결제 원장 적재를 게이트에 매달지 않는다 — 매달면 결제 기록이 사람 축 발효일
 * 설정 여부에 따라 조용히 사라진다.
 */

import {
  pseudonymizeAnalyticsId,
  readAnalyticsIdSalt,
} from "./analyticsPseudonym";

/** 계정 uid → 공용 가명 계정키(계정축 전용). 못 만들면 null. */
export type AnalyticsUserKeyFn = (uid: string) => string | null;

/**
 * 공용 함수가 없을 때 사람이 읽을 수 있게 남기는 사유(로그·보고용).
 *
 * ★지금은 배선이 있어 이 문구가 뜨지 않는다. 이게 다시 보이면 공용 HMAC 함수가
 * 빠졌다는 뜻이고, 그때 할 일은 임시 키로 메꾸는 게 아니라 함수를 되돌리는 것이다.
 */
export const ANALYTICS_USER_KEY_BLOCKER =
  "공용 user_key HMAC 함수를 찾을 수 없다 — analyticsPseudonym 의 `user` kind" +
  "(PR #1084)가 빠졌는지 확인해라. 임시 해시로 메꾸지 마라: 임시 키로 적재한 " +
  "과거분은 나중에 전부 다시 써야 하고, 그 사이 '수익' 탭은 조인되지 않는 표를 " +
  "진짜인 것처럼 보여준다.";

/**
 * 공용 계정키 함수를 돌려준다. 공용 함수 자체가 없으면 null.
 *
 * ★솔트 부재는 여기서 null 을 돌려주는 사유가 **아니다.** 호출측이 솔트 미설정을
 * 따로 세어 별도 사유로 보고하기 때문이다(두 사유를 합치면 화면이 "미배선" 이라고
 * 거짓말한다). 솔트가 없으면 돌려준 함수가 행 단위로 null 을 내고, 그 행은
 * `no_user_key` 로 세어 버려진다.
 */
export function resolveAnalyticsUserKeyFn(): AnalyticsUserKeyFn | null {
  // ★지금은 항상 함수를 돌려준다(공용 함수가 정적 import 로 붙어 있으므로).
  //   그래도 반환 타입의 `| null` 은 남긴다 — 호출측의 "미배선이면 적재 거부"
  //   게이트가 그 타입 위에 서 있고, 공용 함수를 떼어내는 변경이 오면 여기서
  //   null 로 바꾸는 한 줄이 그 게이트를 다시 켠다.
  return (uid: string): string | null => {
    const trimmed = typeof uid === "string" ? uid.trim() : "";
    if (trimmed.length === 0) return null;
    const key = pseudonymizeAnalyticsId("user", trimmed, readAnalyticsIdSalt());
    return typeof key === "string" && key.length > 0 ? key : null;
  };
}

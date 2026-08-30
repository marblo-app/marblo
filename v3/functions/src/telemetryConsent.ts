// 1차 비식별 텔레메트리 동의(옵트아웃) — 서버측 판정의 **순수 로직**.
// trainingCapture.ts 와 같은 규약이다: Firestore/BQ 의존이 0 이라 `node --test`
// 로 단위검증한다. 실제 문서 읽기는 index.ts 의 얇은 배선이 한다.
//
// ── ★왜 이 파일이 생겼나 (ticket tTtuwzkhL64CdPtoGaGN) ──────────────────────
// 배포된 처리방침은 항목 "변경 권리" 에서 이렇게 약속한다:
//   "Settings → Privacy 토글에서 언제든 변경 (PIPA 제22조)"
// 그런데 2026-08-30 실측: **Cloud Functions 어디에도 그 토글을 읽는 코드가
// 없었다.** `firstPartyTelemetry` 는 `users/<uid>.privacyConsent` 에 이미
// 저장돼 있고(v3/src/services/privacyConsentService.ts), 같은 문서의 다른
// 플래그(`trainingDataCapture`)는 서버가 이미 읽고 있는데(trainingCapture.ts),
// 텔레메트리 쪽만 클라이언트 게이트 하나에 전부를 걸고 있었다.
//
// 그 구조의 문제는 "클라를 못 믿는다" 가 아니라 **약속의 소재지**다. 방침이
// 약속한 것은 우리가 안 쓴다는 것인데, 안 쓰기로 하는 판단이 전부 앱 안에만
// 있으면 앱과 서버 사이에 낀 어떤 사정(구버전 설치, 큐에 남은 배치, 재시도
// 버퍼)도 그대로 적재가 된다. 실제로 이 티켓이 잡은 구멍이 정확히 그것이었다
// (telemetryService.ts 의 큐 배수 — 끈 뒤에도 마지막 배치가 나갔다). 그 구멍은
// 클라에서 막았고, 이 파일은 **같은 약속을 서버에서도 성립하게** 만든다.
//
// ── ★이건 옵트인 전환이 아니다 ─────────────────────────────────────────────
// 1차 비식별 텔레메트리는 기본 ON 이 맞다(정당한 이익 근거 · firstPartyGate.ts ·
// CEO 승인 2026-07-17). 그래서 **미설정은 granted 다** — 동의 문서가 없거나
// 필드가 없는 사용자를 denied 로 접으면 그 순간 기본값이 뒤집히고 수집이
// 통째로 멎는다. 여기서 닫는 것은 **명시적 false 하나뿐**이다.

/** `users/<uid>` 문서에서 이 판정에 필요한 부분만. */
export interface TelemetryConsentDoc {
  privacyConsent?: {
    firstPartyTelemetry?: unknown;
  } | null;
}

/**
 * - `granted` : 명시적 true, 또는 **미설정**(문서·필드 부재 = 기본 ON).
 * - `denied`  : 명시적 false. 사용자가 토글을 껐다.
 * - `unknown` : 조회 자체를 못 했다(Firestore 오류). ★`denied` 와 다른 값으로
 *   둔다 — 둘을 합치면 Firestore 가 잠깐 흔들릴 때 수집이 통째로 멎거나(합쳐서
 *   denied), 반대로 진짜 옵트아웃이 조용히 무시된다(합쳐서 granted).
 */
export type TelemetryConsentState = "granted" | "denied" | "unknown";

/**
 * 문서 → 동의 상태. ★`false` 만 거절이다(위 "옵트인 전환이 아니다" 참조).
 * 문자열 "false" 같은 것도 거절로 치지 않는다 — 이 필드를 쓰는 곳은
 * privacyConsentService.ts 하나고 거기서는 항상 boolean 이다. 넓게 해석하면
 * 오히려 예상 못 한 값이 수집을 끄는 경로가 된다.
 */
export function resolveTelemetryConsent(
  doc: TelemetryConsentDoc | null | undefined,
): TelemetryConsentState {
  return doc?.privacyConsent?.firstPartyTelemetry === false
    ? "denied"
    : "granted";
}

/**
 * 이 배치를 어디까지 적재해도 되는지.
 *
 * ★**판별 유니온**으로 둔다(boolean 3개짜리 평평한 객체가 아니라). 그래야
 *   호출부에서 `writePersonAxis` 가 false 인 가지의 `reason` 이 자동으로
 *   "각인 안 한 사유"(StampSkipReason)로 좁혀진다 — 사유 코드를 손으로
 *   캐스팅해 옮기는 자리가 생기지 않는다. 조합을 늘리려면 여기 한 줄을
 *   추가해야 하고, 그때 세 필드의 정합을 다시 생각하게 된다.
 */
export type TelemetryIngestDecision =
  | {
      readonly writeEvents: true;
      readonly writePersonAxis: true;
      readonly reason: "ok";
    }
  | {
      readonly writeEvents: true;
      readonly writePersonAxis: false;
      readonly reason: "consent_unknown";
    }
  | {
      readonly writeEvents: false;
      readonly writePersonAxis: false;
      readonly reason: "telemetry_opt_out";
    };

/**
 * ★`unknown` 의 처리가 이 함수의 요점이다 — **한쪽으로만 실패하지 않는다.**
 *
 *  - events 행은 적재한다. 익명 설치 ID 로만 식별되는 행이고, Firestore 가
 *    잠깐 흔들렸다고 제품 운영 지표를 통째로 버리는 건 대가가 너무 크다.
 *  - 사람 축은 만들지 않는다. 그건 **계정에서 파생되는** 값이라 동의를 확인하지
 *    못한 채로 만들면 안 된다. 못 만든 사람 축은 나중에 링크표 소급으로 복구할
 *    수 있지만(personAxis.ts `v_person_all_time`), 동의 없이 만들어 버린 각인은
 *    되돌리는 데 삭제요청 절차(scripts/erase-person-axis.ts)가 필요하다.
 *    실패의 값이 다르다.
 *
 * `denied` 는 둘 다 막는다. 이 자리에 요청이 도달한다는 것은 클라 게이트를
 * 지나쳤다는 뜻이고(구버전 설치 / 큐에 남은 배치 / 변조), 그때 우리가 방침에
 * 대고 말할 수 있는 유일한 답은 "안 썼다" 다.
 */
export function decideTelemetryIngest(
  state: TelemetryConsentState,
): TelemetryIngestDecision {
  if (state === "denied") {
    return {
      writeEvents: false,
      writePersonAxis: false,
      reason: "telemetry_opt_out",
    };
  }
  if (state === "unknown") {
    return {
      writeEvents: true,
      writePersonAxis: false,
      reason: "consent_unknown",
    };
  }
  return { writeEvents: true, writePersonAxis: true, reason: "ok" };
}

// telemetryConsent.ts — 옵트아웃 왕복의 **서버측** 고정.
// 실행: cd v3/functions && npm run test:telemetry-consent
//
// ★이 파일이 지키는 문장은 배포된 처리방침의 항목 "변경 권리" 다:
//   "Settings → Privacy 토글에서 언제든 변경 (PIPA 제22조)"
// 그리고 그 반대편, 항목 "비식별 1차 지표 (BigQuery)" 의 "상시 수집" 이다 —
// 기본 ON 을 옵트인으로 뒤집는 회귀도 여기서 같이 막는다.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decideTelemetryIngest,
  resolveTelemetryConsent,
  type TelemetryConsentDoc,
} from "./telemetryConsent";

// ═══════════════════════════════════════════════════════════════════════════
// 1) 문서 → 동의 상태. ★미설정은 granted 다(기본 ON 을 뒤집지 않는다)
// ═══════════════════════════════════════════════════════════════════════════

test("★명시적 false 만 옵트아웃이다", () => {
  assert.equal(
    resolveTelemetryConsent({ privacyConsent: { firstPartyTelemetry: false } }),
    "denied",
  );
});

test("★미설정은 granted 다 — 기본 ON(정당한 이익)을 옵트인으로 뒤집지 않는다", () => {
  const unsetShapes: Array<TelemetryConsentDoc | null | undefined> = [
    null,
    undefined,
    {},
    { privacyConsent: null },
    { privacyConsent: {} },
    { privacyConsent: { firstPartyTelemetry: undefined } },
  ];
  for (const doc of unsetShapes) {
    assert.equal(
      resolveTelemetryConsent(doc),
      "granted",
      `${JSON.stringify(doc)} 가 수집을 껐다 — 기본값이 뒤집혔다`,
    );
  }
});

test("명시적 true 는 granted", () => {
  assert.equal(
    resolveTelemetryConsent({ privacyConsent: { firstPartyTelemetry: true } }),
    "granted",
  );
});

test("★boolean 이 아닌 값은 옵트아웃으로 치지 않는다 — 넓게 해석하면 예상 못 한 값이 수집을 끈다", () => {
  for (const weird of ["false", 0, "", null]) {
    assert.equal(
      resolveTelemetryConsent({
        privacyConsent: { firstPartyTelemetry: weird },
      }),
      "granted",
      `${JSON.stringify(weird)} 가 수집을 껐다`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) 상태 → 적재 판정. ★끄면 0, 켜면 재개 — 한쪽만 고정하면 회귀를 통과시킨다
// ═══════════════════════════════════════════════════════════════════════════

test("★껐으면 events 도 사람 축도 쓰지 않는다 (호출 0)", () => {
  const d = decideTelemetryIngest("denied");
  assert.equal(d.writeEvents, false);
  assert.equal(d.writePersonAxis, false);
  assert.equal(d.reason, "telemetry_opt_out");
});

test("★켜면 재개된다 — 게이트가 죽은 길이 아니다", () => {
  const d = decideTelemetryIngest("granted");
  assert.equal(d.writeEvents, true);
  assert.equal(d.writePersonAxis, true);
  assert.equal(d.reason, "ok");
});

test("★동의 조회 실패는 한쪽으로만 실패하지 않는다 — events 는 적재, 사람 축은 보류", () => {
  const d = decideTelemetryIngest("unknown");
  // 익명 설치 ID 로만 식별되는 행까지 버리면 Firestore 가 흔들릴 때마다 제품
  // 운영 지표가 통째로 사라진다.
  assert.equal(d.writeEvents, true);
  // 계정에서 파생되는 값은 동의를 확인하지 못한 채로 만들지 않는다. 못 만든
  // 사람 축은 링크표 소급으로 복구되지만, 만들어 버린 각인은 삭제요청 절차가
  // 필요하다 — 실패의 값이 다르다.
  assert.equal(d.writePersonAxis, false);
  assert.equal(d.reason, "consent_unknown");
});

test("★사유 코드에 식별자가 없다 — 그대로 Cloud Logging 과 응답에 실린다", () => {
  for (const state of ["granted", "denied", "unknown"] as const) {
    const { reason } = decideTelemetryIngest(state);
    assert.match(reason, /^[a-z_]+$/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) ★문서 → 적재까지 한 번에. 이게 실제 왕복이다
// ═══════════════════════════════════════════════════════════════════════════

test("★왕복: 끄면 아무것도 안 쓰고, 다시 켜면 사람 축까지 재개된다", () => {
  const off = decideTelemetryIngest(
    resolveTelemetryConsent({ privacyConsent: { firstPartyTelemetry: false } }),
  );
  assert.deepEqual(
    { e: off.writeEvents, p: off.writePersonAxis },
    { e: false, p: false },
  );

  const on = decideTelemetryIngest(
    resolveTelemetryConsent({ privacyConsent: { firstPartyTelemetry: true } }),
  );
  assert.deepEqual(
    { e: on.writeEvents, p: on.writePersonAxis },
    { e: true, p: true },
  );
});

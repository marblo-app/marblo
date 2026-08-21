import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_TOUCH_STORAGE_KEY,
  buildLinkInstallPayload,
  captureFirstTouchInto,
  deriveFirstTouch,
  parseFirstTouch,
  parseGaClientId,
  sanitizeBuildChannel,
  sanitizeField,
  sanitizeInstallId,
  type AttributionStorage,
} from "./attribution";

function memoryStorage(
  seed: Record<string, string> = {}
): AttributionStorage & {
  dump(): Record<string, string>;
} {
  const map = { ...seed };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
    dump: () => ({ ...map }),
  };
}

// ── GA4 client_id 파싱 ───────────────────────────────────────────────────────

test("parseGaClientId: _ga 쿠키에서 client_id(=user_pseudo_id) 를 뽑는다", () => {
  assert.equal(
    parseGaClientId("_ga=GA1.1.1234567890.1699999999"),
    "1234567890.1699999999"
  );
});

test("parseGaClientId: 다른 쿠키들 사이에서도 _ga 만 정확히 고른다", () => {
  const cookie =
    "foo=bar; _ga_ABCDEF=GS1.1.9.9.9; _ga=GA1.2.111.222; locale=ko";
  assert.equal(parseGaClientId(cookie), "111.222");
});

test("parseGaClientId: _ga_<streamId> 를 _ga 로 오인하지 않는다", () => {
  // 접두 일치로 자르면 GS1 세션 쿠키를 client_id 로 착각한다.
  assert.equal(
    parseGaClientId("_ga_XYZ=GS1.1.1700000000.1.0.1700000000.0"),
    null
  );
});

test("parseGaClientId: 쿠키 없음/형식 불일치 → null (지어내지 않는다)", () => {
  assert.equal(parseGaClientId(""), null);
  assert.equal(parseGaClientId("_ga=broken"), null);
  assert.equal(parseGaClientId("_ga=GA1.1.abc.def"), null);
});

// ── first-touch 캡처 ─────────────────────────────────────────────────────────

test("deriveFirstTouch: utm + referrer 호스트 + 랜딩 경로만 남긴다", () => {
  const ft = deriveFirstTouch(
    "https://marblo.app/ko/download?utm_source=youtube&utm_medium=video&utm_campaign=ep12&email=a@b.com",
    "https://www.youtube.com/watch?v=secret&list=private",
    1000
  );
  assert.equal(ft.utmSource, "youtube");
  assert.equal(ft.utmMedium, "video");
  assert.equal(ft.utmCampaign, "ep12");
  // referrer 는 호스트명만 — 경로/쿼리(=PII 위험)는 버린다.
  assert.equal(ft.referrerHost, "www.youtube.com");
  // 랜딩은 경로만 — 쿼리스트링(email=...)이 절대 실리면 안 된다.
  assert.equal(ft.landingPath, "/ko/download");
  assert.equal(ft.capturedAt, 1000);
});

test("deriveFirstTouch: utm/referrer 가 없으면 빈 문자열 (direct 유입)", () => {
  const ft = deriveFirstTouch("https://marblo.app/", "", 5);
  assert.equal(ft.utmSource, "");
  assert.equal(ft.referrerHost, "");
  assert.equal(ft.landingPath, "/");
});

test("captureFirstTouchInto: 첫 방문만 저장하고 이후 방문은 덮어쓰지 않는다", () => {
  const storage = memoryStorage();
  const first = captureFirstTouchInto(
    storage,
    "https://marblo.app/?utm_source=youtube",
    "",
    1
  );
  assert.equal(first?.utmSource, "youtube");

  // 두 번째 방문 — 다른 채널로 들어와도 first-touch 는 유지돼야 한다.
  const second = captureFirstTouchInto(
    storage,
    "https://marblo.app/?utm_source=threads",
    "https://l.threads.com/x",
    2
  );
  assert.equal(second?.utmSource, "youtube", "first-touch 가 덮어써졌다");
  assert.equal(second?.capturedAt, 1);
  assert.equal(
    JSON.parse(storage.dump()[FIRST_TOUCH_STORAGE_KEY]).utmSource,
    "youtube"
  );
});

test("captureFirstTouchInto: 스토리지가 던지면 null 로 조용히 포기한다", () => {
  const broken: AttributionStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(
    captureFirstTouchInto(broken, "https://marblo.app/", "", 1),
    null
  );
});

test("parseFirstTouch: 깨진 JSON/형태는 null", () => {
  assert.equal(parseFirstTouch("{"), null);
  assert.equal(parseFirstTouch("null"), null);
});

// ── 위생 ─────────────────────────────────────────────────────────────────────

test("sanitizeField: 제어문자 제거 + 100자 절단", () => {
  assert.equal(sanitizeField("a\u0000b\u001Fc"), "abc");
  assert.equal(sanitizeField("x".repeat(200)).length, 100);
  assert.equal(sanitizeField(undefined), "");
  assert.equal(sanitizeField(42), "");
});

test("sanitizeInstallId: UUID 만 통과, 'anon' 과 임의 문자열은 거부", () => {
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  assert.equal(sanitizeInstallId(uuid), uuid);
  assert.equal(sanitizeInstallId(uuid.toUpperCase()), uuid);
  // 스토리지를 못 쓰는 설치의 폴백값 — 모든 설치가 공유하므로 조인키가 못 된다.
  assert.equal(sanitizeInstallId("anon"), null);
  assert.equal(sanitizeInstallId("'; DROP TABLE events--"), null);
  assert.equal(sanitizeInstallId(null), null);
});

// ── 링크백 페이로드 ──────────────────────────────────────────────────────────

test("buildLinkInstallPayload: 유효 installId 면 first-touch 를 실어 만든다", () => {
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const payload = buildLinkInstallPayload({
    installId: uuid,
    gaClientId: "111.222",
    firstTouch: {
      utmSource: "youtube",
      utmMedium: "video",
      utmCampaign: "ep12",
      referrerHost: "www.youtube.com",
      landingPath: "/ko",
      capturedAt: 1,
    },
    platform: "darwin",
    appVersion: "3.0.22",
    buildChannel: "prod",
  });
  assert.deepEqual(payload, {
    installId: uuid,
    gaClientId: "111.222",
    utmSource: "youtube",
    utmMedium: "video",
    utmCampaign: "ep12",
    referrerHost: "www.youtube.com",
    landingPath: "/ko",
    platform: "darwin",
    appVersion: "3.0.22",
    buildChannel: "prod",
  });
});

test("sanitizeBuildChannel: dev/prod 만 통과, 나머지는 null", () => {
  assert.equal(sanitizeBuildChannel("dev"), "dev");
  assert.equal(sanitizeBuildChannel("prod"), "prod");
  assert.equal(sanitizeBuildChannel(" PROD "), "prod");
  assert.equal(sanitizeBuildChannel("staging"), null);
  assert.equal(sanitizeBuildChannel(null), null);
  assert.equal(sanitizeBuildChannel(undefined), null);
});

test("buildLinkInstallPayload: 표식 없는 구버전 앱 링크도 그대로 만든다", () => {
  // `?c=` 를 안 보내는 앱의 유입을 잃으면 안 된다 — null 로 접고 통과시킨다.
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const payload = buildLinkInstallPayload({
    installId: uuid,
    gaClientId: null,
    firstTouch: null,
    platform: "darwin",
    appVersion: "3.0.22",
  });
  assert.equal(payload?.buildChannel, null);
});

test("buildLinkInstallPayload: GA4 client_id 가 없어도(광고차단) 페이로드는 만든다", () => {
  const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const payload = buildLinkInstallPayload({
    installId: uuid,
    gaClientId: null,
    firstTouch: null,
    platform: "win32",
    appVersion: "3.0.22",
  });
  assert.equal(payload?.gaClientId, null);
  assert.equal(payload?.utmSource, "");
});

test("buildLinkInstallPayload: installId 가 쓰레기면 null → 전송 안 함", () => {
  assert.equal(
    buildLinkInstallPayload({
      installId: "not-a-uuid",
      gaClientId: "1.2",
      firstTouch: null,
      platform: "darwin",
      appVersion: "3.0.22",
    }),
    null
  );
});

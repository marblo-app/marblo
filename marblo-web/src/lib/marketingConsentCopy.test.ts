/**
 * ★마케팅 동의 문구가 확정안(§8-2)과 **글자 그대로** 같은가.
 *
 * 근거: `docs/marketing-hashed-email-ads-targeting-2026-09-07.md` §8-2 —
 * 사장님이 (나)안으로 확정하고 법무 검토에 올라갈 문장이다. 임의 개작 금지.
 * 이 파일은 그 문장을 상수로 박아 두고 사전과 대조한다 — 누가 "조금 다듬는"
 * 순간 빨개진다.
 *
 * 그리고 §8-3 의 PIPA 제17조 5항목이 실제로 문구 안에 있는지 본다.
 * 표에 체크가 있는 것과 화면 문자열에 있는 것은 다른 명제다.
 *
 * ★en·ja 는 §8-2 가 한국어로만 확정했으므로 **글자 대조가 아니라 요건 대조**만
 *   한다. 번역문은 법무 검토 대상이 아직 아니다 — 그 사실을 숨기지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ko from "../../messages/ko.json";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";

/** §8-2 (나)안 최종 문구 — 문서의 diff 블록을 그대로 옮긴 것. */
const KO_LABEL_8_2 = "[선택] 마케팅·광고성 정보 수신 및 광고 활용 동의";
const KO_HINT_8_2 =
  "신규 기능·혜택·이벤트 소식을 이메일로 받아보고, 이메일 주소를 SHA-256으로 " +
  "해시 처리한 값을 Google LLC(Google Ads, 미국 소재)에 제공해 맞춤형 광고에 " +
  "활용하는 데 동의합니다. 원본 이메일은 제공되지 않으며, 최대 540일간 유지되고 " +
  "동의를 철회하면 다음 갱신 주기에 제외됩니다. 거부해도 서비스 이용에 제한이 없습니다.";

test("★ko 라벨이 §8-2 와 글자 그대로 같다", () => {
  assert.equal(ko.consent.marketing_label, KO_LABEL_8_2);
});

test("★ko 본문이 §8-2 와 글자 그대로 같다", () => {
  assert.equal(ko.consent.marketing_hint, KO_HINT_8_2);
});

test("★구 문구가 남아 있지 않다 — 개정 전 문장이 어디에도 없어야 한다", () => {
  const OLD_HINT =
    "신규 기능·혜택·이벤트 소식을 이메일로 받아봅니다. 거부해도 서비스 이용에 제한이 없습니다.";
  for (const [locale, dict] of [
    ["ko", ko],
    ["en", en],
    ["ja", ja],
  ] as const) {
    const c = dict.consent as Record<string, string>;
    for (const key of ["marketing_hint", "settings_marketing_desc"]) {
      assert.notEqual(c[key], OLD_HINT, `${locale}.${key} 가 구 문구다`);
    }
  }
});

// ── §8-3 PIPA 제17조 5항목이 문구에 실제로 있는가 ──────────────────────────
//
// ★"표에 체크가 있다" 와 "화면 문자열에 있다" 는 다른 명제다. 후자를 본다.
const PIPA_ITEMS: Array<{
  item: string;
  needles: { ko: string[]; en: string[]; ja: string[] };
}> = [
  {
    item: "제공받는 자",
    needles: {
      ko: ["Google LLC", "미국 소재"],
      en: ["Google LLC", "United States"],
      ja: ["Google LLC", "米国"],
    },
  },
  {
    item: "이용 목적",
    needles: {
      ko: ["맞춤형 광고"],
      en: ["personalized advertising"],
      ja: ["パーソナライズド広告"],
    },
  },
  {
    item: "제공 항목",
    needles: { ko: ["SHA-256"], en: ["SHA-256"], ja: ["SHA-256"] },
  },
  {
    item: "보유·이용 기간",
    needles: { ko: ["540일"], en: ["540 days"], ja: ["540日"] },
  },
  {
    item: "거부권과 그 불이익",
    needles: {
      ko: ["거부해도"],
      en: ["Declining does not"],
      ja: ["拒否しても"],
    },
  },
];

for (const [locale, dict] of [
  ["ko", ko],
  ["en", en],
  ["ja", ja],
] as const) {
  for (const { item, needles } of PIPA_ITEMS) {
    test(`[${locale}] PIPA 제17조 — ${item} 이 동의 문구에 있다`, () => {
      const text =
        (dict.consent as Record<string, string>).marketing_label +
        " " +
        (dict.consent as Record<string, string>).marketing_hint;
      for (const needle of needles[locale]) {
        assert.ok(
          text.includes(needle),
          `${locale} 문구에 "${needle}" 이 없다 (${item})`,
        );
      }
    });
  }

  test(`[${locale}] ★원본 이메일을 제공하지 않는다는 부연이 있다`, () => {
    const hint = (dict.consent as Record<string, string>).marketing_hint;
    const needle = {
      ko: "원본 이메일",
      en: "original email",
      ja: "元のメール",
    }[locale];
    assert.ok(hint.includes(needle), `${locale} 에 원본 미제공 부연이 없다`);
  });
}

// ── 수집 지점마다 같은 문구를 보는가 ────────────────────────────────────────
//
// ★/my/privacy 설정 토글도 마케팅 동의를 **부여**하는 자리다. 거기 설명이
//   구 문구면 "구글 제공 고지를 못 본 채 새 버전 동의"가 만들어진다.
//   그래서 확정 문구를 그 자리에도 쓴다(새 문장을 짓지 않는다).
for (const [locale, dict] of [
  ["ko", ko],
  ["en", en],
  ["ja", ja],
] as const) {
  test(`[${locale}] ★설정 토글 설명이 동의 폼과 같은 확정 문구다`, () => {
    const c = dict.consent as Record<string, string>;
    assert.equal(
      c.settings_marketing_desc,
      c.marketing_hint,
      "설정 화면이 동의 폼과 다른 문구를 보여준다 — 그 경로로 켠 사람은 다른 것을 읽고 동의한 것이 된다",
    );
  });
}

// ── 화면에서 접두사가 두 번 나오지 않는가 ──────────────────────────────────
//
// ★문자열 대조만으로는 못 잡은 버그가 실제로 있었다: 컴포넌트가 `optional_badge`
//   ("[선택]")를 앞에 붙이는데 §8-2 확정 라벨도 "[선택]" 으로 시작해서, 화면에
//   "[선택] [선택] 마케팅…" 으로 두 번 나왔다. 사전은 §8-2 와 글자 그대로
//   같았으므로 위 테스트들은 전부 초록이었다. 그래서 이 축을 따로 박는다.
test("★확정 라벨이 선택 배지를 이미 포함한다 — 컴포넌트가 또 붙이면 안 된다", () => {
  for (const [locale, dict] of [
    ["ko", ko],
    ["en", en],
    ["ja", ja],
  ] as const) {
    const c = dict.consent as Record<string, string>;
    assert.ok(
      c.marketing_label.startsWith(c.optional_badge),
      `${locale}: 라벨이 optional_badge 로 시작하지 않는다`,
    );
  }
});

test("★마케팅 행이 optional_badge 를 따로 그리지 않는다 (중복 방지)", () => {
  const src = readFileSync(
    join(__dirname, "..", "components", "PrivacyConsentFields.tsx"),
    "utf8",
  );
  const marker = "marketing_label";
  const idx = src.indexOf(marker);
  assert.ok(idx > 0, "marketing_label 렌더 위치를 못 찾았다");
  // 마케팅 라벨 바로 앞 400자 안에 optional_badge 렌더가 있으면 중복이다.
  const before = src.slice(Math.max(0, idx - 400), idx);
  assert.ok(
    !/\{t\("optional_badge"\)\}/.test(before),
    '마케팅 라벨 앞에 optional_badge 를 또 그린다 — 화면에 "[선택] [선택] …" 로 나온다',
  );
});

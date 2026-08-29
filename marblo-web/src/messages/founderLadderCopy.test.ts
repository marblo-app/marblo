/**
 * 파운더 계단 문구가 ko·en·ja 에서 **같은 약속**을 하는지 검사한다.
 *
 * ─── 왜 이 테스트가 필요한가 ────────────────────────────────────────
 * 계단 값(베타 3 · 설문 총 5 · 인터뷰 총 9)이 바뀔 때 ko 만 고치고 en·ja 를
 * 두면 언어별로 **다른 계약**을 하게 된다. 사람이 3개 파일 × 16개 키를 눈으로
 * 맞추는 건 반복 가능한 검증이 아니다. 숫자를 뽑아 세 언어를 대조한다.
 *
 * ─── 왜 결제 고지를 따로 지키는가 ───────────────────────────────────
 * `checkout.monthlyServicePeriodNotice` / `pricing.servicePeriod.monthly` 의
 * "1개월"은 **유료 구독 주기**(결제일로부터 1개월)이지 베타 기간이 아니다.
 * 베타 문구를 일괄 치환하다 여기까지 건드리면 전자상거래 고지 오류가 된다.
 * 그래서 "건드리면 안 되는 값"으로 명시적으로 못 박는다.
 *
 * 의존성 0(node: 빌트인 + fs) — messages/*.json 만 읽는다.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const LOCALES = ["ko", "en", "ja"] as const;
type Locale = typeof LOCALES[number];

type Messages = Record<string, Record<string, string>>;

const MESSAGES_DIR = path.join(process.cwd(), "messages");

function load(locale: Locale): Messages {
  return JSON.parse(
    readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8")
  ) as Messages;
}

const M: Record<Locale, Messages> = {
  ko: load("ko"),
  en: load("en"),
  ja: load("ja"),
};

/** 계단(기간)을 약속하는 문구 키. 새 문구가 생기면 여기에 추가한다. */
const LADDER_KEYS: Array<[string, string]> = [
  ["promoBar", "message"],
  ["founderSurveyPrompt", "title"],
  ["founderSurveyPrompt", "body"],
  ["founderSurveyPrompt", "note"],
  ["foundation50", "benefit2_title"],
  ["foundation50", "benefit2_body"],
  ["foundation50", "ob1_body"],
  ["foundation50", "ob2_body"],
  ["foundation50", "schedule_note"],
  ["foundation50Faq", "q3_body"],
  ["betatester50", "receive_item2"],
  ["betatester50", "role_required"],
  ["betatester50", "role_optional"],
  ["betaSurvey", "intro"],
  ["betaSurvey", "foot_note"],
  ["betaSurvey", "success_body"],
];

/** ko "3개월" · ja "3ヶ月/3か月" · en "3 months / 3-month" 를 모두 잡는다. */
const MONTHS = /(\d+)\s*(?:개월|ヶ月|か月|-?\s*months?\b)/g;

function monthsIn(text: string): number[] {
  return [...new Set([...text.matchAll(MONTHS)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b
  );
}

test("ko·en·ja 문구가 같은 계단 숫자를 약속한다", () => {
  for (const [section, key] of LADDER_KEYS) {
    const seen = LOCALES.map((l) => monthsIn(M[l][section][key]));
    assert.deepEqual(
      seen[1],
      seen[0],
      `${section}.${key}: en 이 ko 와 다른 기간을 약속한다 (ko=${seen[0]}, en=${seen[1]})`
    );
    assert.deepEqual(
      seen[2],
      seen[0],
      `${section}.${key}: ja 가 ko 와 다른 기간을 약속한다 (ko=${seen[0]}, ja=${seen[2]})`
    );
  }
});

test("★계단 문구에 구(舊) 값(1개월 베타 · 총 6개월)이 남아 있지 않다", () => {
  for (const [section, key] of LADDER_KEYS) {
    for (const locale of LOCALES) {
      const stale = monthsIn(M[locale][section][key]).filter(
        (n) => n === 1 || n === 6
      );
      assert.deepEqual(
        stale,
        [],
        `${locale} ${section}.${key}: 구 계단 값 ${stale} 이 남아 있다 ` +
          "(베타 1개월 / 총 6개월)"
      );
    }
  }
});

test("계단은 3 → 5 → 9 다 — 핵심 문구가 그 숫자를 담고 있다", () => {
  // 배너는 베타(3)와 설문 보상(5)을, 혜택 제목은 최대치(9)를 말해야 한다.
  for (const locale of LOCALES) {
    const promo = monthsIn(M[locale].promoBar.message);
    assert.deepEqual(
      promo,
      [3, 5],
      `${locale} promoBar.message 가 베타 3 · 설문 총 5 를 말하지 않는다`
    );
    assert.deepEqual(
      monthsIn(M[locale].foundation50.benefit2_title),
      [9],
      `${locale} foundation50.benefit2_title 이 최대 9개월을 말하지 않는다`
    );
  }
});

test("★결제 고지는 베타 기간이 아니다 — 유료 구독 주기 1개월을 유지한다", () => {
  // 여기가 바뀌면 전자상거래 고지 오류다. 베타 문구 갱신의 부수효과로
  // 절대 끌려가면 안 되는 값이라 명시적으로 고정한다.
  const expected: Record<Locale, string> = {
    ko: "1개월",
    en: "1 month",
    ja: "1か月",
  };
  for (const locale of LOCALES) {
    assert.ok(
      M[locale].checkout.monthlyServicePeriodNotice.includes(expected[locale]),
      `${locale} checkout.monthlyServicePeriodNotice 의 결제 주기(${expected[locale]})가 바뀌었다`
    );
    const pricing = M[locale].pricing as unknown as {
      servicePeriod: Record<string, string>;
    };
    assert.ok(
      pricing.servicePeriod.monthly.includes(expected[locale]),
      `${locale} pricing.servicePeriod.monthly 의 결제 주기(${expected[locale]})가 바뀌었다`
    );
  }
});

test("세 언어의 메시지 키 집합이 동일하다", () => {
  const flatten = (obj: unknown, prefix = ""): string[] => {
    if (typeof obj !== "object" || obj === null) return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}.${k}` : k)
    );
  };
  const ko = new Set(flatten(M.ko));
  for (const locale of ["en", "ja"] as const) {
    const other = new Set(flatten(M[locale]));
    const missing = [...ko].filter((k) => !other.has(k));
    const extra = [...other].filter((k) => !ko.has(k));
    assert.deepEqual(
      missing,
      [],
      `${locale} 에 없는 키: ${missing.slice(0, 5)}`
    );
    assert.deepEqual(extra, [], `${locale} 에만 있는 키: ${extra.slice(0, 5)}`);
  }
});

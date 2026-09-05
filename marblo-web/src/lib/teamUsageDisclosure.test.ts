/**
 * 팀 요금제 열람 고지 문면 — 이 화면의 완료 기준은 문구다.
 *
 * ★이 파일이 막는 결함(실측 2026-09-01, 판정 티켓 BGs6nu60acllBmeKxOXl):
 *   방침 페이지 본문이 통째로 하드코딩 한국어라 /en 으로 들어온 독자에게
 *   한국어가 나갔다 — 영문 4요소가 0/4 였다. 증상이 '에러'가 아니라 '읽을 수
 *   없는 문자열'이라 타입체크·빌드로는 절대 안 잡힌다. 그래서 문구로 검사한다.
 *
 * 검사 축 넷(누가 · 무엇을 · 무엇은 아닌지 · 언제부터)은 이용약관 제13조가
 * 방침을 직접 인용해 구속하는 고지 요건이라, 하나라도 빠지면 발효할 수 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disclosureText,
  PRIVACY_LAST_UPDATED,
  TEAM_USAGE_EFFECTIVE_FROM,
  teamUsageDisclosureFor,
} from "./teamUsageDisclosure";

/** 사이트가 실제로 서비스하는 로케일 전부(i18n/routing.ts 와 같은 집합). */
const SERVED_LOCALES = ["ko", "en", "ja"] as const;

/** 한글 음절·자모. 영문 독자에게 한국어가 나가는 것을 잡는 유일한 신호다. */
const HANGUL = /[ㄱ-ㆎ가-힣]/;

/**
 * 로케일별 4요소 매처. ★뜻이 아니라 **문면**을 검사한다 — 번역이 요소를
 * 통째로 빠뜨리면(예: "무엇은 아닌지" 문장 삭제) 여기서 깨진다.
 */
const ELEMENT_MATCHERS: Record<
  "ko" | "en",
  Record<"who" | "what" | "notIncluded" | "effectiveFrom", readonly RegExp[]>
> = {
  ko: {
    // 누가 — 프로젝트 관리자 + 조직 관리자 둘 다 적혀야 한다.
    who: [/프로젝트의 관리자/, /조직의 관리자/],
    // 무엇을 — 토큰·추정비용·작업수 셋.
    what: [/토큰/, /비용/, /작업\s*수/],
    // 무엇은 아닌지 — 원문 제외를 명시.
    notIncluded: [/코드·프롬프트·응답 원문은 포함되지 않으며/],
    // 언제부터.
    effectiveFrom: [new RegExp(TEAM_USAGE_EFFECTIVE_FROM)],
  },
  en: {
    who: [
      /administrator of the\s+project/i,
      /administrator of the organization/i,
    ],
    what: [/tokens per model/i, /estimated usage-based cost/i, /failed tasks/i],
    notIncluded: [/never included/i],
    effectiveFrom: [new RegExp(TEAM_USAGE_EFFECTIVE_FROM)],
  },
};

/** ja 는 승인된 일본어 법률 문면이 없어 영문 고지를 준다(모듈 주석 참조). */
const EXPECTED_VARIANT: Record<typeof SERVED_LOCALES[number], "ko" | "en"> = {
  ko: "ko",
  en: "en",
  ja: "en",
};

test("★서비스하는 세 로케일 전부 4요소가 실재한다 — 하나라도 빠지면 발효 불가", () => {
  for (const locale of SERVED_LOCALES) {
    const copy = teamUsageDisclosureFor(locale);
    const text = disclosureText(copy.body);
    const matchers = ELEMENT_MATCHERS[EXPECTED_VARIANT[locale]];

    for (const [element, patterns] of Object.entries(matchers)) {
      for (const pattern of patterns) {
        assert.match(
          text,
          pattern,
          `[${locale}] 고지에서 '${element}' 요소가 빠졌다 (${pattern})`
        );
      }
    }
  }
});

test("★/en 독자에게 한국어가 나가지 않는다 — 원래 결함이 바로 이것이었다", () => {
  // ko 는 당연히 한글이다. en·ja 는 한 글자도 있으면 안 된다.
  for (const locale of ["en", "ja"] as const) {
    const copy = teamUsageDisclosureFor(locale);
    const body = disclosureText(copy.body);
    const effective = disclosureText(copy.effective);

    assert.ok(
      !HANGUL.test(body),
      `[${locale}] 고지 본문에 한국어가 섞였다 — 영문 독자가 읽을 수 없다`
    );
    assert.ok(
      !HANGUL.test(effective),
      `[${locale}] 시행일 문장에 한국어가 섞였다`
    );
  }

  // 반대 방향도 고정한다 — ko 가 영문으로 바뀌면 그것도 결함이다.
  assert.ok(HANGUL.test(disclosureText(teamUsageDisclosureFor("ko").body)));
});

test("시행일 문장이 세 로케일 전부에서 발효일과 개정일을 말한다", () => {
  for (const locale of SERVED_LOCALES) {
    const effective = disclosureText(teamUsageDisclosureFor(locale).effective);
    assert.match(
      effective,
      new RegExp(TEAM_USAGE_EFFECTIVE_FROM),
      `[${locale}] 시행일 문장에 발효일이 없다`
    );
    assert.match(
      effective,
      new RegExp(PRIVACY_LAST_UPDATED),
      `[${locale}] 시행일 문장에 개정일이 없다`
    );
  }
});

test("★발효일은 2026-09-07 이다 — 방침이 약속한 날짜와 게이트가 같은 값을 본다", () => {
  // v3/functions 의 TEAM_USAGE_EFFECTIVE_FROM 게이트가 BQ 창을
  // `day >= @fromDay` 로 자르는 그 날짜다. 문면과 게이트가 갈리면 방침 위반.
  assert.equal(TEAM_USAGE_EFFECTIVE_FROM, "2026-09-07");
});

test("알 수 없는 로케일도 고지를 받는다(빈 문자열로 조용히 새지 않는다)", () => {
  const text = disclosureText(teamUsageDisclosureFor("de").body);
  assert.ok(text.length > 0);
  assert.match(text, new RegExp(TEAM_USAGE_EFFECTIVE_FROM));
});

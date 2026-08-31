/**
 * 문구 규약 — 이 화면들의 완료 기준 절반은 문구다:
 *   1. ★에러 4종(만료·위조/취소·다른 계정·이미 수락)이 **각각 다른 안내**를
 *      준다. "오류가 발생했습니다" 로 뭉치지 않는다.
 *   2. 각 안내는 "무엇을 해야 하는지" 를 사람 말로 담는다(행동 어휘 검사).
 *   3. ko·en·ja 세 벌 전부 완결 — 영어 폴백으로 조용히 떨어지지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ko from "../../messages/ko.json";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";
import {
  buildOrgOnboardingCopy,
  formatCopy,
  missingOrgOnboardingCopyKeys,
  type OrgOnboardingCopy,
} from "./orgOnboardingCopy";

const LOCALES: Array<{ locale: string; raw: unknown }> = [
  { locale: "ko", raw: (ko as Record<string, unknown>).orgOnboarding },
  { locale: "en", raw: (en as Record<string, unknown>).orgOnboarding },
  { locale: "ja", raw: (ja as Record<string, unknown>).orgOnboarding },
];

test("세 로케일 전부 완결 — 폴백으로 떨어지는 키 0", () => {
  for (const { locale, raw } of LOCALES) {
    assert.deepEqual(
      missingOrgOnboardingCopyKeys(raw),
      [],
      `${locale} 에 빠진 키`
    );
  }
});

function fourErrorGuides(copy: OrgOnboardingCopy) {
  return {
    expired: copy["join.expired.title"] + copy["join.expired.body"],
    invalid: copy["join.invalid.title"] + copy["join.invalid.body"],
    wrongAccount:
      copy["join.wrongAccount.title"] + copy["join.wrongAccount.body"],
    already: copy["join.already.title"] + copy["join.already.body"],
  };
}

test("★에러 4종의 안내가 로케일마다 전부 서로 다르다", () => {
  for (const { locale, raw } of LOCALES) {
    const guides = Object.values(fourErrorGuides(buildOrgOnboardingCopy(raw)));
    assert.equal(new Set(guides).size, 4, `${locale}: 4종 안내가 뭉쳐 있다`);
  }
});

test("★어느 안내도 '오류가 발생했습니다' 류의 뭉뚱그림이 아니다", () => {
  const generic = [/오류가 발생/, /エラーが発生/, /an error (has )?occurred/i];
  for (const { locale, raw } of LOCALES) {
    const copy = buildOrgOnboardingCopy(raw);
    for (const [kind, text] of Object.entries(fourErrorGuides(copy))) {
      for (const re of generic) {
        assert.ok(!re.test(text), `${locale}/${kind}: 뭉뚱그린 문구 (${text})`);
      }
    }
  }
});

test("각 안내가 다음 행동을 담는다 — 만료·위조는 '새 링크 요청', 다른 계정은 '로그인'", () => {
  const ask: Record<string, RegExp> = {
    ko: /요청|로그인/,
    en: /ask|sign in/i,
    ja: /依頼|ログイン/,
  };
  for (const { locale, raw } of LOCALES) {
    const copy = buildOrgOnboardingCopy(raw);
    for (const key of [
      "join.expired.body",
      "join.invalid.body",
      "join.wrongAccount.body",
    ] as const) {
      assert.match(copy[key], ask[locale], `${locale}/${key}`);
    }
  }
});

test("intake unavailable 안내는 결제가 유효함을 함께 말한다(#1338 (b) 재진입)", () => {
  const payment: Record<string, RegExp> = {
    ko: /결제/,
    en: /payment/i,
    ja: /決済/,
  };
  for (const { locale, raw } of LOCALES) {
    const copy = buildOrgOnboardingCopy(raw);
    assert.match(copy["intake.err.unavailable"], payment[locale], locale);
  }
});

test("buildOrgOnboardingCopy 는 어떤 입력에도 던지지 않고 영어로 채운다", () => {
  const copy = buildOrgOnboardingCopy(undefined);
  assert.equal(typeof copy["join.expired.title"], "string");
  assert.ok(copy["join.expired.title"].length > 0);
});

test("formatCopy: 자리 치환 — 없는 파라미터는 자리 그대로(조용한 빈칸 방지)", () => {
  assert.equal(
    formatCopy("{org} 팀 초대", { org: "하이프마크" }),
    "하이프마크 팀 초대"
  );
  assert.equal(formatCopy("{org} 팀 초대", {}), "{org} 팀 초대");
});

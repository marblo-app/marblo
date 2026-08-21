/**
 * 판매자 귀책 환불 기간 회귀 방지 — 토스페이 3차 반려 재발 차단.
 *
 * 반려 사유: 판매자 귀책(전자상거래법 제17조 제3항) 환불을 "사유 발생일부터
 * 7일 이내" 로 안내해 법정 기준(공급받은 날부터 3개월 / 안 날부터 30일)보다
 * 이용자 권리를 좁게 잡았다.
 *
 * 두 가지를 동시에 지킨다.
 *  (1) 귀책 조항이 다시 7일로 좁아지지 않는다 — 문서 넷 전부.
 *  (2) 단순 변심 청약철회 7일(제17조 제1항)은 지워지지 않는다 — 반대 방향
 *      규제 위반이 되므로 존재 자체를 못 박는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

/** JSX 줄바꿈은 렌더 시 공백 한 칸으로 접힌다. 문장 단위 검사를 위해 동일하게 접는다. */
const flatten = (source: string) => source.replace(/\s+/g, " ");

const REFUND_PAGE = "src/app/[locale]/legal/refund/page.tsx";
const TERMS_PAGE = "src/app/[locale]/legal/terms/page.tsx";
const NOTICE_PAGE = "src/app/[locale]/notice/page.tsx";

/** 귀책 환불 기간을 말하는 모든 사용자 노출 문서. 하나라도 어긋나면 문서 간 모순이다. */
const SELLER_FAULT_DOCS = [REFUND_PAGE, TERMS_PAGE, NOTICE_PAGE];

test("판매자 귀책 환불은 법정 기간(30일 / 3개월)을 안내한다", () => {
  for (const doc of SELLER_FAULT_DOCS) {
    const text = flatten(read(doc));
    assert.ok(
      text.includes("제17조 제3항"),
      `${doc}: 귀책 환불의 근거 조항(제17조 제3항) 명시가 사라졌다`,
    );
    assert.ok(
      /안 날 또는 알 수 있었던 날부터 30일 이내/.test(text),
      `${doc}: "안 날부터 30일" 기준이 사라졌다`,
    );
    assert.ok(
      /공급받은 날부터 3개월 이내/.test(text),
      `${doc}: "공급받은 날부터 3개월" 기준이 사라졌다`,
    );
  }
});

test("판매자 귀책 환불을 7일로 좁히지 않는다", () => {
  const narrowing = [
    /사유가 발생한 날부터[^.]{0,20}7일/,
    /사유 발생일부터[^.]{0,20}7일/,
  ];
  for (const doc of SELLER_FAULT_DOCS) {
    const text = flatten(read(doc));
    for (const pattern of narrowing) {
      assert.ok(
        !pattern.test(text),
        `${doc}: 귀책 환불이 다시 7일로 좁혀졌다 (${pattern})`,
      );
    }
  }
});

test("단순 변심 청약철회 7일(제17조 제1항)은 그대로 남아 있다", () => {
  const text = flatten(read(REFUND_PAGE));
  const sevenDay = text.match(/나중에 도래하는 날로부터 7일/g) ?? [];
  // 2-1 강의 청약철회 본문 / 3-1 구독 청약철회 제목·본문 = 3곳
  assert.equal(
    sevenDay.length,
    3,
    "제17조 제1항 청약철회 7일 문구가 변경·삭제됐다",
  );
  assert.ok(text.includes("전자상거래법 제17조 제1항"));
});

test("제1항 우선 적용(진도율·다운로드·경과기간 무관 전액환불)이 유지된다", () => {
  const text = flatten(read(REFUND_PAGE));
  assert.ok(text.includes("우선하여 적용됩니다"));
  assert.ok(text.includes("경과 기간에 관계없이"));
  assert.ok(text.includes("전액 환불"));
});

test("강의 상세 환불 요약(ko/en/ja)도 같은 기간을 말한다", () => {
  const expectations: Record<string, RegExp[]> = {
    ko: [/30일 이내/, /3개월 이내/],
    en: [/within 30 days/, /within 3 months/],
    ja: [/30日以内/, /3か月以内/],
  };
  for (const [locale, patterns] of Object.entries(expectations)) {
    const messages = JSON.parse(read(`messages/${locale}.json`)) as {
      lectures?: Record<string, string>;
    };
    const refundBody = messages.lectures?.refundBody;
    assert.ok(refundBody, `messages/${locale}.json: refundBody 가 없다`);
    for (const pattern of patterns) {
      assert.ok(
        pattern.test(refundBody),
        `messages/${locale}.json refundBody: ${pattern} 누락 — 문서 간 모순`,
      );
    }
    assert.ok(
      !/(사유 발생일|事由発生日|within 7 days of the issue)/.test(refundBody),
      `messages/${locale}.json refundBody: 귀책 환불이 다시 7일로 좁혀졌다`,
    );
  }
});

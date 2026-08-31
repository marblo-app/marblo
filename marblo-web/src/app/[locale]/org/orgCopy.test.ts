/**
 * 조직 문구 사전 테스트 — 로케일 세 벌이 전부 완결돼 있는지 본다
 * (`teamCopy.test.ts` 와 같은 규약. CI 가 죽어 있으므로 이 테스트가 그 자리를
 * 대신한다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { ORG_COPY_KEYS, buildOrgCopy, missingOrgCopyKeys } from "./orgCopy";

const LOCALES: Array<[string, unknown]> = [
  ["ko", ko.org],
  ["en", en.org],
  ["ja", ja.org],
];

for (const [locale, block] of LOCALES) {
  test(`[${locale}] org 문구가 한 키도 빠지지 않는다`, () => {
    assert.deepEqual(missingOrgCopyKeys(block), []);
  });

  test(`[${locale}] 빈 문자열로 채워 놓은 키가 없다`, () => {
    const copy = buildOrgCopy(block);
    for (const key of ORG_COPY_KEYS) {
      assert.ok(copy.text[key].trim() !== "", `${key} 가 비어 있다`);
    }
  });
}

test("자리표시자가 세 로케일에서 같은 이름을 쓴다", () => {
  const placeholders = (s: string) =>
    (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
  const copies = LOCALES.map(([, block]) => buildOrgCopy(block));
  for (const key of ORG_COPY_KEYS) {
    const a = placeholders(copies[0].text[key]);
    assert.equal(placeholders(copies[1].text[key]), a, `${key} (en)`);
    assert.equal(placeholders(copies[2].text[key]), a, `${key} (ja)`);
  }
});

test("깨진 입력에도 폴백으로 완결된 사전이 나온다", () => {
  const bads: unknown[] = [undefined, null, 42, "nope", [], { org: {} }];
  for (const bad of bads) {
    const copy = buildOrgCopy(bad);
    for (const key of ORG_COPY_KEYS) {
      assert.ok(copy.text[key].trim() !== "", `${key} (input=${String(bad)})`);
    }
  }
});

// ── ★구현 어휘 검사 — teamCopy 스캐너의 축약판 ─────────────────────────────
//
// 이 화면을 읽는 사람은 조직 관리자·구성원이지 엔지니어가 아니다. ko·ja 문장에
// 구현 어휘(서버·콜러블…)와 라틴 낱말이 섞이면 실패한다(fail-closed).

const CJK_IMPL_RE =
  /서버|클라이언트|콜러블|엔드포인트|스키마|쿼리|인덱스|캐시|サーバー|クライアント|エンドポイント|スキーマ|クエリ|インデックス|キャッシュ/;

function userFacingStrings(block: unknown, path = ""): Array<[string, string]> {
  if (typeof block === "string") return [[path, block]];
  if (Array.isArray(block)) {
    return block.flatMap((v, i) => userFacingStrings(v, `${path}[${i}]`));
  }
  if (block && typeof block === "object") {
    return Object.entries(block as Record<string, unknown>).flatMap(([k, v]) =>
      userFacingStrings(v, path ? `${path}.${k}` : k)
    );
  }
  return [];
}

for (const [locale, block] of LOCALES) {
  if (locale === "en") continue;
  test(`[${locale}] 사용자 문장에 구현 어휘·라틴 낱말이 없다`, () => {
    const hits: string[] = [];
    for (const [path, text] of userFacingStrings(block)) {
      if (CJK_IMPL_RE.test(text)) hits.push(`${path}: 구현 어휘`);
      const stripped = text.replace(/\{\w+\}/g, "");
      const latin = stripped.match(/[A-Za-z]{2,}/);
      if (latin) hits.push(`${path}: 라틴 낱말 "${latin[0]}"`);
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });
}

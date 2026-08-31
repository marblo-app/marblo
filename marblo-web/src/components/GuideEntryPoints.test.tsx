/**
 * (h) 가이드 진입점 — ★"새 가이드 페이지 신규 생성 0" 을 코드로 고정한다.
 * 진입점은 전부 기존 guide/ 앵커로의 딥링크여야 하고(앵커 유효성), guide/
 * 디렉터리에 새 라우트(하위 디렉터리)가 생기지 않아야 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../messages/ko.json";
import { GUIDE_ANCHOR_IDS, GUIDE_SECTION_IDS } from "@/lib/guideContent";
import { buildOrgOnboardingCopy } from "@/lib/orgOnboardingCopy";
import GuideEntryPoints, { GUIDE_ENTRY_POINTS } from "./GuideEntryPoints";

const copy = buildOrgOnboardingCopy(
  (ko as Record<string, unknown>).orgOnboarding
);

test("진입점은 정확히 3개다 — 역할별 문 3개(#1338 §6)", () => {
  assert.equal(GUIDE_ENTRY_POINTS.length, 3);
  assert.equal(new Set(GUIDE_ENTRY_POINTS.map((e) => e.id)).size, 3);
});

test("★모든 진입점 앵커가 기존 guide/ 의 실재 앵커다", () => {
  for (const entry of GUIDE_ENTRY_POINTS) {
    assert.ok(
      GUIDE_ANCHOR_IDS.includes(entry.anchor),
      `앵커 없음: #${entry.anchor}`
    );
    assert.ok(
      (GUIDE_SECTION_IDS as readonly string[]).includes(entry.anchor),
      `섹션 앵커가 아님: #${entry.anchor}`
    );
  }
});

test("★guide/ 디렉터리에 새 라우트(하위 디렉터리)가 없다 — 신규 가이드 페이지 0", () => {
  const guideDir = path.join(process.cwd(), "src", "app", "[locale]", "guide");
  const entries = fs.readdirSync(guideDir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  assert.deepEqual(subdirs, [], `guide/ 에 새 라우트가 생겼다: ${subdirs}`);
});

test("렌더: 카드 3장이 로케일 반영된 /guide 경로에 앵커를 붙인다", () => {
  const html = renderToStaticMarkup(
    <GuideEntryPoints copy={copy} guideHrefBase="/en/guide" />
  );
  for (const entry of GUIDE_ENTRY_POINTS) {
    assert.ok(
      html.includes(`href="/en/guide#${entry.anchor}"`),
      `링크 없음: /en/guide#${entry.anchor}`
    );
  }
  assert.ok(html.includes(copy["guideEntry.prepare.title"]));
  assert.ok(html.includes(copy["guideEntry.firstAgent.title"]));
  assert.ok(html.includes(copy["guideEntry.teamwork.title"]));
});

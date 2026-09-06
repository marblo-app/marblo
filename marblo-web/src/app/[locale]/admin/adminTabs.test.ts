/**
 * P0 가드 — /admin 첫 화면(티켓 8N56qvidQfcvdPPzf5wy).
 *
 * ★`/admin` 을 프로젝터에 띄우는 순간 청중이 보는 것이 첫 탭이다.
 * 대기자·파운더 현황·인터뷰 후보는 제3자의 이메일을 평문으로 렌더한다
 * (page.tsx:1014·1166·1330). 그 사람들은 동의한 적이 없다.
 *
 * 근거: docs/org-admin-look-and-feel-audit-2026-09-06.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_TABS,
  DEFAULT_ADMIN_TAB,
  PII_ADMIN_TABS,
  SAFE_ADMIN_TABS,
  type AdminTab,
} from "./adminTabs";

test("★첫 화면은 사업 분석이다", () => {
  assert.equal(DEFAULT_ADMIN_TAB, "analytics");
});

test("★기본 탭은 개인정보를 렌더하는 탭이 아니다", () => {
  assert.equal(
    PII_ADMIN_TABS.includes(DEFAULT_ADMIN_TAB),
    false,
    `기본 탭 "${DEFAULT_ADMIN_TAB}" 이 가입자 이메일을 평문으로 렌더한다`
  );
  assert.equal(SAFE_ADMIN_TABS.includes(DEFAULT_ADMIN_TAB), true);
});

test("★탭 배열 맨 앞 두 자리는 analytics·projects — 개인정보 탭이 앞자리를 못 가진다", () => {
  assert.deepEqual(
    ADMIN_TABS.slice(0, 2).map((t) => t.id),
    ["analytics", "projects"]
  );
});

test("★개인정보 탭 중 어느 것도 배열 첫 자리가 아니다", () => {
  assert.equal(
    PII_ADMIN_TABS.includes(ADMIN_TABS[0].id),
    false,
    `첫 탭 "${ADMIN_TABS[0].id}" 이 개인정보를 렌더한다`
  );
});

test("기본 탭은 실제로 존재하는 탭이다", () => {
  assert.ok(ADMIN_TABS.some((t) => t.id === DEFAULT_ADMIN_TAB));
});

test("탭 목록에 누락·중복이 없다 — 6개 전부 살아 있다", () => {
  const ids = ADMIN_TABS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "중복 탭");
  const expected: AdminTab[] = [
    "waitlist",
    "founders",
    "candidates",
    "bugs",
    "analytics",
    "projects",
  ];
  assert.deepEqual([...ids].sort(), [...expected].sort());
});

test("PII·SAFE 분류가 탭 전체를 빠짐없이 덮는다", () => {
  const classified = [...PII_ADMIN_TABS, ...SAFE_ADMIN_TABS].sort();
  const all = ADMIN_TABS.map((t) => t.id).sort();
  assert.deepEqual(classified, all, "분류되지 않은 탭이 있다");
});

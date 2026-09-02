/**
 * ★사장님 재현 경로의 핵심 분기: 로그인 상태면 /download, 비로그인이면
 *   /auth/signup, 확정 전(pending)엔 pending 플래그를 켠 채 signup 문구를
 *   두른다(HeroCtaView 가 이 플래그로 invisible 처리해 깜빡임을 막는다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHeroCta } from "./heroCtaLogic";

const LABELS = { signup: "무료 베타 시작하기", download: "다운로드" };

test("pending 은 signup 문구를 두르지만 pending 플래그로 표시된다", () => {
  const pending = resolveHeroCta("pending", "ko", LABELS);
  assert.equal(pending.href, "/auth/signup");
  assert.equal(pending.label, LABELS.signup);
  assert.equal(pending.pending, true);
});

test("anon 은 /auth/signup, authed 는 /download — ★원래 버그의 핵심 분기", () => {
  const anon = resolveHeroCta("anon", "ko", LABELS);
  assert.equal(anon.href, "/auth/signup");
  assert.equal(anon.label, LABELS.signup);
  assert.equal(anon.pending, false);

  const authed = resolveHeroCta("authed", "ko", LABELS);
  assert.equal(authed.href, "/download");
  assert.equal(authed.label, LABELS.download);
  assert.equal(authed.pending, false);
});

test("로케일 접두사를 그대로 보존한다(en/ja)", () => {
  assert.equal(resolveHeroCta("anon", "en", LABELS).href, "/en/auth/signup");
  assert.equal(resolveHeroCta("authed", "en", LABELS).href, "/en/download");
  assert.equal(resolveHeroCta("authed", "ja", LABELS).href, "/ja/download");
});

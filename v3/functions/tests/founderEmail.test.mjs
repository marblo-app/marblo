// Unit tests for the founder access email (ticket Kx9jbn6mpQJpUaoshDvf).
// Imports the COMPILED module so the test tracks the real implementation
// (no logic drift). Build first, then run:
//   cd v3/functions && npm run build && node tests/founderEmail.test.mjs
//
// Covers, for all three locales (ko/en/ja), html + text:
//   - DISCORD_INVITE_URL set   → community section renders the invite link
//     plus the context sentence, and NOT the "invite will follow" fallback.
//   - DISCORD_INVITE_URL unset → fallback text only, no link (no leak).
//   - No regression on the other four sections (welcome / download /
//     survey / course coupon).
//   - The course coupon section promises the discount at launch and never
//     implies the code works at checkout today (ticket cKpzwznYcj6ZpyiK9GrT):
//     course payments are not live and coupons/FOUNDER50 is not seeded.
//
// DISCORD_INVITE_URL is captured in a module-level const at import time, so
// the two states need two processes: the parent runs the "link" suite, then
// re-spawns itself with the env removed for the fallback suite.

import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const INVITE = "https://discord.gg/dKBSVQEH9";
const FALLBACK_MODE = process.argv.includes("--fallback");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// Per-locale expectations. `context` is the sentence added alongside the
// invite link; `fallback` is the copy shown when the env is unset.
// `courseSoon` is the launch-gated coupon copy; `courseBanned` are phrasings
// that would imply the code already works at checkout.
const LOCALES = {
  en: {
    context: "Talk with other founders in real time",
    fallback: "A separate Discord invite will follow shortly.",
    courseSoon: "coming soon",
    courseBanned: ["at checkout"],
    betaTotal: "up to 3 months total, including your 1-month beta",
    offerHeadline: "Extend your beta to up to 3 months total",
    sections: [
      "1. Get the beta",
      "2. Survey after your 1-month beta",
      "3. 50% off the course",
      "4. Community",
    ],
    textSections: [
      "1. Get the beta:",
      "2. Beta survey:",
      "3. 50% off the course",
    ],
  },
  ja: {
    context: "他のファウンダーとリアルタイムで交流し",
    fallback: "Discord の招待は追ってご案内します。",
    courseSoon: "近日公開予定",
    courseBanned: ["チェックアウトで"],
    betaTotal: "ベータ1ヶ月を含む最大3ヶ月まで",
    offerHeadline: "5分でベータ最大3ヶ月まで",
    sections: [
      "1. ベータ版を入手",
      "2. 1ヶ月ベータ後のアンケート",
      "3. 講座 50% 割引",
      "4. コミュニティ",
    ],
    textSections: [
      "1. ベータ版を入手:",
      "2. ベータアンケート:",
      "3. 講座 50% 割引",
    ],
  },
  ko: {
    context: "다른 파운더들과 실시간으로 이야기 나누고",
    fallback: "디스코드 초대는 곧 별도로 안내드리겠습니다.",
    courseSoon: "곧 공개 예정",
    courseBanned: ["체크아웃에서"],
    betaTotal: "기존 베타 1개월 포함, 총 3개월",
    offerHeadline: "5분이면 베타를 최대 3개월까지",
    sections: [
      "1. 베타 접근",
      "2. 1개월 베타 후 설문",
      "3. 강의 50% 할인 쿠폰",
      "4. 커뮤니티",
    ],
    textSections: [
      "1. 베타 접근(다운로드):",
      "2. 베타 설문:",
      "3. 강의 50% 할인",
    ],
  },
};

// The four pre-existing sections must survive the community-section change.
function assertNoRegression(locale, spec, { html, text, subject }) {
  assert(subject.length > 0, `${locale}: subject is non-empty`);
  for (const heading of spec.sections) {
    assert(
      html.includes(heading),
      `${locale}: html keeps section "${heading}"`,
    );
  }
  for (const heading of spec.textSections) {
    assert(
      text.includes(heading),
      `${locale}: text keeps section "${heading}"`,
    );
  }
  for (const body of [
    ["html", html],
    ["text", text],
  ]) {
    const [kind, content] = body;
    assert(
      content.includes(`https://marblo.app/${locale}/download`),
      `${locale}: ${kind} keeps the download link`,
    );
    assert(
      content.includes(`https://marblo.app/${locale}/beta-survey`),
      `${locale}: ${kind} keeps the survey link`,
    );
    assert(
      content.includes("FOUNDER50"),
      `${locale}: ${kind} keeps the course coupon code`,
    );
    assert(
      content.includes(spec.betaTotal),
      `${locale}: ${kind} makes the survey Pro period total, not additive`,
    );
    assert(
      content.includes(spec.courseSoon),
      `${locale}: ${kind} gates the course coupon on launch ("${spec.courseSoon}")`,
    );
    for (const banned of spec.courseBanned) {
      assert(
        !content.includes(banned),
        `${locale}: ${kind} drops the redeem-now phrasing "${banned}"`,
      );
    }
  }
}

function assertSurveyOfferCopy(locale, spec, content) {
  for (const body of [
    ["html", content.html],
    ["text", content.text],
  ]) {
    const [kind, rendered] = body;
    assert(
      rendered.includes(spec.offerHeadline),
      `${locale}: survey offer ${kind} headline avoids additive Pro phrasing`,
    );
    assert(
      rendered.includes(spec.betaTotal),
      `${locale}: survey offer ${kind} states the 3-month period includes the beta month`,
    );
    assert(
      rendered.includes(`https://marblo.app/${locale}/beta-survey`),
      `${locale}: survey offer ${kind} keeps the survey link`,
    );
  }
}

if (!FALLBACK_MODE) {
  // ─── Suite 1: DISCORD_INVITE_URL set → link + context rendered ───
  process.env.DISCORD_INVITE_URL = INVITE;
  const { buildFounderAccessEmail, buildFounderSurveyOfferEmail } =
    await import("../lib/index.js");

  console.log("founder email — DISCORD_INVITE_URL set");
  for (const [locale, spec] of Object.entries(LOCALES)) {
    const content = buildFounderAccessEmail(locale);
    const { html, text } = content;

    assert(html.includes(INVITE), `${locale}: html renders the invite link`);
    assert(text.includes(INVITE), `${locale}: text renders the invite link`);
    assert(
      html.includes(spec.context),
      `${locale}: html renders the community context sentence`,
    );
    assert(
      text.includes(spec.context),
      `${locale}: text renders the community context sentence`,
    );
    assert(
      !html.includes(spec.fallback),
      `${locale}: html drops the fallback copy when the invite is set`,
    );
    assert(
      !text.includes(spec.fallback),
      `${locale}: text drops the fallback copy when the invite is set`,
    );
    assertNoRegression(locale, spec, content);
    assertSurveyOfferCopy(
      locale,
      spec,
      buildFounderSurveyOfferEmail(locale),
    );
  }

  // Unknown locales fall back to Korean, and must still get the link.
  const unknown = buildFounderAccessEmail("fr");
  assert(
    unknown.html.includes(INVITE),
    "unknown locale: html renders the link",
  );
  assert(
    unknown.html.includes(LOCALES.ko.context),
    "unknown locale: falls back to Korean copy",
  );

  // ─── Suite 2: env unset → fallback, in a child process ───
  const env = { ...process.env };
  delete env.DISCORD_INVITE_URL;
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "--fallback"],
    { env, encoding: "utf8" },
  );
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  if (child.status !== 0) failed++;

  console.log(`\nparent suite: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} else {
  // Child: no DISCORD_INVITE_URL → fallback copy, and no link anywhere.
  const { buildFounderAccessEmail, buildFounderSurveyOfferEmail } =
    await import("../lib/index.js");

  console.log("\nfounder email — DISCORD_INVITE_URL unset (fallback)");
  for (const [locale, spec] of Object.entries(LOCALES)) {
    const content = buildFounderAccessEmail(locale);
    const { html, text } = content;

    assert(
      html.includes(spec.fallback),
      `${locale}: html renders the fallback copy`,
    );
    assert(
      text.includes(spec.fallback),
      `${locale}: text renders the fallback copy`,
    );
    assert(!html.includes("discord.gg"), `${locale}: html renders no link`);
    assert(!text.includes("discord.gg"), `${locale}: text renders no link`);
    assertNoRegression(locale, spec, content);
    assertSurveyOfferCopy(
      locale,
      spec,
      buildFounderSurveyOfferEmail(locale),
    );
  }

  console.log(`fallback suite: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  slackAppToken,
  slackBotToken,
  slackUserToken,
} from "../fixtures/slack-tokens";
import { SECRET_CORPUS } from "./redact/helpers";

/**
 * 이 스위트가 지키는 것은 두 가지이고, 둘은 서로를 잡아당긴다.
 *
 *  1) 소스에 **완성형 Slack 토큰 리터럴이 다시 들어오지 못하게** 막는다.
 *     들어오면 공개 원격의 push protection 이 그 커밋을 담은 모든 푸시를
 *     막는다(#936 의 픽스처가 실제로 그랬다).
 *  2) 그렇다고 픽스처를 약하게 바꿔 도망가지 못하게 막는다. 런타임에
 *     조립된 값은 **여전히 현실적인 토큰 형태**여야 하고, 제품 코드의
 *     검증 정규식을 그대로 통과해야 한다.
 *
 * 1만 있으면 픽스처를 `xoxb-x` 로 줄여도 통과한다 — 그러면 레닥션 테스트가
 * 무의미해진다. 2만 있으면 리터럴이 다시 기어들어온다. 둘 다 있어야 한다.
 */

// 제품 코드(electron/slack-channels.ts)의 BOT_TOKEN_RE / APP_TOKEN_RE 와 동일.
const BOT_TOKEN_RE = /^xoxb-[A-Za-z0-9-]{10,}$/;
const APP_TOKEN_RE = /^xapp-[A-Za-z0-9-]{10,}$/;

/**
 * 완성형 토큰 리터럴 탐지용. 접두사를 런타임에 이어 붙여서 **이 파일 자신이**
 * 스캐너에 걸리지 않게 한다(그러면 본말이 전도된다).
 */
const LITERAL_TOKEN_RE = new RegExp(
  `["'\`](?:xox${"b"}|xox${"p"}|xap${"p"})-[A-Za-z0-9-]{10,}["'\`]`,
);

describe("slack token fixtures — 조립 결과가 현실적 형태인가", () => {
  it("조립된 bot/app 토큰이 제품 검증 정규식을 통과한다", () => {
    expect(
      BOT_TOKEN_RE.test(
        slackBotToken("1111111111-2222222222-abcdefghijklmnop"),
      ),
    ).toBe(true);
    expect(
      APP_TOKEN_RE.test(
        slackAppToken("1-A01234567-1234567890-abcdefghijklmnopqrstuvwxyz"),
      ),
    ).toBe(true);
  });

  it("접두사만으로는 통과하지 못한다(하한이 살아 있다는 증거)", () => {
    expect(BOT_TOKEN_RE.test(slackBotToken("short"))).toBe(false);
    expect(APP_TOKEN_RE.test(slackAppToken("short"))).toBe(false);
  });

  it("레닥션 코퍼스의 slack 항목이 현실적 길이·구조를 유지한다", () => {
    const slackEntries = SECRET_CORPUS.filter((e) =>
      e.name.startsWith("slack-"),
    );
    // bot / user / webhook 세 항목.
    expect(slackEntries.length).toBeGreaterThanOrEqual(3);

    const bot = slackEntries.find((e) => e.name === "slack-bot")!;
    const user = slackEntries.find((e) => e.name === "slack-user")!;

    expect(bot.value).toMatch(BOT_TOKEN_RE);
    expect(user.value.startsWith("xox" + "p-")).toBe(true);

    for (const entry of [bot, user]) {
      // 실제 Slack 토큰과 같은 자릿수대(30자 이상)와 세그먼트 구조.
      expect(entry.value.length).toBeGreaterThanOrEqual(30);
      expect(entry.value.split("-").length).toBeGreaterThanOrEqual(3);
      // 엔트로피 대용 — 본문에 충분히 다양한 문자가 있어야 한다.
      const body = entry.value.slice(entry.value.indexOf("-") + 1);
      expect(new Set(body).size).toBeGreaterThanOrEqual(16);
    }
  });

  it("slackUserToken 이 xoxp- 접두사를 붙인다", () => {
    expect(slackUserToken("0123456789-AbCdEfGhIjKlMnOpQrStUv")).toMatch(
      new RegExp(`^xox${"p"}-`),
    );
  });
});

const SCAN_ROOTS = ["electron", "src", "shared", "tests", "functions/src"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", ".next"]);

function walk(dir: string, acc: string[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

describe("소스에 완성형 Slack 토큰 리터럴이 없는가", () => {
  it("어떤 소스 파일에도 접두사+본문이 붙은 리터럴이 남아 있지 않다", () => {
    const root = path.resolve(__dirname, "../..");
    const files = SCAN_ROOTS.flatMap((r) => walk(path.join(root, r), []));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      // 이 파일 자신은 탐지 정규식을 조립해 들고 있으므로 제외한다.
      if (file.endsWith("slack-token-fixtures.test.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (LITERAL_TOKEN_RE.test(src)) {
        // ★위반 파일 경로만 보고한다. 값은 절대 출력하지 않는다.
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

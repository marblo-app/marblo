/**
 * `lib/replay/shareIntents.ts` — 계약:
 *   - 각 빌더는 순수 함수다: URL·텍스트 인코딩만 하고 부수효과가 없다.
 *   - X/LinkedIn 은 `url` 파라미터를 갖는다. Threads 는 URL 파라미터가 없어서
 *     텍스트 안에 URL 을 이어붙인다(공식 intent 제약).
 *   - 특수문자(공백·`&`·`#`·한글)가 안전하게 인코딩된다 — 깨진 쿼리스트링으로
 *     플랫폼에 전달되면 안 된다.
 *   - `buildReplayShareIntents` 는 세 플랫폼을 고정 순서로 반환한다.
 */
import { describe, expect, it } from "vitest";
import {
  buildLinkedInShareUrl,
  buildReplayShareIntents,
  buildThreadsShareUrl,
  buildTwitterShareUrl,
} from "../../src/lib/replay/shareIntents";

const URL = "https://marblo.app/replay/abc123XYZ";
const TEXT = "Ship the replay export card & 완료!";

describe("buildTwitterShareUrl", () => {
  it("encodes url and text as separate query params", () => {
    const result = buildTwitterShareUrl(URL, TEXT);
    expect(result).toBe(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(
        URL
      )}&text=${encodeURIComponent(TEXT)}`
    );
  });

  it("round-trips back to the original url and text via URLSearchParams", () => {
    const result = buildTwitterShareUrl(URL, TEXT);
    const query = result.split("?")[1];
    const params = new URLSearchParams(query);
    expect(params.get("url")).toBe(URL);
    expect(params.get("text")).toBe(TEXT);
  });

  it("escapes & and # inside text so they cannot break the query string", () => {
    const result = buildTwitterShareUrl(URL, "a&b#c");
    expect(result).not.toContain("text=a&b#c");
    const query = result.split("?")[1];
    const params = new URLSearchParams(query);
    expect(params.get("text")).toBe("a&b#c");
  });
});

describe("buildLinkedInShareUrl", () => {
  it("only carries the url param (LinkedIn ignores custom text)", () => {
    const result = buildLinkedInShareUrl(URL);
    expect(result).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
        URL
      )}`
    );
  });
});

describe("buildThreadsShareUrl", () => {
  it("appends the url to the text since Threads has no url param", () => {
    const result = buildThreadsShareUrl(URL, TEXT);
    expect(result).toBe(
      `https://www.threads.net/intent/post?text=${encodeURIComponent(
        `${TEXT} ${URL}`
      )}`
    );
  });

  it("round-trips: decoded text contains both the original text and url", () => {
    const result = buildThreadsShareUrl(URL, TEXT);
    const query = result.split("?")[1];
    const params = new URLSearchParams(query);
    const decoded = params.get("text") ?? "";
    expect(decoded).toBe(`${TEXT} ${URL}`);
    expect(decoded).toContain(URL);
  });
});

describe("buildReplayShareIntents", () => {
  it("returns x, linkedin, threads in that fixed order", () => {
    const intents = buildReplayShareIntents(URL, TEXT);
    expect(intents.map((intent) => intent.platform)).toEqual([
      "x",
      "linkedin",
      "threads",
    ]);
  });

  it("labels each intent for display", () => {
    const intents = buildReplayShareIntents(URL, TEXT);
    expect(intents.map((intent) => intent.label)).toEqual([
      "X",
      "LinkedIn",
      "Threads",
    ]);
  });

  it("each intent url matches its dedicated builder", () => {
    const intents = buildReplayShareIntents(URL, TEXT);
    const byPlatform = Object.fromEntries(
      intents.map((intent) => [intent.platform, intent.url])
    );
    expect(byPlatform.x).toBe(buildTwitterShareUrl(URL, TEXT));
    expect(byPlatform.linkedin).toBe(buildLinkedInShareUrl(URL));
    expect(byPlatform.threads).toBe(buildThreadsShareUrl(URL, TEXT));
  });

  it("is pure — same input produces identical output across calls", () => {
    const first = buildReplayShareIntents(URL, TEXT);
    const second = buildReplayShareIntents(URL, TEXT);
    expect(first).toEqual(second);
  });
});

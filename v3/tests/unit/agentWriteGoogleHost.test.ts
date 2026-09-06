import { describe, expect, it } from "vitest";
import { isGoogleHostForAgentWrite } from "../../src/lib/agentWriteGoogleHost";
import { isGoogleHost } from "../../electron/browser-pane-agent-write-policy";

describe("isGoogleHostForAgentWrite", () => {
  it("matches the bare host", () => {
    expect(isGoogleHostForAgentWrite("https://google.com/search?q=x")).toBe(
      true,
    );
  });

  it("matches known Google subdomains", () => {
    expect(isGoogleHostForAgentWrite("https://mail.google.com/")).toBe(true);
    expect(
      isGoogleHostForAgentWrite("https://drive.google.com/drive/my-drive"),
    ).toBe(true);
  });

  it("matches the separate gmail.com and youtube.com domains", () => {
    expect(isGoogleHostForAgentWrite("https://gmail.com/")).toBe(true);
    expect(isGoogleHostForAgentWrite("https://youtube.com/")).toBe(true);
  });

  it("does not match an unrelated host that merely contains 'google'", () => {
    expect(isGoogleHostForAgentWrite("https://notgoogle.com/")).toBe(false);
    expect(
      isGoogleHostForAgentWrite("https://google.com.evil-example.net/"),
    ).toBe(false);
  });

  it("does not throw on an unparseable URL", () => {
    expect(isGoogleHostForAgentWrite("not a url")).toBe(false);
  });

  // ★The actual enforcement lives in electron/browser-pane-agent-write-policy.ts
  // (main process, refuses every write on a Google host regardless of grant).
  // This renderer copy only decides whether to show a warning next to the
  // write toggle. If the two ever disagree, the toggle either warns when it
  // shouldn't or — worse — stays quiet on a host the policy actually blocks.
  // Run both against the same URLs so a change to one that isn't mirrored to
  // the other fails here instead of shipping as a silent UI/policy mismatch.
  it("agrees with the main-process isGoogleHost on every case above", () => {
    const urls = [
      "https://google.com/search?q=x",
      "https://mail.google.com/",
      "https://drive.google.com/drive/my-drive",
      "https://gmail.com/",
      "https://youtube.com/",
      "https://notgoogle.com/",
      "https://google.com.evil-example.net/",
      "https://claude.ai/",
      "https://accounts.google.com/signin",
      "not a url",
    ];
    for (const url of urls) {
      expect(isGoogleHostForAgentWrite(url)).toBe(isGoogleHost(url));
    }
  });
});

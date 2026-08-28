import { chromium, type Browser } from "@playwright/test";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  buildIntentRecordingDraft,
  installIntentRecorder,
  intentScriptTopLevelKeys,
  readIntentRecorderEvents,
  recordIntentScriptDraftFromCdp,
  type RawRecordedEvent,
} from "../../electron/web-automation";

interface FixtureServer {
  origin: string;
  close: () => Promise<void>;
}

describe("web automation intent recorder", () => {
  it("records the local fixture as schema v1 intent script draft", async () => {
    const server = await startFixtureServer();
    const browser = await launchHeadlessBrowser();
    try {
      const page = await browser.newPage();
      const cdp = await page.context().newCDPSession(page);
      await installIntentRecorder(cdp);

      const startUrl = `${server.origin}/v0-baseline.html`;
      await page.goto(startUrl);
      await page.selectOption("#vendor", "한빛유통");
      await page.fill("#budget", "30000");
      await page.fill("#memo", "8월 정산");
      await page.click("#submit-btn");
      await page.waitForFunction(() => {
        const result = document.querySelector("#result");
        return result instanceof HTMLElement && result.dataset.state === "ok";
      });

      const draft = await recordIntentScriptDraftFromCdp(cdp, {
        id: "flow_settlement_filing",
        name: "정산 등록",
        recordedAt: "2026-08-28T00:00:00.000Z",
        origin: server.origin,
        startUrl,
        inputs: [
          {
            name: "vendor",
            type: "string",
            example: "한빛유통",
            required: true,
          },
          { name: "amount", type: "string", example: "30000", required: true },
        ],
        inputBindings: {
          거래처: "vendor",
          "정산 금액": "amount",
        },
        outcome: {
          kind: "textContains",
          description: "'처리 결과' 영역의 본문",
          hints: { css: "#result" },
          expect: "등록 완료",
        },
      });

      expect(Object.keys(draft.script)).toEqual(intentScriptTopLevelKeys());
      expect(draft.script.schemaVersion).toBe("1.0");
      expect(draft.script.steps.map((step) => step.kind)).toEqual([
        "select",
        "fill",
        "fill",
        "click",
      ]);
      expect(draft.script.steps[0]).toMatchObject({
        id: "s1",
        kind: "select",
        target: {
          role: "combobox",
          name: "거래처",
          hints: {
            css: "#vendor",
            xpath: "/html/body[1]/main[1]/form[1]/div[1]/select[1]",
            attrs: {
              name: "vendor",
              placeholder: "",
              type: "",
            },
            text: "",
          },
        },
        value: { from: "input", ref: "vendor" },
        verify: { kind: "valueEquals", expect: "{{vendor}}" },
        onResolveFail: "escalate",
      });
      expect(draft.script.steps[1]).toMatchObject({
        target: {
          role: "textbox",
          name: "정산 금액",
          hints: {
            css: "#budget",
            xpath: "/html/body[1]/main[1]/form[1]/div[2]/input[1]",
            attrs: {
              name: "budget",
              placeholder: "금액을 입력하세요",
              type: "text",
            },
          },
        },
        value: { from: "input", ref: "amount" },
      });
      for (const step of draft.script.steps) {
        expect(step.target?.hints.css).toEqual(expect.any(String));
        expect(step.target?.hints.xpath).toEqual(expect.any(String));
        expect(step.target?.role).toEqual(expect.any(String));
        expect(step.target?.name).toEqual(expect.any(String));
        expect(step.target?.hints.attrs).toEqual({
          name: expect.any(String),
          placeholder: expect.any(String),
          type: expect.any(String),
        });
      }
      expect(draft.humanReview).toMatchObject({
        required: true,
        fields: [
          { stepId: "s1", paths: ["intent", "target.description"] },
          { stepId: "s2", paths: ["intent", "target.description"] },
          { stepId: "s3", paths: ["intent", "target.description"] },
          { stepId: "s4", paths: ["intent", "target.description"] },
        ],
      });
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);

  it("never stores type=password values in raw events or script output", async () => {
    const secret = "super-secret-for-test-123";
    const browser = await launchHeadlessBrowser();
    try {
      const page = await browser.newPage();
      const cdp = await page.context().newCDPSession(page);
      await installIntentRecorder(cdp);
      const passwordPage = `
        <main>
          <form>
            <label for="password">비밀번호</label>
            <input id="password" name="password" type="password" autocomplete="current-password" />
          </form>
        </main>
      `;
      await page.goto(`data:text/html,${encodeURIComponent(passwordPage)}`);
      await page.locator("#password").evaluate((element, value) => {
        if (!(element instanceof HTMLInputElement)) return;
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, secret);

      const events = await readIntentRecorderEvents(cdp);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "fill",
        sensitiveValue: true,
        value: undefined,
        hints: {
          attrs: {
            name: "password",
            type: "password",
          },
        },
      });

      const draft = buildIntentRecordingDraft(events, {
        id: "flow_password_entry",
        name: "비밀번호 입력",
        recordedAt: "2026-08-28T00:00:00.000Z",
        origin: "http://127.0.0.1",
        startUrl: "http://127.0.0.1/password.html",
        outcome: {
          kind: "urlMatches",
          description: "로그인 후 URL",
          hints: {},
          expect: "/done",
        },
      });

      expect(JSON.stringify(events)).not.toContain(secret);
      expect(JSON.stringify(draft.script)).not.toContain(secret);
      expect(draft.script.inputs).toEqual([
        { name: "password", type: "string", example: "", required: true },
      ]);
      expect(draft.script.steps[0]).toMatchObject({
        value: { from: "input", ref: "password" },
        verify: { kind: "valueEquals", expect: "{{password}}" },
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("routes other sensitive-looking values through replay inputs", () => {
    const events: RawRecordedEvent[] = [
      {
        kind: "fill",
        value: undefined,
        sensitiveValue: true,
        role: "textbox",
        accessibleName: "카드번호",
        group: "결제",
        hints: {
          css: "#card",
          xpath: "/html/body[1]/main[1]/input[1]",
          attrs: { name: "card", placeholder: "카드번호", type: "text" },
          text: "",
          nearbyText: ["카드번호"],
        },
      },
    ];

    const draft = buildIntentRecordingDraft(events, {
      id: "flow_card_entry",
      name: "카드 입력",
      recordedAt: "2026-08-28T00:00:00.000Z",
      origin: "http://127.0.0.1",
      startUrl: "http://127.0.0.1/card.html",
      outcome: {
        kind: "urlMatches",
        description: "완료 URL",
        hints: {},
        expect: "/done",
      },
    });

    expect(draft.script.inputs).toEqual([
      { name: "cardNumber", type: "string", example: "", required: true },
    ]);
    expect(draft.script.steps[0].value).toEqual({
      from: "input",
      ref: "cardNumber",
    });
  });
});

async function startFixtureServer(): Promise<FixtureServer> {
  const root = path.join(process.cwd(), "docs/spike-intent-replay/fixtures");
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = path.join(root, relative);
    if (
      !file.startsWith(root) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypeFor(file),
    });
    response.end(fs.readFileSync(file));
  });
  await listen(server);
  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function isAddressInfo(
  value: string | AddressInfo | null,
): value is AddressInfo {
  return typeof value === "object" && value !== null;
}

async function launchHeadlessBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (chromeError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (defaultError) {
      throw new Error(
        `Unable to launch a headless browser. chrome=${messageOf(
          chromeError,
        )}; bundled=${messageOf(defaultError)}`,
      );
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

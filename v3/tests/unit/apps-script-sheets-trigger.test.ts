/**
 * Apps Script 템플릿 ↔ 서버 검증기 **실물 대조**.
 *
 * 이 테스트의 존재 이유는 하나다 — 설계 문서(§3.5)가 지목한 자리가 조용히
 * 어긋나는지 실제로 확인하는 것. 그래서 문자열을 눈으로 비교하지 않고,
 * **생성된 스크립트를 그대로 실행**해서 나온 서명을 서버의
 * `verifyAssistantWebhookSignature` 에 그대로 먹인다.
 *
 * Apps Script 런타임은 `node:vm` 안에서 흉내낸다. 흉내의 핵심은 하나뿐이고,
 * 그게 이 테스트의 전부다:
 *   `Utilities.computeHmacSha256Signature()` 는 Java `byte[]` 를 돌려주므로
 *   값이 **-128..127** 이다. 스텁도 반드시 그 범위로 돌려준다 — 부호 없는
 *   0..255 로 돌려주면 템플릿의 버그를 테스트가 덮어 버린다.
 */
import * as crypto from "crypto";
import * as vm from "vm";
import { describe, expect, it } from "vitest";
import {
  APPS_SCRIPT_EVENT_NAME,
  APPS_SCRIPT_MAX_ROWS_IN_PAYLOAD,
  APPS_SCRIPT_SOURCE,
  buildSheetsAppsScript,
  escapeAppsScriptStringLiteral,
  maskAppsScriptSecret,
  normalizeAppsScriptIntervalMinutes,
} from "../../electron/apps-script-sheets-trigger";
import {
  validateAssistantWebhookPayload,
  verifyAssistantWebhookSignature,
} from "../../functions/src/assistantWebhook";
import { agents as enAgents } from "../../src/locales/en/agents";
import { agents as koAgents } from "../../src/locales/ko/agents";

const WEBHOOK_URL =
  "https://asia-northeast3-marblo.cloudfunctions.net/assistantWebhook?webhookId=awh_testWebhookId";
// 테스트 전용 값. 실제 시크릿이 아니다.
const SECRET = "test_secret_do_not_use_in_production_0123456789";

interface CapturedRequest {
  url: string;
  options: {
    method: string;
    contentType: string;
    payload: string;
    headers: Record<string, string>;
    muteHttpExceptions: boolean;
  };
}

interface FakeSheetSpec {
  name: string;
  rows: string[][];
}

interface AppsScriptHarness {
  context: vm.Context;
  requests: CapturedRequest[];
  properties: Map<string, string>;
  triggers: Array<{ handler: string; kind: string }>;
  logs: string[];
  sheet: FakeSheetSpec;
  responseCode: number;
  call(functionName: string, ...args: unknown[]): unknown;
}

/** ★Apps Script/Java 의 부호 있는 바이트를 그대로 재현한다. */
function signedHmacBytes(message: string, key: string): number[] {
  const digest = crypto.createHmac("sha256", key).update(message, "utf8").digest();
  return Array.from(digest).map((byte) => (byte > 127 ? byte - 256 : byte));
}

function makeHarness(
  source: string,
  sheet: FakeSheetSpec,
  now = 1_764_000_000_000,
): AppsScriptHarness {
  const harness: Partial<AppsScriptHarness> & {
    requests: CapturedRequest[];
    properties: Map<string, string>;
    triggers: Array<{ handler: string; kind: string }>;
    logs: string[];
    responseCode: number;
  } = {
    requests: [],
    properties: new Map<string, string>(),
    triggers: [],
    logs: [],
    responseCode: 200,
  };

  const sheetObject = {
    getName: () => sheet.name,
    getLastRow: () => sheet.rows.length,
    getLastColumn: () =>
      sheet.rows.reduce((max, row) => Math.max(max, row.length), 0),
    getRange: (
      startRow: number,
      startColumn: number,
      numRows: number,
      numColumns: number,
    ) => ({
      getValues: () =>
        sheet.rows
          .slice(startRow - 1, startRow - 1 + numRows)
          .map((row) =>
            Array.from({ length: numColumns }, (_, i) => row[startColumn - 1 + i] ?? ""),
          ),
    }),
  };

  const spreadsheet = {
    getId: () => "1TestSpreadsheetId",
    getName: () => "테스트 응답 시트",
    getSheets: () => [sheetObject],
    getSheetByName: (name: string) => (name === sheet.name ? sheetObject : null),
  };

  const triggerBuilder = (handler: string) => {
    let kind = "unknown";
    const builder: Record<string, unknown> = {
      timeBased: () => ((kind = "time"), builder),
      everyMinutes: () => builder,
      everyHours: () => builder,
      forSpreadsheet: () => builder,
      onChange: () => ((kind = "change"), builder),
      create: () => harness.triggers.push({ handler, kind }),
    };
    return builder;
  };

  const sandbox = {
    Utilities: {
      computeHmacSha256Signature: (message: string, key: string) =>
        signedHmacBytes(message, key),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => harness.properties.get(key) ?? null,
        setProperty: (key: string, value: string) => {
          harness.properties.set(key, value);
        },
      }),
    },
    SpreadsheetApp: { getActive: () => spreadsheet },
    UrlFetchApp: {
      fetch: (url: string, options: CapturedRequest["options"]) => {
        harness.requests.push({ url, options });
        return {
          getResponseCode: () => harness.responseCode,
          getContentText: () => "",
        };
      },
    },
    ScriptApp: {
      newTrigger: triggerBuilder,
      getProjectTriggers: () =>
        harness.triggers.map((trigger) => ({
          getHandlerFunction: () => trigger.handler,
        })),
      deleteTrigger: () => undefined,
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }),
    },
    Logger: {
      log: (message: string) => {
        harness.logs.push(String(message));
      },
    },
    Date: class extends Date {
      static now(): number {
        return now;
      }
    },
    Math,
    JSON,
    String,
    Number,
    Error,
    isFinite,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  harness.context = context;
  harness.sheet = sheet;
  harness.call = (functionName: string, ...args: unknown[]) => {
    const fn = (context as Record<string, unknown>)[functionName];
    if (typeof fn !== "function") {
      throw new Error(`generated script has no function ${functionName}`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  };
  return harness as AppsScriptHarness;
}

function installAndAddRows(
  extraRows: string[][],
  options: { locale?: "ko" | "en"; sheetName?: string } = {},
): AppsScriptHarness {
  const sheet: FakeSheetSpec = {
    name: options.sheetName ?? "설문지 응답 시트1",
    rows: [
      ["이름", "이메일", "문의"],
      ["김철수", "chulsoo@example.com", "가격 문의"],
    ],
  };
  const source = buildSheetsAppsScript({
    webhookUrl: WEBHOOK_URL,
    secret: SECRET,
    sheetName: sheet.name,
    pollMinutes: 5,
    locale: options.locale ?? "ko",
  });
  const harness = makeHarness(source, sheet);
  harness.call("marbloInstall");
  sheet.rows.push(...extraRows);
  harness.call("marbloCheckNewRows");
  return harness;
}

describe("Apps Script sheets trigger template", () => {
  it("생성된 스크립트가 실제로 실행되고 트리거 둘을 설치한다", () => {
    const harness = installAndAddRows([]);
    expect(harness.triggers.map((t) => t.handler).sort()).toEqual([
      "marbloCheckNewRows",
      "marbloOnChange",
    ]);
    // ★첫 설치는 기준선만 잡는다 — 발화하지 않는 것이 정상이다.
    expect(harness.requests).toHaveLength(0);
  });

  it("★HMAC 서명이 서버 검증기(verifyAssistantWebhookSignature)를 통과한다", () => {
    const harness = installAndAddRows([
      ["박영희", "younghee@example.com", "견적 요청 — 한글·이모지 🙂 포함"],
    ]);
    expect(harness.requests).toHaveLength(1);
    const request = harness.requests[0];
    const rawBody = Buffer.from(request.options.payload, "utf8");
    expect(
      verifyAssistantWebhookSignature(
        request.options.headers["x-marblo-signature"],
        rawBody,
        SECRET,
      ),
    ).toBe(true);
  });

  it("★부호 있는 바이트를 접지 않으면 검증이 실패한다 (함정이 실재한다는 증명)", () => {
    const harness = installAndAddRows([["박영희", "younghee@example.com", "견적"]]);
    const request = harness.requests[0];
    const rawBody = Buffer.from(request.options.payload, "utf8");
    const header = request.options.headers["x-marblo-signature"];
    const ts = /ts=(\d+)/.exec(header)?.[1] ?? "";

    // Apps Script 의 고전적 오답: 부호 있는 바이트를 그대로 16진수로 변환.
    const naiveHex = signedHmacBytes(`${ts}:${request.options.payload}`, SECRET)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(naiveHex).toContain("-");
    expect(
      verifyAssistantWebhookSignature(`ts=${ts};h1=${naiveHex}`, rawBody, SECRET),
    ).toBe(false);

    // 대문자 hex 도 불일치다 — 검증기는 문자열 바이트를 비교한다.
    const upperHex = /h1=([0-9a-f]+)/.exec(header)?.[1]?.toUpperCase() ?? "";
    expect(upperHex).not.toBe("");
    expect(
      verifyAssistantWebhookSignature(`ts=${ts};h1=${upperHex}`, rawBody, SECRET),
    ).toBe(false);
  });

  it("서명 대상 문자열이 전송 본문과 정확히 같다 (직렬화 1회)", () => {
    const harness = installAndAddRows([["최민수", "minsu@example.com", "데모 요청"]]);
    const request = harness.requests[0];
    const header = request.options.headers["x-marblo-signature"];
    const ts = /ts=(\d+)/.exec(header)?.[1] ?? "";
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(`${ts}:${request.options.payload}`, "utf8")
      .digest("hex");
    expect(header).toBe(`ts=${ts};h1=${expected}`);
    // 개행이 끼어들지 않는다 — JSON.stringify 의 기본(들여쓰기 없음)을 쓴다.
    expect(request.options.payload).not.toContain("\n");
  });

  it("전송 본문이 서버의 페이로드 계약(평면 스칼라·필드 수·길이)을 만족한다", () => {
    const harness = installAndAddRows([
      ["최민수", "minsu@example.com", "데모 요청"],
      ["이지은", "jieun@example.com", "제휴 문의"],
    ]);
    const request = harness.requests[0];
    const rawBody = Buffer.from(request.options.payload, "utf8");
    const parsed = JSON.parse(request.options.payload);
    expect(parsed.event).toBe(APPS_SCRIPT_EVENT_NAME);
    expect(parsed.source).toBe(APPS_SCRIPT_SOURCE);
    const result = validateAssistantWebhookPayload(parsed, rawBody.length);
    expect(result.ok).toBe(true);
    expect(Object.keys(parsed.payload).length).toBeLessThanOrEqual(20);
    expect(parsed.payload.newRowCount).toBe(2);
    expect(parsed.payload.truncated).toBe(false);
    expect(parsed.payload.row3).toContain("최민수");
  });

  it("한 tick 의 POST 는 1회다 — 행이 쏟아져도 배치로 접고 잘랐다고 말한다", () => {
    const flood = Array.from({ length: 40 }, (_, i) => [
      `사용자${i}`,
      `user${i}@example.com`,
      "대량 붙여넣기",
    ]);
    const harness = installAndAddRows(flood);
    expect(harness.requests).toHaveLength(1);
    const parsed = JSON.parse(harness.requests[0].options.payload);
    expect(parsed.payload.newRowCount).toBe(40);
    expect(parsed.payload.truncated).toBe(true);
    const rowKeys = Object.keys(parsed.payload).filter((key) =>
      /^row\d+$/.test(key),
    );
    expect(rowKeys).toHaveLength(APPS_SCRIPT_MAX_ROWS_IN_PAYLOAD);
  });

  it("새 행이 없으면 아무것도 보내지 않는다 (조용한 tick 이 정상)", () => {
    const harness = installAndAddRows([["최민수", "minsu@example.com", "데모"]]);
    expect(harness.requests).toHaveLength(1);
    harness.call("marbloCheckNewRows");
    expect(harness.requests).toHaveLength(1);
  });

  it("행이 줄어들면 발화하지 않고 커서만 내린다", () => {
    const harness = installAndAddRows([["최민수", "minsu@example.com", "데모"]]);
    harness.sheet.rows.pop();
    harness.sheet.rows.pop();
    harness.call("marbloCheckNewRows");
    expect(harness.requests).toHaveLength(1);
    harness.sheet.rows.push(["새사람", "new@example.com", "재문의"]);
    harness.call("marbloCheckNewRows");
    expect(harness.requests).toHaveLength(2);
    expect(JSON.parse(harness.requests[1].options.payload).payload.newRowCount).toBe(1);
  });

  it("onChange 는 쿨다운 안에서 다시 쏘지 않는다 (레이트 리밋 방어)", () => {
    const harness = installAndAddRows([["최민수", "minsu@example.com", "데모"]]);
    expect(harness.requests).toHaveLength(1);
    harness.sheet.rows.push(["또다른", "other@example.com", "문의"]);
    harness.call("marbloOnChange", { changeType: "INSERT_ROW" });
    // 쿨다운(60초) 안이므로 보내지 않는다. 다음 시간 트리거가 커서로 집어간다.
    expect(harness.requests).toHaveLength(1);
    harness.call("marbloCheckNewRows");
    expect(harness.requests).toHaveLength(2);
  });

  it("2xx 가 아니면 커서를 전진시키지 않고 예외로 드러낸다", () => {
    const sheet: FakeSheetSpec = {
      name: "Sheet1",
      rows: [["header"], ["a"]],
    };
    const harness = makeHarness(
      buildSheetsAppsScript({
        webhookUrl: WEBHOOK_URL,
        secret: SECRET,
        sheetName: sheet.name,
        pollMinutes: 5,
        locale: "en",
      }),
      sheet,
    );
    harness.call("marbloInstall");
    harness.responseCode = 401;
    sheet.rows.push(["b"]);
    expect(() => harness.call("marbloCheckNewRows")).toThrow(/401/);
    harness.responseCode = 200;
    harness.call("marbloCheckNewRows");
    // 실패한 행을 잃지 않는다 — 커서가 그대로였으므로 다시 실린다.
    expect(harness.requests).toHaveLength(2);
    expect(JSON.parse(harness.requests[1].options.payload).payload.newRowCount).toBe(1);
  });

  it("en 템플릿도 같은 서명을 만든다 (문구만 다르고 계약은 같다)", () => {
    const ko = installAndAddRows([["A", "a@example.com", "x"]], { locale: "ko" });
    const en = installAndAddRows([["A", "a@example.com", "x"]], { locale: "en" });
    expect(en.requests[0].options.payload).toBe(ko.requests[0].options.payload);
    expect(en.requests[0].options.headers["x-marblo-signature"]).toBe(
      ko.requests[0].options.headers["x-marblo-signature"],
    );
    expect(
      verifyAssistantWebhookSignature(
        en.requests[0].options.headers["x-marblo-signature"],
        Buffer.from(en.requests[0].options.payload, "utf8"),
        SECRET,
      ),
    ).toBe(true);
  });

  it("POST 옵션이 웹훅 계약대로다", () => {
    const harness = installAndAddRows([["A", "a@example.com", "x"]]);
    const request = harness.requests[0];
    expect(request.url).toBe(WEBHOOK_URL);
    expect(request.options.method).toBe("post");
    expect(request.options.contentType).toBe("application/json");
    expect(request.options.muteHttpExceptions).toBe(true);
    expect(typeof request.options.payload).toBe("string");
  });
});

describe("Apps Script template generation", () => {
  it("시트 이름의 따옴표·역슬래시를 이스케이프해 문법 오류를 막는다", () => {
    const nasty = "밥's \\ sheet";
    const source = buildSheetsAppsScript({
      webhookUrl: WEBHOOK_URL,
      secret: SECRET,
      sheetName: nasty,
      pollMinutes: 5,
      locale: "ko",
    });
    const sheet: FakeSheetSpec = { name: nasty, rows: [["h"], ["a"]] };
    const harness = makeHarness(source, sheet);
    harness.call("marbloInstall");
    sheet.rows.push(["b"]);
    harness.call("marbloCheckNewRows");
    expect(JSON.parse(harness.requests[0].options.payload).payload.sheetName).toBe(
      nasty,
    );
  });

  it("escapeAppsScriptStringLiteral 은 줄바꿈·구분자까지 접는다", () => {
    expect(escapeAppsScriptStringLiteral("a'b")).toBe("a\\'b");
    expect(escapeAppsScriptStringLiteral("a\\b")).toBe("a\\\\b");
    expect(escapeAppsScriptStringLiteral("a\nb")).toBe("a\\nb");
    expect(escapeAppsScriptStringLiteral("a b")).toBe("a\\u2028b");
  });

  it("★everyMinutes 가 받지 않는 값은 허용값으로 접는다", () => {
    expect(normalizeAppsScriptIntervalMinutes(1)).toBe(1);
    expect(normalizeAppsScriptIntervalMinutes(3)).toBe(5); // 동률은 느린 쪽
    expect(normalizeAppsScriptIntervalMinutes(7)).toBe(5);
    expect(normalizeAppsScriptIntervalMinutes(12)).toBe(10);
    expect(normalizeAppsScriptIntervalMinutes(40)).toBe(30);
    expect(normalizeAppsScriptIntervalMinutes(45)).toBe(60); // 동률은 느린 쪽
    expect(normalizeAppsScriptIntervalMinutes(60)).toBe(60);
    expect(normalizeAppsScriptIntervalMinutes(undefined)).toBe(5);
    expect(
      buildSheetsAppsScript({
        webhookUrl: WEBHOOK_URL,
        secret: SECRET,
        pollMinutes: 7,
        locale: "ko",
      }),
    ).toContain(".everyMinutes(5)");
    expect(
      buildSheetsAppsScript({
        webhookUrl: WEBHOOK_URL,
        secret: SECRET,
        pollMinutes: 60,
        locale: "en",
      }),
    ).toContain(".everyHours(1)");
  });

  it("★부호 함정을 고치는 코드가 템플릿 안에 실제로 있다", () => {
    const source = buildSheetsAppsScript({
      webhookUrl: WEBHOOK_URL,
      secret: SECRET,
      locale: "ko",
    });
    expect(source).toContain("(raw[i] & 0xff).toString(16).padStart(2, '0')");
    expect(source).toContain("var body = JSON.stringify(message);");
    expect(source).toContain("payload: body,");
    expect(source).not.toContain("toUpperCase");
  });

  it("시크릿 마스킹은 원문을 드러내지 않는다", () => {
    const masked = maskAppsScriptSecret(SECRET);
    expect(masked).not.toContain(SECRET);
    expect(masked).toContain("...");
    expect(maskAppsScriptSecret("short")).toBe("****");
    expect(maskAppsScriptSecret("")).toBe("****");
  });
});

/**
 * ko/en 대칭.
 *
 * `en/agents.ts` 가 `Record<keyof typeof koAgents, string>` 로 타입돼 있어
 * 키 누락·오타는 이미 **컴파일 오류**다. 그래도 여기서 한 번 더 보는 것은
 * 두 가지 때문이다: (1) 한국어 문자열이 en 테이블에 복사돼 들어오는 것은
 * 타입이 못 잡는다(#1254 가 걷어낸 바로 그 사고), (2) 이 티켓이 추가한 키가
 * 실제로 양쪽에 다 생겼는지 목록으로 확인한다.
 */
describe("Apps Script 안내 문구 ko/en 대칭", () => {
  const koKeys = Object.keys(koAgents);
  const enKeys = Object.keys(enAgents);

  it("agents 네임스페이스 전체 키가 양쪽에서 같다", () => {
    expect(enKeys.sort()).toEqual(koKeys.sort());
  });

  it("이 티켓이 추가한 키가 ko/en 양쪽에 다 있다", () => {
    const added = [
      "agents.triggers.appsScript.title",
      "agents.triggers.appsScript.description",
      "agents.triggers.appsScript.stepCount",
      "agents.triggers.appsScript.needsWebhook",
      "agents.triggers.appsScript.needsSecret",
      "agents.triggers.appsScript.sheetName",
      "agents.triggers.appsScript.sheetNameHint",
      "agents.triggers.appsScript.interval",
      "agents.triggers.appsScript.intervalOption",
      "agents.triggers.appsScript.intervalHint",
      "agents.triggers.appsScript.script",
      "agents.triggers.appsScript.copy",
      "agents.triggers.appsScript.copied",
      "agents.triggers.appsScript.secretWarning",
      "agents.triggers.appsScript.stepsTitle",
      "agents.triggers.appsScript.step1",
      "agents.triggers.appsScript.step2",
      "agents.triggers.appsScript.step3",
      "agents.triggers.appsScript.step4",
      "agents.triggers.appsScript.step5",
      "agents.triggers.appsScript.frictionTitle",
      "agents.triggers.appsScript.friction1",
      "agents.triggers.appsScript.friction2",
      "agents.triggers.appsScript.friction3",
      "agents.triggers.appsScript.troubleshootTitle",
      "agents.triggers.appsScript.troubleshoot401",
      "agents.triggers.appsScript.troubleshoot403",
      "agents.triggers.appsScript.troubleshoot429",
      "agents.triggers.sheets.heldBadge",
      "agents.triggers.sheets.heldNotice",
      "agents.triggers.validation.sheetsTriggerWithheld",
    ];
    for (const key of added) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
      expect((koAgents as Record<string, string>)[key].length).toBeGreaterThan(1);
      expect((enAgents as Record<string, string>)[key].length).toBeGreaterThan(1);
    }
  });

  it("★en 문구에 한국어가 섞여 들어오지 않는다 (#1254 회귀 방지)", () => {
    const hangul = /[가-힣]/;
    for (const [key, value] of Object.entries(enAgents)) {
      if (!key.startsWith("agents.triggers.appsScript")) continue;
      expect(hangul.test(value), `${key} contains Hangul`).toBe(false);
    }
    expect(hangul.test(enAgents["agents.triggers.sheets.heldNotice"])).toBe(false);
    expect(
      hangul.test(enAgents["agents.triggers.validation.sheetsTriggerWithheld"]),
    ).toBe(false);
  });

  it("단계 안내는 ko/en 모두 5단계다 — 마찰의 크기를 양쪽에서 같게 말한다", () => {
    for (const table of [koAgents, enAgents] as Array<Record<string, string>>) {
      for (const step of ["step1", "step2", "step3", "step4", "step5"]) {
        expect(table[`agents.triggers.appsScript.${step}`]).toBeTruthy();
      }
      expect(table["agents.triggers.appsScript.step6"]).toBeUndefined();
    }
  });
});

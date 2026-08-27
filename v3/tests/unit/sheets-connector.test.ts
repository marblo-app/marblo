/**
 * Google Sheets 커넥터 + "새 행" 판정 회귀 테스트. 티켓 qxDMhv5bgZA2nRe7AdPC.
 *
 * 여기서 잠그는 것은 세 가지다.
 *  1. 첫 폴링은 발화하지 않는다(기존 행 전체가 새 행으로 오케에 쏟아지는 것 방지)
 *  2. 행 삭제 후 추가를 놓치지 않는다(행 개수만 비교하면 놓친다)
 *  3. 셀 수정·삭제·재정렬은 발화하지 않는다(오케 깨우기는 구독 차감이다)
 */
import { describe, expect, it } from "vitest";
import {
  buildSheetsValuesUrl,
  detectNewSheetRows,
  MAX_ANNOUNCED_SHEET_ROWS,
  normalizeSheetsRange,
  normalizeSpreadsheetId,
  parseSheetsValuesResult,
  sheetRowFingerprint,
  sheetsErrorMessage,
  createSheetsConnector,
  type SheetsRowCursor,
} from "../../electron/sheets-connector";

describe("normalizeSpreadsheetId", () => {
  it("스프레드시트 URL 에서 ID 를 뽑는다", () => {
    expect(
      normalizeSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBd/edit#gid=0",
      ),
    ).toBe("1BxiMVs0XRA5nFMdKvBd");
  });

  it("이미 ID 면 그대로 통과시킨다", () => {
    expect(normalizeSpreadsheetId(" 1BxiMVs0XRA5nFMdKvBd ")).toBe(
      "1BxiMVs0XRA5nFMdKvBd",
    );
  });

  it("판정할 수 없으면 빈 문자열이다 — 추측해서 404 를 만들지 않는다", () => {
    expect(
      normalizeSpreadsheetId("https://docs.google.com/document/d/AAA"),
    ).toBe("");
    expect(normalizeSpreadsheetId("내 시트")).toBe("");
    expect(normalizeSpreadsheetId(undefined)).toBe("");
  });
});

describe("buildSheetsValuesUrl", () => {
  it("범위를 비우면 첫 시트 A:Z 를 본다", () => {
    const url = buildSheetsValuesUrl({ spreadsheetId: "SID" });
    expect(url).toContain("/v4/spreadsheets/SID/values/A%3AZ");
    expect(url).toContain("majorDimension=ROWS");
  });

  it("공백·한글이 든 시트 이름을 인코딩한다", () => {
    const url = buildSheetsValuesUrl({
      spreadsheetId: "SID",
      range: "설문지 응답 시트1!A:C",
    });
    expect(url).toContain(encodeURIComponent("설문지 응답 시트1!A:C"));
  });

  it("스프레드시트가 없으면 던진다", () => {
    expect(() => buildSheetsValuesUrl({ spreadsheetId: "" })).toThrow();
  });

  it("normalizeSheetsRange 는 공백을 기본값으로 되돌린다", () => {
    expect(normalizeSheetsRange("   ")).toBe("A:Z");
    expect(normalizeSheetsRange("Sheet1!A:B")).toBe("Sheet1!A:B");
  });
});

describe("parseSheetsValuesResult", () => {
  it("숫자·불리언 셀도 문자열로 정규화하고 들쭉날쭉한 행을 견딘다", () => {
    expect(
      parseSheetsValuesResult({
        range: "Sheet1!A1:C3",
        values: [["a", 1, true], ["b"], "쓰레기"],
      }),
    ).toEqual({
      range: "Sheet1!A1:C3",
      rows: [["a", "1", "true"], ["b"], []],
    });
  });

  it("values 가 없으면 빈 행 목록이다", () => {
    expect(parseSheetsValuesResult({}).rows).toEqual([]);
  });
});

describe("sheetsErrorMessage", () => {
  it("403 은 스코프와 API 활성화를 함께 지목한다", () => {
    const message = sheetsErrorMessage(403, {
      error: { message: "Google Sheets API has not been used" },
    });
    expect(message).toContain("권한");
    expect(message).toContain("활성화");
  });

  it("401 은 재연결로, 429 는 폴링 간격으로 유도한다", () => {
    expect(sheetsErrorMessage(401, null)).toContain("다시 연결");
    expect(sheetsErrorMessage(429, null)).toContain("폴링 간격");
    expect(sheetsErrorMessage(404, null)).toContain("찾을 수 없습니다");
  });
});

describe("createSheetsConnector", () => {
  it("토큰은 Authorization 헤더로만 보낸다", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const connector = createSheetsConnector({
      getAccessToken: async () => "TOKEN",
      fetchImpl: async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => ({ range: "Sheet1!A1:B2", values: [["a", "b"]] }),
        } as unknown as Response;
      },
    });

    const result = await connector.getValues({ spreadsheetId: "SID" });
    expect(result.rows).toEqual([["a", "b"]]);
    expect(seenHeaders.Authorization).toBe("Bearer TOKEN");
    expect(seenUrl).not.toContain("TOKEN");
  });

  it("HTTP 오류는 사람이 읽을 문구를 단 SheetsApiError 로 올라온다", async () => {
    const connector = createSheetsConnector({
      getAccessToken: async () => "TOKEN",
      fetchImpl: async () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({ error: { message: "denied" } }),
        }) as unknown as Response,
    });
    await expect(connector.getValues({ spreadsheetId: "SID" })).rejects.toThrow(
      /활성화/,
    );
  });
});

// ── 판정 규칙 ─────────────────────────────────────────────────────────────

function rows(...values: string[][]): string[][] {
  return values;
}

describe("detectNewSheetRows", () => {
  it("★첫 폴링은 커서만 잡고 한 행도 발화하지 않는다", () => {
    // 이게 없으면 조건을 켜는 순간 기존 행 전부가 오케에 쏟아진다.
    const detection = detectNewSheetRows(
      null,
      rows(["헤더"], ["기존1"], ["기존2"], ["기존3"]),
    );
    expect(detection.newRows).toEqual([]);
    expect(detection.cursor.rowCount).toBe(4);
  });

  it("행이 추가되면 그 행만 발화한다", () => {
    const first = detectNewSheetRows(null, rows(["h"], ["a"], ["b"]));
    const second = detectNewSheetRows(
      first.cursor,
      rows(["h"], ["a"], ["b"], ["c"]),
    );
    expect(second.newRows).toEqual([{ rowNumber: 4, values: ["c"] }]);
    expect(second.header).toEqual(["h"]);
    expect(second.truncated).toBe(false);
  });

  it("★행을 지운 뒤 추가해도 놓치지 않는다 (행 개수 비교만 하면 놓친다)", () => {
    // 개수만 보면 3 → 2 → 3 이라 마지막에 "그대로" 로 보이고 새 행을 놓친다.
    const first = detectNewSheetRows(null, rows(["h"], ["a"], ["b"]));
    expect(first.cursor.rowCount).toBe(3);

    // 사용자가 가운데 행을 지운다 — 발화하지 않고 커서만 되돌린다.
    const afterDelete = detectNewSheetRows(first.cursor, rows(["h"], ["b"]));
    expect(afterDelete.newRows).toEqual([]);
    expect(afterDelete.cursor.rowCount).toBe(2);

    // 그리고 새 행이 붙는다 — 이번엔 발화해야 한다.
    const afterAppend = detectNewSheetRows(
      afterDelete.cursor,
      rows(["h"], ["b"], ["c"]),
    );
    expect(afterAppend.newRows).toEqual([{ rowNumber: 3, values: ["c"] }]);
  });

  it("셀을 고치기만 하면 발화하지 않는다", () => {
    // 지문은 바뀌지만 행 수가 그대로다 — "새 행" 이 아니므로 오케를 깨우지 않는다.
    const first = detectNewSheetRows(null, rows(["h"], ["a"], ["b"]));
    const edited = detectNewSheetRows(
      first.cursor,
      rows(["h"], ["a"], ["b 수정됨"]),
    );
    expect(edited.newRows).toEqual([]);
    expect(edited.cursor.fingerprints[sheetRowFingerprint(["b 수정됨"])]).toBe(
      1,
    );
  });

  it("행 재정렬은 발화하지 않는다", () => {
    const first = detectNewSheetRows(null, rows(["a"], ["b"], ["c"]));
    const reordered = detectNewSheetRows(
      first.cursor,
      rows(["c"], ["a"], ["b"]),
    );
    expect(reordered.newRows).toEqual([]);
  });

  it("가운데 삽입도 새 행으로 잡는다", () => {
    const first = detectNewSheetRows(null, rows(["h"], ["a"], ["c"]));
    const inserted = detectNewSheetRows(
      first.cursor,
      rows(["h"], ["a"], ["b"], ["c"]),
    );
    expect(inserted.newRows).toEqual([{ rowNumber: 3, values: ["b"] }]);
  });

  it("같은 내용의 행이 다시 들어오면 두 번째만 새 행이다", () => {
    // 폼 중복 제출. 다중집합이라 내용이 같아도 추가분을 잡아낸다.
    const first = detectNewSheetRows(null, rows(["h"], ["김철수"]));
    const duplicated = detectNewSheetRows(
      first.cursor,
      rows(["h"], ["김철수"], ["김철수"]),
    );
    expect(duplicated.newRows).toEqual([{ rowNumber: 3, values: ["김철수"] }]);
  });

  it("빈 행은 행으로 세지 않는다", () => {
    const detection = detectNewSheetRows(
      null,
      rows(["a"], [], ["  ", ""], ["b"]),
    );
    expect(detection.cursor.rowCount).toBe(2);
  });

  it("새 행이 알림 상한을 넘으면 최근 행만 싣고 잘렸음을 드러낸다", () => {
    const first = detectNewSheetRows(null, rows(["h"]));
    const many = [["h"], ...Array.from({ length: 25 }, (_, i) => [`r${i}`])];
    const detection = detectNewSheetRows(first.cursor, many);
    expect(detection.truncated).toBe(true);
    expect(detection.newRows).toHaveLength(MAX_ANNOUNCED_SHEET_ROWS);
    // 잘랐다면 **최근** 것을 남긴다.
    expect(detection.newRows.at(-1)?.values).toEqual(["r24"]);
  });

  it("첫 행 자체가 새 행이면 헤더로 오해하지 않는다", () => {
    const empty: SheetsRowCursor = { rowCount: 0, fingerprints: {} };
    const detection = detectNewSheetRows(empty, rows(["처음 들어온 행"]));
    expect(detection.header).toBeUndefined();
    expect(detection.newRows).toHaveLength(1);
  });

  it("지문은 셀 경계를 구분한다", () => {
    expect(sheetRowFingerprint(["a|b"])).not.toBe(
      sheetRowFingerprint(["a", "b"]),
    );
  });
});

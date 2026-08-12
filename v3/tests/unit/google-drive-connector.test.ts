/**
 * Google Drive 커넥터 — 쿼리 빌더 · 응답 파서 · 본문 취득 전략 (티켓
 * zqNxS9904aeeBEug1uAD).
 *
 * 이 모듈은 electron 을 임포트하지 않는 순수 TS 라 node 환경에서 그대로 돈다.
 * 네트워크는 fake fetch 로 대체하고, 검증 대상은 **우리가 만든 것**(q 문자열,
 * URL, 파싱 결과, 전략 분기)이지 Drive 서버 응답이 아니다.
 */
import { describe, it, expect } from "vitest";
import {
  buildDriveListParams,
  buildDriveQuery,
  createDriveConnector,
  driveErrorMessage,
  driveExportMimeType,
  escapeDriveQueryValue,
  isGoogleNativeMime,
  isTextualMime,
  parseDriveFile,
  parseDriveFileList,
  truncateText,
  DRIVE_FOLDER_MIME,
  type DriveFetchLike,
} from "../../electron/google-drive-connector";

// ── 쿼리 빌더 ──────────────────────────────────────────────────────────────

describe("escapeDriveQueryValue", () => {
  it("홑따옴표를 이스케이프해 쿼리 문자열이 깨지지 않게 한다", () => {
    expect(escapeDriveQueryValue("O'Brien")).toBe("O\\'Brien");
  });

  it("백슬래시를 먼저 이스케이프한다(순서가 뒤바뀌면 이중 이스케이프가 난다)", () => {
    expect(escapeDriveQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });

  it("평범한 값은 그대로 둔다", () => {
    expect(escapeDriveQueryValue("분기 보고서 2026")).toBe("분기 보고서 2026");
  });
});

describe("buildDriveQuery", () => {
  it("조건이 없으면 폴더 제외 + 휴지통 제외만 남는다", () => {
    expect(buildDriveQuery({})).toBe(
      `mimeType != '${DRIVE_FOLDER_MIME}' and trashed = false`,
    );
  });

  it("전문 검색은 fullText contains 로 나간다", () => {
    expect(buildDriveQuery({ text: "온보딩" })).toContain(
      "fullText contains '온보딩'",
    );
  });

  it("파일명 검색은 name contains 로 나간다", () => {
    expect(buildDriveQuery({ nameContains: "회의록" })).toContain(
      "name contains '회의록'",
    );
  });

  it("폴더 한정은 'id' in parents 로 나간다", () => {
    expect(buildDriveQuery({ folderId: "FOLDER1" })).toContain(
      "'FOLDER1' in parents",
    );
  });

  it("MIME 하나는 괄호 없이, 여럿은 OR 그룹으로 묶는다", () => {
    expect(buildDriveQuery({ mimeTypes: ["text/plain"] })).toContain(
      "mimeType = 'text/plain'",
    );
    expect(
      buildDriveQuery({ mimeTypes: ["text/plain", "application/pdf"] }),
    ).toContain("(mimeType = 'text/plain' or mimeType = 'application/pdf')");
  });

  it("includeFolders 면 폴더 제외 절을 빼고, includeTrashed 면 휴지통 절을 뺀다", () => {
    const q = buildDriveQuery({ includeFolders: true, includeTrashed: true });
    expect(q).toBe("");
  });

  it("사용자 입력의 홑따옴표가 쿼리 구조를 흔들지 못한다", () => {
    // 이스케이프가 없으면 `' or trashed = true or '` 같은 절이 주입된다.
    const q = buildDriveQuery({ nameContains: "' or trashed = true or '" });
    expect(q).toContain("name contains '\\' or trashed = true or \\''");
    expect(q).toContain("trashed = false");
  });

  it("공백만 있는 값은 조건으로 치지 않는다", () => {
    expect(buildDriveQuery({ text: "   ", nameContains: "" })).toBe(
      `mimeType != '${DRIVE_FOLDER_MIME}' and trashed = false`,
    );
  });

  it("절 순서는 고정이다(로그 가독성 + 회귀 감지)", () => {
    expect(
      buildDriveQuery({
        text: "a",
        nameContains: "b",
        folderId: "c",
        mimeTypes: ["text/plain"],
      }),
    ).toBe(
      "fullText contains 'a' and name contains 'b' and 'c' in parents and " +
        `mimeType = 'text/plain' and mimeType != '${DRIVE_FOLDER_MIME}' and trashed = false`,
    );
  });
});

describe("buildDriveListParams", () => {
  it("공유 드라이브를 포함하고 최근 수정순으로 정렬한다", () => {
    const params = buildDriveListParams({});
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.get("includeItemsFromAllDrives")).toBe("true");
    expect(params.get("orderBy")).toBe("modifiedTime desc");
  });

  it("pageSize 를 1..100 으로 클램프하고 기본값은 25 다", () => {
    expect(buildDriveListParams({}).get("pageSize")).toBe("25");
    expect(buildDriveListParams({ pageSize: 0 }).get("pageSize")).toBe("25");
    expect(buildDriveListParams({ pageSize: 5000 }).get("pageSize")).toBe(
      "100",
    );
    expect(buildDriveListParams({ pageSize: 7.9 }).get("pageSize")).toBe("7");
  });

  it("pageToken 은 있을 때만 실린다", () => {
    expect(buildDriveListParams({}).has("pageToken")).toBe(false);
    expect(buildDriveListParams({ pageToken: "NEXT" }).get("pageToken")).toBe(
      "NEXT",
    );
  });

  it("필터가 하나도 없으면 q 파라미터 자체를 빼고 보낸다", () => {
    expect(
      buildDriveListParams({ includeFolders: true, includeTrashed: true }).has(
        "q",
      ),
    ).toBe(false);
    expect(buildDriveListParams({}).get("q")).toContain("trashed = false");
  });
});

// ── 응답 파서 ──────────────────────────────────────────────────────────────

describe("parseDriveFile", () => {
  it("size 문자열을 숫자로 바꾸고 폴더 여부를 판정한다", () => {
    expect(
      parseDriveFile({
        id: "F1",
        name: "노트.txt",
        mimeType: "text/plain",
        size: "1234",
        modifiedTime: "2026-08-01T00:00:00.000Z",
        parents: ["P1"],
      }),
    ).toEqual({
      id: "F1",
      title: "노트.txt",
      mimeType: "text/plain",
      isFolder: false,
      modifiedTime: "2026-08-01T00:00:00.000Z",
      size: 1234,
      webViewLink: undefined,
      parents: ["P1"],
    });
  });

  it("폴더 MIME 은 isFolder=true 다", () => {
    expect(
      parseDriveFile({ id: "D1", mimeType: DRIVE_FOLDER_MIME })?.isFolder,
    ).toBe(true);
  });

  it("이름 없는 파일도 표시 가능한 제목을 갖는다", () => {
    expect(parseDriveFile({ id: "F1", mimeType: "text/plain" })?.title).toBe(
      "(제목 없음)",
    );
  });

  it("id 나 mimeType 이 없으면 null 이다", () => {
    expect(parseDriveFile({ name: "x", mimeType: "text/plain" })).toBeNull();
    expect(parseDriveFile({ id: "F1", name: "x" })).toBeNull();
    expect(parseDriveFile(null)).toBeNull();
    expect(parseDriveFile("nope")).toBeNull();
  });

  it("숫자가 아닌 size 는 undefined 로 떨어뜨린다", () => {
    expect(
      parseDriveFile({ id: "F1", mimeType: "text/plain", size: "big" })?.size,
    ).toBeUndefined();
  });
});

describe("parseDriveFileList", () => {
  it("깨진 항목만 버리고 나머지를 살린다", () => {
    const parsed = parseDriveFileList({
      nextPageToken: "T2",
      files: [
        { id: "A", name: "a", mimeType: "text/plain" },
        { name: "손상됨" },
        { id: "B", name: "b", mimeType: "application/pdf" },
      ],
    });
    expect(parsed.files.map((f) => f.id)).toEqual(["A", "B"]);
    expect(parsed.nextPageToken).toBe("T2");
  });

  it("files 가 없거나 응답이 이상해도 빈 목록으로 답한다(throw 금지)", () => {
    expect(parseDriveFileList({}).files).toEqual([]);
    expect(parseDriveFileList(null).files).toEqual([]);
    expect(parseDriveFileList([1, 2]).files).toEqual([]);
  });
});

describe("driveErrorMessage", () => {
  it("401 은 재연결로 유도한다", () => {
    expect(driveErrorMessage(401, {})).toContain("다시 연결");
  });

  it("403 accessNotConfigured 는 'API 활성화' 로, 일반 403 과 구분한다", () => {
    const apiOff = driveErrorMessage(403, {
      error: {
        message: "Drive API has not been used",
        errors: [{ reason: "accessNotConfigured" }],
      },
    });
    expect(apiOff).toContain("Drive API");
    expect(apiOff).toContain("활성화");

    const denied = driveErrorMessage(403, {
      error: { message: "The user does not have permission" },
    });
    expect(denied).toContain("권한이 없습니다");
    expect(denied).not.toContain("활성화");
  });

  it("429 와 403 rateLimitExceeded 는 같은 '한도 초과' 안내다", () => {
    expect(driveErrorMessage(429, {})).toContain("한도");
    expect(
      driveErrorMessage(403, {
        error: { errors: [{ reason: "rateLimitExceeded" }] },
      }),
    ).toContain("한도");
  });

  it("모르는 상태코드는 코드를 숨기지 않는다", () => {
    expect(driveErrorMessage(500, null)).toContain("HTTP 500");
  });
});

// ── 본문 취득 전략 ─────────────────────────────────────────────────────────

describe("driveExportMimeType", () => {
  it("Docs/Slides 는 text/plain, Sheets 는 text/csv 로 내보낸다", () => {
    expect(driveExportMimeType("application/vnd.google-apps.document")).toBe(
      "text/plain",
    );
    expect(
      driveExportMimeType("application/vnd.google-apps.presentation"),
    ).toBe("text/plain");
    expect(driveExportMimeType("application/vnd.google-apps.spreadsheet")).toBe(
      "text/csv",
    );
  });

  it("텍스트로 의미 없는 네이티브 형식은 지원하지 않는다", () => {
    expect(
      driveExportMimeType("application/vnd.google-apps.drawing"),
    ).toBeNull();
    expect(driveExportMimeType("application/vnd.google-apps.form")).toBeNull();
    expect(driveExportMimeType(DRIVE_FOLDER_MIME)).toBeNull();
  });
});

describe("isGoogleNativeMime / isTextualMime", () => {
  it("네이티브 판정", () => {
    expect(isGoogleNativeMime("application/vnd.google-apps.document")).toBe(
      true,
    );
    expect(isGoogleNativeMime("application/pdf")).toBe(false);
  });

  it("charset 파라미터가 붙어도 텍스트로 본다", () => {
    expect(isTextualMime("text/markdown; charset=utf-8")).toBe(true);
    expect(isTextualMime("application/json")).toBe(true);
    expect(isTextualMime("image/png")).toBe(false);
    expect(isTextualMime("application/pdf")).toBe(false);
  });
});

describe("truncateText", () => {
  it("상한 이하는 그대로, 초과는 잘리고 사실을 알린다", () => {
    expect(truncateText("abcdef", 10)).toEqual({
      text: "abcdef",
      truncated: false,
    });
    expect(truncateText("abcdef", 3)).toEqual({ text: "abc", truncated: true });
  });
});

// ── 커넥터(가짜 fetch) ─────────────────────────────────────────────────────

interface FakeRoute {
  status?: number;
  json?: unknown;
  body?: Buffer;
}

/** 호출 URL 을 기록하는 fake fetch. 매칭은 URL substring 으로 한다. */
function fakeFetch(routes: Array<[string, FakeRoute]>): {
  fetchImpl: DriveFetchLike;
  calls: Array<{ url: string; authorization?: string }>;
} {
  const calls: Array<{ url: string; authorization?: string }> = [];
  const fetchImpl: DriveFetchLike = async (url, init) => {
    calls.push({ url, authorization: init?.headers?.Authorization });
    const route = routes.find(([needle]) => url.includes(needle))?.[1];
    if (!route) throw new Error(`unmatched url: ${url}`);
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.json,
      arrayBuffer: async () =>
        (route.body ?? Buffer.alloc(0)).buffer.slice(
          (route.body ?? Buffer.alloc(0)).byteOffset,
          (route.body ?? Buffer.alloc(0)).byteOffset +
            (route.body ?? Buffer.alloc(0)).byteLength,
        ),
    } as unknown as Response;
  };
  return { fetchImpl, calls };
}

const META = (over: Record<string, unknown> = {}) => ({
  id: "F1",
  name: "문서",
  mimeType: "text/plain",
  ...over,
});

describe("createDriveConnector", () => {
  it("access token 은 Authorization 헤더로만 가고 URL 에 절대 안 실린다", async () => {
    const { fetchImpl, calls } = fakeFetch([
      ["/drive/v3/files?", { json: { files: [META()] } }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "SECRET-TOKEN",
      fetchImpl,
    });
    await connector.search({ text: "hi" });
    expect(calls[0].authorization).toBe("Bearer SECRET-TOKEN");
    expect(calls[0].url).not.toContain("SECRET-TOKEN");
  });

  it("search 는 실제로 보낸 q 를 함께 돌려준다(감사 가능성)", async () => {
    const { fetchImpl } = fakeFetch([
      ["/drive/v3/files?", { json: { files: [META()], nextPageToken: "N" } }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    const result = await connector.search({ nameContains: "회의" });
    expect(result.files).toHaveLength(1);
    expect(result.nextPageToken).toBe("N");
    expect(result.query).toContain("name contains '회의'");
  });

  it("Google Docs 는 files.export?mimeType=text/plain 으로 본문을 받는다", async () => {
    const { fetchImpl, calls } = fakeFetch([
      ["/export?", { body: Buffer.from("문서 본문입니다", "utf8") }],
      [
        "/drive/v3/files/F1?",
        { json: META({ mimeType: "application/vnd.google-apps.document" }) },
      ],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    const doc = await connector.fetchDocument("F1");
    expect(doc.extraction).toBe("export");
    expect(doc.text).toBe("문서 본문입니다");
    expect(calls[1].url).toContain("mimeType=text%2Fplain");
  });

  it("Sheets 는 CSV 로 내보낸다", async () => {
    const { fetchImpl, calls } = fakeFetch([
      ["/export?", { body: Buffer.from("a,b\n1,2", "utf8") }],
      [
        "/drive/v3/files/F1?",
        { json: META({ mimeType: "application/vnd.google-apps.spreadsheet" }) },
      ],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    const doc = await connector.fetchDocument("F1");
    expect(doc.text).toBe("a,b\n1,2");
    expect(calls[1].url).toContain("mimeType=text%2Fcsv");
  });

  it("일반 텍스트 파일은 alt=media 로 받는다", async () => {
    const { fetchImpl, calls } = fakeFetch([
      ["alt=media", { body: Buffer.from("plain body", "utf8") }],
      ["/drive/v3/files/F1?", { json: META({ mimeType: "text/markdown" }) }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    const doc = await connector.fetchDocument("F1");
    expect(doc.extraction).toBe("download");
    expect(doc.text).toBe("plain body");
    expect(calls[1].url).toContain("alt=media");
  });

  it("PDF 는 주입된 추출기를 쓰고, 텍스트 레이어가 없으면 그 사실을 값으로 남긴다", async () => {
    const routes: Array<[string, FakeRoute]> = [
      ["alt=media", { body: Buffer.from("%PDF-1.4", "binary") }],
      ["/drive/v3/files/F1?", { json: META({ mimeType: "application/pdf" }) }],
    ];

    const withText = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl: fakeFetch(routes).fetchImpl,
      extractPdfText: () => ({ text: "PDF 안의 글", empty: false }),
    });
    const ok = await withText.fetchDocument("F1");
    expect(ok.extraction).toBe("pdf");
    expect(ok.text).toBe("PDF 안의 글");

    const scanned = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl: fakeFetch(routes).fetchImpl,
      extractPdfText: () => ({ text: "", empty: true }),
    });
    const none = await scanned.fetchDocument("F1");
    expect(none.extraction).toBe("pdf-no-text");
    expect(none.text).toBe("");
  });

  it("이미지처럼 텍스트로 못 바꾸는 형식은 다운로드조차 하지 않는다", async () => {
    const { fetchImpl, calls } = fakeFetch([
      ["/drive/v3/files/F1?", { json: META({ mimeType: "image/png" }) }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    const doc = await connector.fetchDocument("F1");
    expect(doc.extraction).toBe("unsupported");
    expect(doc.text).toBe("");
    // 메타 조회 1회뿐 — 쓸데없는 바이트 전송이 없다.
    expect(calls).toHaveLength(1);
  });

  it("변환 불가한 네이티브 형식(도면)도 unsupported 다", async () => {
    const { fetchImpl } = fakeFetch([
      [
        "/drive/v3/files/F1?",
        { json: META({ mimeType: "application/vnd.google-apps.drawing" }) },
      ],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    expect((await connector.fetchDocument("F1")).extraction).toBe(
      "unsupported",
    );
  });

  it("상한을 넘는 본문은 잘리고 truncated 로 알린다", async () => {
    const { fetchImpl } = fakeFetch([
      ["alt=media", { body: Buffer.from("0123456789", "utf8") }],
      ["/drive/v3/files/F1?", { json: META({ mimeType: "text/plain" }) }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
      maxContentBytes: 4,
    });
    const doc = await connector.fetchDocument("F1");
    expect(doc.text).toBe("0123");
    expect(doc.truncated).toBe(true);
  });

  it("HTTP 실패는 사용자 문구를 가진 DriveApiError 로 올라온다", async () => {
    const { fetchImpl } = fakeFetch([
      ["/drive/v3/files?", { status: 401, json: { error: { message: "x" } } }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    await expect(connector.search({})).rejects.toThrow(/다시 연결/);
  });

  it("파일 id 는 URL 인코딩된다(경로 조작 방지)", async () => {
    const { fetchImpl, calls } = fakeFetch([
      ["/drive/v3/files/", { json: META() }],
    ]);
    const connector = createDriveConnector({
      getAccessToken: async () => "t",
      fetchImpl,
    });
    await connector.getFileMeta("a/../b");
    expect(calls[0].url).toContain("/files/a%2F..%2Fb?");
  });
});

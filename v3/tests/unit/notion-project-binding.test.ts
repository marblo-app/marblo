import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  NotionProjectBindingStore,
  isValidNotionObjectId,
} from "../../electron/notion-project-binding";

let storeDir: string;
let store: NotionProjectBindingStore;

beforeEach(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-notion-binding-"));
  store = new NotionProjectBindingStore({ storeDir });
});

afterEach(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("isValidNotionObjectId", () => {
  it("하이픈 유무와 관계없이 Notion UUID 형태를 받는다", () => {
    expect(isValidNotionObjectId("123456781234123412341234567890ab")).toBe(
      true,
    );
    expect(isValidNotionObjectId("12345678-1234-1234-1234-1234567890ab")).toBe(
      true,
    );
  });

  it("경로나 쿼리처럼 해석될 값을 거절한다", () => {
    expect(isValidNotionObjectId("../../secret")).toBe(false);
    expect(isValidNotionObjectId("1234")).toBe(false);
    expect(isValidNotionObjectId(42)).toBe(false);
  });
});

describe("NotionProjectBindingStore", () => {
  it("프로젝트별 DB/페이지 바인딩을 분리 저장한다", () => {
    store.set({
      projectId: "project-a",
      objectId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      objectKind: "database",
      title: "A wiki",
    });
    store.set({
      projectId: "project-b",
      objectId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      objectKind: "page",
      title: "B wiki",
    });

    expect(store.get("project-a")?.objectKind).toBe("database");
    expect(store.get("project-a")?.objectId).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(store.get("project-b")?.objectKind).toBe("page");

    store.clear("project-a");
    expect(store.get("project-a")).toBeNull();
    expect(store.get("project-b")?.objectId).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  it("깨진 레코드는 읽지 않는다", () => {
    fs.mkdirSync(path.dirname(store.getFilePath()), { recursive: true });
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        good: {
          projectId: "good",
          objectId: "cccccccccccccccccccccccccccccccc",
          objectKind: "database",
        },
        bad: {
          projectId: "bad",
          objectId: "not-an-id",
          objectKind: "page",
        },
      }),
    );
    expect(store.get("good")?.objectKind).toBe("database");
    expect(store.get("bad")).toBeNull();
  });
});

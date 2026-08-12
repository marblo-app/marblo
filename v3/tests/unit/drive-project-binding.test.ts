/**
 * 프로젝트↔Drive 위키 폴더 바인딩 저장소 — 티켓 MCTHALmNAWPpilTFwe8o.
 *
 * 이 테스트가 지키는 명제는 하나다: **프로젝트마다 다른 폴더를 갖고, 서로의
 * 값을 절대 보지 않는다.** 그게 깨지면 위키가 남의 문서를 읽는다.
 *
 * electron 을 임포트하지 않는다(시크릿이 없어 safeStorage 를 쓰지 않는 설계) —
 * node 환경에서 storeDir 만 주입해 그대로 돈다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DriveProjectBindingStore,
  isValidDriveFolderId,
} from "../../electron/drive-project-binding";

let storeDir: string;
let store: DriveProjectBindingStore;

beforeEach(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-drive-binding-"));
  store = new DriveProjectBindingStore({ storeDir });
});

afterEach(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("isValidDriveFolderId", () => {
  it("Drive id 형태를 받는다", () => {
    expect(isValidDriveFolderId("1A2b3C4d5E6f7G8h9I0j")).toBe(true);
    expect(isValidDriveFolderId("abc_DEF-123456789")).toBe(true);
  });

  it("쿼리를 깰 수 있는 문자를 거절한다(스코프 우회의 첫 관문)", () => {
    expect(isValidDriveFolderId("folder' or '1'='1")).toBe(false);
    expect(isValidDriveFolderId("../../etc/passwd")).toBe(false);
    expect(isValidDriveFolderId("short")).toBe(false);
    expect(isValidDriveFolderId("")).toBe(false);
    expect(isValidDriveFolderId(42)).toBe(false);
  });
});

describe("DriveProjectBindingStore", () => {
  it("바인딩이 없으면 null 이다(미바인딩과 '드라이브 전체'는 다르다)", () => {
    expect(store.get("project-a")).toBeNull();
  });

  it("저장하고 다시 읽는다", () => {
    const saved = store.set({
      projectId: "project-a",
      folderId: "folderAAAAAAAAAAAA",
      folderName: "A 팀 위키",
    });
    expect(saved.folderId).toBe("folderAAAAAAAAAAAA");

    const loaded = store.get("project-a");
    expect(loaded?.folderId).toBe("folderAAAAAAAAAAAA");
    expect(loaded?.folderName).toBe("A 팀 위키");
    expect(loaded?.updatedAt).toBeGreaterThan(0);
  });

  it("★프로젝트 A/B 가 서로 다른 폴더를 갖고 교차 오염되지 않는다", () => {
    store.set({
      projectId: "project-a",
      folderId: "folderAAAAAAAAAAAA",
      folderName: "A 위키",
    });
    store.set({
      projectId: "project-b",
      folderId: "folderBBBBBBBBBBBB",
      folderName: "B 위키",
    });

    expect(store.get("project-a")?.folderId).toBe("folderAAAAAAAAAAAA");
    expect(store.get("project-b")?.folderId).toBe("folderBBBBBBBBBBBB");

    // A 를 바꿔도 B 는 그대로다.
    store.set({ projectId: "project-a", folderId: "folderA2AAAAAAAAAA" });
    expect(store.get("project-a")?.folderId).toBe("folderA2AAAAAAAAAA");
    expect(store.get("project-b")?.folderId).toBe("folderBBBBBBBBBBBB");

    // A 를 해제해도 B 는 살아 있다.
    expect(store.clear("project-a")).toBe(true);
    expect(store.get("project-a")).toBeNull();
    expect(store.get("project-b")?.folderId).toBe("folderBBBBBBBBBBBB");
  });

  it("clear 는 멱등이다", () => {
    expect(store.clear("project-a")).toBe(false);
    store.set({ projectId: "project-a", folderId: "folderAAAAAAAAAAAA" });
    expect(store.clear("project-a")).toBe(true);
    expect(store.clear("project-a")).toBe(false);
  });

  it("형태가 틀린 folderId 는 저장 자체를 거절한다(조용히 무시하지 않는다)", () => {
    expect(() =>
      store.set({ projectId: "project-a", folderId: "bad id'" }),
    ).toThrow();
    expect(store.get("project-a")).toBeNull();
  });

  it("projectId 가 비면 거절한다", () => {
    expect(() =>
      store.set({ projectId: "  ", folderId: "folderAAAAAAAAAAAA" }),
    ).toThrow();
  });

  it("변조·손상된 레코드는 미바인딩으로 읽는다(잘못된 스코프보다 안전하다)", () => {
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        "project-a": { projectId: "project-a", folderId: "'; drop --" },
        "project-b": { projectId: "project-b", folderId: 123 },
        "project-c": {
          projectId: "project-c",
          folderId: "folderCCCCCCCCCCCC",
        },
      }),
    );
    expect(store.get("project-a")).toBeNull();
    expect(store.get("project-b")).toBeNull();
    expect(store.get("project-c")?.folderId).toBe("folderCCCCCCCCCCCC");
  });

  it("★내 칸을 저장해도 다른 프로젝트의 깨진 레코드를 지우지 않는다", () => {
    // 격리를 목적으로 하는 저장소가 프로젝트 간 쓰기 결합을 만들면 안 된다 —
    // A 가 저장할 때마다 B 의 (고칠 수 있었을) 레코드가 사라지는 건 사고다.
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        "project-b": { projectId: "project-b", folderId: "깨진값" },
      }),
    );
    store.set({ projectId: "project-a", folderId: "folderAAAAAAAAAAAA" });

    const raw = JSON.parse(fs.readFileSync(store.getFilePath(), "utf-8"));
    expect(Object.keys(raw).sort()).toEqual(["project-a", "project-b"]);
    // 여전히 못 읽는 값이지만, 남의 칸을 우리가 없애지는 않았다.
    expect(store.get("project-b")).toBeNull();
  });

  it("깨진 JSON 은 빈 저장소로 읽고 throw 하지 않는다", () => {
    fs.writeFileSync(store.getFilePath(), "{ not json");
    expect(store.get("project-a")).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("파일 권한을 0600 으로 좁힌다(어느 폴더를 보는지는 사생활이다)", () => {
    store.set({ projectId: "project-a", folderId: "folderAAAAAAAAAAAA" });
    const mode = fs.statSync(store.getFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("폴더명은 없으면 null 이고, 지나치게 길면 잘린다(표시용 캐시일 뿐)", () => {
    store.set({ projectId: "project-a", folderId: "folderAAAAAAAAAAAA" });
    expect(store.get("project-a")?.folderName).toBeNull();

    store.set({
      projectId: "project-b",
      folderId: "folderBBBBBBBBBBBB",
      folderName: "가".repeat(500),
    });
    expect(store.get("project-b")?.folderName?.length).toBe(200);
  });
});

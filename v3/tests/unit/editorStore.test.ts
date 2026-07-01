import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", {});

const { useEditorStore } = await import("../../src/stores/editorStore");

/**
 * 데이터 유실 버그(티켓 slwUG7cIDwrN9xAzoTwe) 회귀 가드.
 *
 * 증상: 코드에디터에서 파일을 편집하고 Cmd+S 해도 디스크에 저장이 안 됨.
 *
 * 근본원인(런타임 추적): @monaco-editor/react 는 onMount 를 인스턴스당 딱 1회만
 * 호출하고, CodeTab 은 <CodeEditor> 를 파일별 key 없이 렌더 + path prop 미전달 →
 * 단일 monaco model 을 모든 파일이 재사용한다. 그래서 Cmd+S 액션 클로저가 "처음
 * 연 파일"의 filePath 를 영구 캡처 → 다른 파일로 전환 후 Cmd+S 하면
 * saveFile(staleFilePath) 가 불리고, 그 파일은 isModified=false 라 아래 store 의
 * 조기 return 에 걸려 writeFile 자체가 호출되지 않는다(디스크 write 안 일어남).
 *
 * 이 테스트는 그 store-level 결과(유실 메커니즘)를 결정적으로 재현하고, 올바른
 * 활성 경로로 저장하면 실제로 디스크에 기록됨을 함께 고정한다. 클로저 자체의
 * 수정(ref-to-latest)은 CodeEditor.tsx 에서 이뤄진다.
 */

type FsMock = {
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
};

function installFs(): FsMock {
  const fs: FsMock = {
    readFile: vi.fn(async (p: string) => `content-of:${p}`),
    writeFile: vi.fn(async () => undefined),
  };
  (window as unknown as { electronAPI: { fs: FsMock } }).electronAPI = { fs };
  return fs;
}

beforeEach(() => {
  useEditorStore.setState({
    rootPath: null,
    openFiles: [],
    activeFilePath: null,
    showDiff: false,
    saveError: null,
  });
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe("editorStore.saveFile — 데이터 유실 재현", () => {
  it("stale(=미수정) 경로로 저장 호출하면 writeFile 이 안 불린다 (유실 메커니즘)", async () => {
    const fs = installFs();
    const store = useEditorStore.getState;

    // 파일 A 열고, 이어서 .env 열기
    await store().openFile("/repo/a.ts");
    await store().openFile("/repo/.env");

    // 화면(.env)을 편집 → .env 만 isModified=true
    store().updateContent("/repo/.env", "SECRET=edited");

    // 버그: Cmd+S 액션이 캡처한 stale 경로(a.ts)로 저장이 불린다
    await store().saveFile("/repo/a.ts");

    // a.ts 는 수정된 적 없음 → 조기 return → 디스크 write 자체가 안 일어남
    expect(fs.writeFile).not.toHaveBeenCalled();

    // .env 의 편집분은 여전히 메모리에만 있고 디스크엔 안 감 = 재시작 시 유실
    const env = store().openFiles.find((f) => f.path === "/repo/.env");
    expect(env?.isModified).toBe(true);
  });

  it("올바른 활성 경로로 저장하면 실제 디스크에 기록되고 isModified 가 해제된다", async () => {
    const fs = installFs();
    const store = useEditorStore.getState;

    await store().openFile("/repo/a.ts");
    await store().openFile("/repo/.env");
    store().updateContent("/repo/.env", "SECRET=edited");

    // 수정본은 올바른 경로로 저장 (fix 후 Cmd+S 가 하는 일)
    await store().saveFile("/repo/.env");

    expect(fs.writeFile).toHaveBeenCalledWith("/repo/.env", "SECRET=edited");
    const env = store().openFiles.find((f) => f.path === "/repo/.env");
    expect(env?.isModified).toBe(false);
    expect(env?.originalContent).toBe("SECRET=edited");
  });
});

describe("editorStore.saveFile — 저장 실패 표시", () => {
  it("writeFile 이 throw 하면 saveError 를 세팅해 조용히 넘어가지 않는다", async () => {
    const fs = installFs();
    fs.writeFile.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const store = useEditorStore.getState;

    await store().openFile("/repo/.env");
    store().updateContent("/repo/.env", "SECRET=edited");
    await store().saveFile("/repo/.env");

    const err = store().saveError;
    expect(err).not.toBeNull();
    expect(err?.path).toBe("/repo/.env");
    expect(err?.name).toBe(".env");
    expect(err?.message).toContain("EACCES");

    // 실패했으므로 여전히 미저장 상태로 남아야 한다
    const env = store().openFiles.find((f) => f.path === "/repo/.env");
    expect(env?.isModified).toBe(true);
  });

  it("이후 저장이 성공하면 saveError 가 지워진다", async () => {
    const fs = installFs();
    fs.writeFile.mockRejectedValueOnce(new Error("EACCES"));
    const store = useEditorStore.getState;

    await store().openFile("/repo/.env");
    store().updateContent("/repo/.env", "v1");
    await store().saveFile("/repo/.env");
    expect(store().saveError).not.toBeNull();

    store().updateContent("/repo/.env", "v2");
    await store().saveFile("/repo/.env");
    expect(store().saveError).toBeNull();
    expect(fs.writeFile).toHaveBeenLastCalledWith("/repo/.env", "v2");
  });

  it("clearSaveError 로 수동 해제할 수 있다", async () => {
    const fs = installFs();
    fs.writeFile.mockRejectedValueOnce(new Error("EACCES"));
    const store = useEditorStore.getState;

    await store().openFile("/repo/.env");
    store().updateContent("/repo/.env", "v1");
    await store().saveFile("/repo/.env");
    expect(store().saveError).not.toBeNull();

    store().clearSaveError();
    expect(store().saveError).toBeNull();
  });
});

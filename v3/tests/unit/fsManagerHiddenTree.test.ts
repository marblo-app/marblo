import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FsManager } from "../../electron/fs-manager";

/**
 * 티켓 D8yiihCWgDMd3AU7xkEy — "폴더를 만들어도 생성이 안 되는 것처럼 보인다".
 *
 * 진범은 리프레시가 아니라 필터였다: `.venv` 는 dotfile 이라, `venv` 는 루트
 * .gitignore 에 있어서 트리에서 통째로 사라졌다. 디스크에는 멀쩡히 있었다.
 */
let root: string;
const fsm = new FsManager();

const names = (nodes: { name: string }[]) => nodes.map((n) => n.name).sort();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tree-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readTree — 기본(showHidden 미지정)은 기존 동작 그대로", () => {
  it("dotfile 과 루트 .gitignore 항목은 감춘다", () => {
    fs.writeFileSync(path.join(root, ".gitignore"), "venv/\n");
    fs.mkdirSync(path.join(root, ".venv"));
    fs.mkdirSync(path.join(root, "venv"));
    fs.mkdirSync(path.join(root, "mydir"));

    expect(names(fsm.readTree(root))).toEqual(["mydir"]);
  });

  it(".env* 는 dotfile 이어도 계속 보인다 (기존 예외 유지)", () => {
    fs.writeFileSync(path.join(root, ".gitignore"), ".env\n");
    fs.writeFileSync(path.join(root, ".env"), "");
    fs.writeFileSync(path.join(root, ".env.local"), "");

    expect(names(fsm.readTree(root))).toEqual([".env", ".env.local"]);
  });

  it("node_modules 등 DEFAULT_IGNORES 는 감춘다", () => {
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.mkdirSync(path.join(root, "src"));

    expect(names(fsm.readTree(root))).toEqual(["src"]);
  });

  it("일반 이름의 새 폴더는 원래도 잘 보였다 (증상은 venv 계열 한정)", () => {
    fs.mkdirSync(path.join(root, "새 폴더"));
    expect(names(fsm.readTree(root))).toEqual(["새 폴더"]);
  });
});

describe("readTree — showHidden 켜면 venv 폴더가 보인다", () => {
  it(".venv 와 gitignore 된 venv 가 모두 나열된다", () => {
    fs.writeFileSync(path.join(root, ".gitignore"), "venv/\n");
    fs.mkdirSync(path.join(root, ".venv"));
    fs.mkdirSync(path.join(root, "venv"));
    fs.mkdirSync(path.join(root, "mydir"));

    expect(names(fsm.readTree(root, { showHidden: true }))).toEqual([
      ".gitignore",
      ".venv",
      "mydir",
      "venv",
    ]);
  });

  it("★드러난 디렉터리는 나열만 하고 재귀하지 않는다 (truncated)", () => {
    // 실제 venv 는 site-packages 밑으로 수만 파일이다. 5초마다 도는 폴링이
    // 그걸 동기 순회하면 메인 프로세스가 죽는다.
    fs.mkdirSync(path.join(root, ".venv", "lib", "python3.12"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, ".venv", "pyvenv.cfg"), "");

    const venv = fsm
      .readTree(root, { showHidden: true })
      .find((n) => n.name === ".venv");
    expect(venv?.truncated).toBe(true);
    expect(venv?.children).toEqual([]);
  });

  it("보이는 디렉터리는 평소대로 재귀한다 (truncated 플래그 없음)", () => {
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });

    const src = fsm
      .readTree(root, { showHidden: true })
      .find((n) => n.name === "src");
    expect(src?.truncated).toBeUndefined();
    expect(names(src?.children ?? [])).toEqual(["components"]);
  });

  it("DEFAULT_IGNORES 는 showHidden 으로도 못 연다 (성능 가드)", () => {
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.mkdirSync(path.join(root, ".git"));

    const listed = names(fsm.readTree(root, { showHidden: true }));
    expect(listed).not.toContain("node_modules");
    expect(listed).not.toContain(".git");
  });

  it("gitignore 는 루트에만 적용된다 (하위 디렉터리 동명 폴더는 영향 없음)", () => {
    fs.writeFileSync(path.join(root, ".gitignore"), "venv/\n");
    fs.mkdirSync(path.join(root, "src", "venv"), { recursive: true });

    const src = fsm.readTree(root).find((n) => n.name === "src");
    expect(names(src?.children ?? [])).toEqual(["venv"]);
  });
});

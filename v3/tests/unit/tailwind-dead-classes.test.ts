/**
 * `bg-gray-750` 은 존재하지 않는 색 단계였다 — 그 사실과 교체값을 **값으로** 고정한다.
 *
 * 티켓 huab99tGnogRGnylItev. Tailwind 기본 팔레트의 gray 스케일은
 * 50·100…900·950 이고 750 단계가 없다. `tailwind.config.js` 에도 정의가 없다.
 * 그래서 `bg-gray-750` 은 **CSS 규칙을 하나도 만들어 내지 않았고**, 그 클래스만으로
 * 배경을 칠하던 자리는 배경 없이, hover 로만 쓰던 자리는 무반응으로 렌더됐다.
 *
 * ★스크린샷 대신 이 테스트로 증명하는 이유: 사람 눈은 몇 px·몇 단계 색차를 못 잡고,
 * 창을 띄우는 검증은 사장님 작업을 방해한다(AGENTS.md "GUI 를 띄우는 검증 금지").
 * 여기서는 실제 Tailwind 컴파일러를 헤드리스로 돌려 **생성된 규칙 자체**를 본다.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import resolveConfig from "tailwindcss/resolveConfig";

const V3 = path.resolve(__dirname, "../..");
const CONFIG = path.join(V3, "tailwind.config.js");

/** 주어진 클래스들만 content 로 넣고 utilities 를 컴파일한다(브라우저 없음). */
async function compile(classes: string[]): Promise<string> {
  const res = await postcss([
    tailwindcss({
      config: CONFIG,
      content: [{ raw: classes.join(" "), extension: "html" }],
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return res.css;
}

/** `.bg-x{...}` / `.hover\:bg-x:hover{...}` 규칙 본문만 정확히 뽑는다. */
function ruleFor(css: string, cls: string): string | null {
  const esc = cls.replace(/[/\\]/g, (m) => "\\\\" + m).replace(/:/g, "\\\\:");
  const re = new RegExp(`\\.${esc}(?::hover)?\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

describe("gray-750 은 정의되지 않은 색 단계다", () => {
  it("resolveConfig 의 gray 스케일에 750 이 없다", () => {
    const cfg = resolveConfig({ content: [], ...require(CONFIG) });
    const gray = cfg.theme?.colors?.gray as Record<string, string>;
    expect(gray, "gray 스케일이 있어야 한다").toBeTruthy();
    expect(Object.keys(gray)).not.toContain("750");
    // 인접 단계는 실재하고, 이 값들이 아래 교체값의 근거다.
    expect(gray["700"]).toBe("#374151");
    expect(gray["800"]).toBe("#1f2937");
  });

  it("bg-gray-750 / hover:bg-gray-750 은 규칙을 만들어 내지 않는다", async () => {
    const css = await compile(["bg-gray-750", "hover:bg-gray-750"]);
    expect(css).not.toContain("gray-750");
    expect(ruleFor(css, "bg-gray-750")).toBeNull();
    expect(ruleFor(css, "hover:bg-gray-750")).toBeNull();
  });

  it("교체값들은 실제로 규칙을 만들고, 800 < 700/50 < 700 순으로 밝아진다", async () => {
    const css = await compile([
      "bg-gray-800",
      "bg-gray-700/50",
      "bg-gray-700",
      "hover:bg-gray-700",
      "hover:bg-gray-700/50",
    ]);
    // 휴지 표면
    expect(ruleFor(css, "bg-gray-800")).toContain("rgb(31 41 55");
    // ★800 과 700 사이 — 원래 "750" 이라는 이름이 의도한 자리.
    expect(ruleFor(css, "bg-gray-700/50")).toBe(
      "background-color: rgb(55 65 81 / 0.5)",
    );
    expect(ruleFor(css, "bg-gray-700")).toContain("rgb(55 65 81");
    // hover 변형도 같은 값으로 실재한다(무반응이 아니다).
    expect(ruleFor(css, "hover:bg-gray-700")).toContain("rgb(55 65 81");
    expect(ruleFor(css, "hover:bg-gray-700/50")).toBe(
      "background-color: rgb(55 65 81 / 0.5)",
    );
  });
});

describe("회귀 가드", () => {
  it("v3/src 에 gray-750 이 남아 있지 않다", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(e.name)) {
          fs.readFileSync(p, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (line.includes("gray-750"))
                hits.push(`${path.relative(V3, p)}:${i + 1}`);
            });
        }
      }
    };
    walk(path.join(V3, "src"));
    expect(hits, `죽은 클래스가 다시 들어왔다:\n${hits.join("\n")}`).toEqual([]);
  });
});

import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildSkillDirective,
  clearSkillRegistryCache,
  isValidSkillName,
  listInstalledSkills,
  normalizeSkillName,
  parseSkillUsageMarkers,
  resolveSkillRouting,
  suggestSkillNames,
  validateSkillsFor,
  vendorForModel,
  withSkillDirective,
} from "../../electron/mcp-server/skill-registry";

// 디스크 실측 모듈이라 진짜 디렉토리를 만들어 검증한다. 사용자 홈은 절대
// 건드리지 않는다 — homeDir/env 를 주입해 tmp 로만 향하게 한다.
let home: string;

function writeSkill(root: string, name: string, description = "test skill") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-skill-registry-"));
  // claude 사용자 스킬
  const claudeSkills = path.join(home, ".claude", "skills");
  writeSkill(claudeSkills, "seo-geo-full");
  writeSkill(claudeSkills, "ga4-full-tagging");
  // 매니페스트 없는 디렉토리는 스킬이 아니다
  fs.mkdirSync(path.join(claudeSkills, "not-a-skill"), { recursive: true });
  // claude 플러그인 스킬 → `plugin:skill`
  writeSkill(
    path.join(
      home,
      ".claude",
      "plugins",
      "cache",
      "superpowers-marketplace",
      "superpowers",
      "4.3.1",
      "skills",
    ),
    "brainstorming",
  );
  // codex 사용자 스킬 + 프리인스톨 .system
  const codexSkills = path.join(home, ".codex", "skills");
  writeSkill(codexSkills, "tf-start");
  writeSkill(path.join(codexSkills, ".system"), "review-agent");
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

afterEach(() => {
  clearSkillRegistryCache();
});

const opts = () => ({ homeDir: home, env: {} as NodeJS.ProcessEnv });

describe("vendorForModel", () => {
  it("claude → claude, gpt/codex → codex (같은 Codex CLI)", () => {
    expect(vendorForModel("claude")).toBe("claude");
    expect(vendorForModel("gpt")).toBe("codex");
    expect(vendorForModel("codex")).toBe("codex");
  });

  it("네이티브 스킬 개념이 없는 벤더는 null — 조용한 무효 대신 차단 신호", () => {
    for (const m of ["gemini", "antigravity", "local", "custom", "", null]) {
      expect(vendorForModel(m)).toBeNull();
    }
  });
});

describe("listInstalledSkills", () => {
  it("claude: 사용자 스킬 + 플러그인 스킬(plugin:skill)을 발견하고, SKILL.md 없는 디렉토리는 제외", () => {
    const names = listInstalledSkills("claude", opts()).map((s) => s.name);
    expect(names).toContain("seo-geo-full");
    expect(names).toContain("ga4-full-tagging");
    expect(names).toContain("superpowers:brainstorming");
    expect(names).not.toContain("not-a-skill");
  });

  it("codex: 사용자 스킬 + .system 프리인스톨을 발견한다", () => {
    const skills = listInstalledSkills("codex", opts());
    expect(skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["tf-start", "review-agent"]),
    );
    expect(skills.find((s) => s.name === "review-agent")?.source).toBe(
      "system",
    );
  });

  it("벤더 간 스킬은 섞이지 않는다 (codex 에 claude 스킬이 보이면 안 됨)", () => {
    const codex = listInstalledSkills("codex", opts()).map((s) => s.name);
    expect(codex).not.toContain("seo-geo-full");
  });

  it("루트가 아예 없어도 던지지 않고 빈 목록", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-skill-none-"));
    try {
      expect(
        listInstalledSkills("claude", { homeDir: empty, env: {} }),
      ).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("CLAUDE_CONFIG_DIR / CODEX_HOME override 를 존중한다", () => {
    const alt = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-skill-alt-"));
    try {
      writeSkill(path.join(alt, "skills"), "alt-only-skill");
      const claude = listInstalledSkills("claude", {
        homeDir: home,
        env: { CLAUDE_CONFIG_DIR: alt } as NodeJS.ProcessEnv,
      }).map((s) => s.name);
      expect(claude).toEqual(["alt-only-skill"]);
      clearSkillRegistryCache();
      const codex = listInstalledSkills("codex", {
        homeDir: home,
        env: { CODEX_HOME: alt } as NodeJS.ProcessEnv,
      }).map((s) => s.name);
      expect(codex).toEqual(["alt-only-skill"]);
    } finally {
      fs.rmSync(alt, { recursive: true, force: true });
    }
  });
});

describe("normalizeSkillName / isValidSkillName", () => {
  it("사람이 쓰는 표기를 호출명으로 접는다", () => {
    expect(normalizeSkillName("/seo-geo-full")).toBe("seo-geo-full");
    expect(normalizeSkillName("  `seo-geo-full`  ")).toBe("seo-geo-full");
    expect(normalizeSkillName("seo-geo-full/")).toBe("seo-geo-full");
  });

  it("경로·셸 메타문자·공백은 문법에서 거부된다 (run_skill 규율 계승)", () => {
    for (const bad of [
      "../../etc/passwd",
      "skill; rm -rf /",
      "skill name",
      "skill$(id)",
      "skill|cat",
      "",
    ]) {
      expect(isValidSkillName(normalizeSkillName(bad))).toBe(false);
    }
    expect(isValidSkillName("superpowers:brainstorming")).toBe(true);
    expect(isValidSkillName("seo-geo-full")).toBe(true);
  });
});

describe("suggestSkillNames", () => {
  it("★사장님이 실제로 말한 오타를 잡는다: seo-geo-optimization → seo-geo-full", () => {
    const installed = listInstalledSkills("claude", opts()).map((s) => s.name);
    expect(suggestSkillNames("seo-geo-optimization", installed)).toContain(
      "seo-geo-full",
    );
  });

  it("완전히 무관한 이름엔 억지 제안을 하지 않는다", () => {
    expect(suggestSkillNames("zzzz-quantum-banana", ["seo-geo-full"])).toEqual(
      [],
    );
  });
});

describe("validateSkillsFor", () => {
  it("설치된 것만 통과시키고, 미설치는 제안과 함께 남긴다", () => {
    const v = validateSkillsFor(
      "claude",
      ["seo-geo-full", "seo-geo-optimization"],
      opts(),
    );
    expect(v.ok).toBe(false);
    expect(v.resolved.map((s) => s.name)).toEqual(["seo-geo-full"]);
    expect(v.missing[0].name).toBe("seo-geo-optimization");
    expect(v.missing[0].suggestions).toContain("seo-geo-full");
  });

  it("대소문자 차이는 통과시키되 설치된 정식명으로 해석한다", () => {
    const v = validateSkillsFor("claude", ["SEO-GEO-FULL"], opts());
    expect(v.ok).toBe(true);
    expect(v.resolved[0].name).toBe("seo-geo-full");
  });
});

describe("resolveSkillRouting — dispatch 게이트", () => {
  it("미지정이면 무동작(전 벤더 허용) — 기존 dispatch 와 무회귀", () => {
    const r = resolveSkillRouting({ skills: [], homeDir: home, env: {} });
    expect(r).toMatchObject({ ok: true, skills: [] });
  });

  it("★오타명은 조용히 무시되지 않고 즉시 실패 + 제안", () => {
    const r = resolveSkillRouting({
      skills: ["/seo-geo-optimization"],
      homeDir: home,
      env: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("seo-geo-optimization");
    expect(r.error).toContain("seo-geo-full");
    expect(r.error).toContain("install-agent-skills.sh");
  });

  it("설치된 벤더만 라우팅 후보로 남는다 (claude 전용 스킬 → claude 만)", () => {
    const r = resolveSkillRouting({
      skills: ["seo-geo-full"],
      homeDir: home,
      env: {},
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.allowedVendors).toEqual(["claude"]);
  });

  it("★명시 모델이 그 스킬을 못 가진 벤더면 스폰 전에 실패한다 (codex + claude전용 스킬)", () => {
    const r = resolveSkillRouting({
      skills: ["seo-geo-full"],
      explicitModel: "gpt",
      homeDir: home,
      env: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("codex");
  });

  it("codex 에 설치된 스킬은 codex 명시 지정으로 통과한다", () => {
    const r = resolveSkillRouting({
      skills: ["tf-start"],
      explicitModel: "codex",
      homeDir: home,
      env: {},
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.allowedVendors).toEqual(["codex"]);
  });

  it("네이티브 스킬이 없는 벤더(antigravity)로 지정하면 조용무효 대신 차단", () => {
    const r = resolveSkillRouting({
      skills: ["seo-geo-full"],
      explicitModel: "antigravity",
      homeDir: home,
      env: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("네이티브");
  });

  it("문법 위반 이름은 디스크를 보기 전에 거부한다", () => {
    const r = resolveSkillRouting({
      skills: ["../../etc/passwd"],
      homeDir: home,
      env: {},
    });
    expect(r.ok).toBe(false);
  });

  it("중복 지정은 접히고, 상한을 넘으면 거부한다", () => {
    const dup = resolveSkillRouting({
      skills: ["seo-geo-full", "SEO-GEO-FULL"],
      homeDir: home,
      env: {},
    });
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.skills).toEqual(["seo-geo-full"]);

    const many = resolveSkillRouting({
      skills: Array.from({ length: 9 }, (_, i) => `skill-${i}`),
      homeDir: home,
      env: {},
    });
    expect(many.ok).toBe(false);
  });
});

describe("지시문 주입", () => {
  it("스킬이 없으면 지시문은 원문 그대로 (byte-identical 무회귀)", () => {
    expect(withSkillDirective("do the thing", [])).toBe("do the thing");
    expect(buildSkillDirective([])).toBe("");
  });

  it("지정 스킬명 + 사용 관측 규약이 지시문 맨 앞에 붙는다", () => {
    const out = withSkillDirective("do the thing", ["seo-geo-full"], {
      taskId: "T1",
    });
    expect(out.startsWith("[지정 스킬")).toBe(true);
    expect(out).toContain("- seo-geo-full");
    expect(out).toContain('add_activity(task_id="T1"');
    expect(out).toContain("[skill] <이름> invoked");
    expect(out.endsWith("do the thing")).toBe(true);
  });
});

describe("parseSkillUsageMarkers — 사용 검증 신호(P4-2)", () => {
  it("invoked / skipped 를 기계적으로 읽어낸다", () => {
    expect(
      parseSkillUsageMarkers("작업 시작\n[skill] seo-geo-full invoked\n끝"),
    ).toEqual([{ name: "seo-geo-full", status: "invoked" }]);

    expect(
      parseSkillUsageMarkers("[skill] tf-start skipped — 이미 생성된 태스크"),
    ).toEqual([
      {
        name: "tf-start",
        status: "skipped",
        detail: "이미 생성된 태스크",
      },
    ]);
  });

  it("스킬 신호가 없는 일반 activity 는 빈 배열", () => {
    expect(parseSkillUsageMarkers("구현 완료: 스킬 얘기 없음")).toEqual([]);
  });
});

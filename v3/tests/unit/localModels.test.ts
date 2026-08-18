/**
 * 스토어 '로컬 모델' 하드웨어 게이트 + ollama 파서 (dRalTvhI4HR2NaAcxn4C).
 *
 * 이 파일이 지키는 것:
 *  1. **게이트 판정** — RAM 충분/부족 분기, ollama 미설치/데몬 정지 분기가
 *     카드 action 하나로 정확히 갈린다(UI 는 이 값만 믿고 그린다).
 *  2. **정직성** — 설치 실측된 모델은 RAM 이 모자라도 installed 로 보인다
 *     (게이트는 신규 다운로드를 막는 것이지 설치 사실을 감추는 것이 아니다).
 *  3. **파서** — `ollama list`/`ollama pull` 출력 해석이 헤더·빈 줄·비진행
 *     라인에 흔들리지 않는다.
 *  4. **카탈로그 위생** — first-party 큐레이션의 형식 불변식(id 중복 금지,
 *     ollama 태그 형태, 양수 크기/RAM).
 */
import { describe, it, expect } from "vitest";
import {
  LOCAL_MODEL_CATALOG,
  catalogEntry,
  evaluateLocalModelCards,
  isLocalChatOnlyModel,
  parseLocalParamBillions,
  parseOllamaListOutput,
  parseOllamaPullProgress,
  resolveLocalToolSupport,
} from "../../electron/local-models";

const OLLAMA_UP = { installed: true, daemonRunning: true };

describe("LOCAL_MODEL_CATALOG (first-party 큐레이션 위생)", () => {
  it("id 는 유일하고 ollama 태그 형태(<name>:<tag>)다", () => {
    const ids = LOCAL_MODEL_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9.-]+:[A-Za-z0-9._-]+$/);
  });

  it("크기·RAM·컨텍스트는 전부 양수이고 RAM 안내 범위가 명확하다", () => {
    for (const e of LOCAL_MODEL_CATALOG) {
      expect(["coding", "general", "reasoning"]).toContain(e.category);
      expect(["코딩 특화", "범용", "추론"]).toContain(e.categoryLabel);
      expect(["chat-only", "tool-use"]).toContain(e.toolSupport);
      expect(["대화 전용", "tool-use 지원"]).toContain(e.toolSupportLabel);
      expect(e.downloadSizeMB).toBeGreaterThan(0);
      expect(e.minRamGB).toBeGreaterThan(0);
      expect(e.minRamGB).toBeLessThanOrEqual(128);
      expect(e.contextTokens).toBeGreaterThan(0);
    }
  });

  it("★소형(<7B)은 대화 전용, 7B+(특히 coder)는 tool-use 지원", () => {
    expect(catalogEntry("qwen2.5:0.5b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("qwen3:4b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("gemma3:4b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("qwen2.5-coder:7b")?.toolSupport).toBe("tool-use");
    expect(catalogEntry("qwen3:8b")?.toolSupport).toBe("tool-use");
    expect(resolveLocalToolSupport("qwen2.5:0.5b")).toBe("chat-only");
    expect(resolveLocalToolSupport("qwen2.5-coder:7b")).toBe("tool-use");
    expect(parseLocalParamBillions("phi3:mini")).toBe(3.8);
    expect(isLocalChatOnlyModel("qwen2.5:0.5b")).toBe(true);
    expect(isLocalChatOnlyModel("qwen2.5-coder:7b")).toBe(false);
  });

  it("Qwen3 최신 대표군은 공식 ollama pull id 와 실측 크기를 가진다", () => {
    expect(catalogEntry("qwen3:0.6b")).toMatchObject({
      displayName: "Qwen 3 0.6B",
      downloadSizeMB: 523,
      minRamGB: 4,
      contextTokens: 40_000,
    });
    expect(catalogEntry("qwen3:4b")).toMatchObject({
      downloadSizeMB: 2_500,
      minRamGB: 8,
      contextTokens: 256_000,
    });
    expect(catalogEntry("qwen3:8b")).toMatchObject({
      downloadSizeMB: 5_200,
      minRamGB: 12,
      contextTokens: 40_000,
    });
    expect(catalogEntry("qwen3:14b")).toMatchObject({
      downloadSizeMB: 9_300,
      minRamGB: 24,
      contextTokens: 40_000,
    });
    expect(catalogEntry("qwen3:30b")).toMatchObject({
      displayName: "Qwen 3 30B-A3B MoE (256K)",
      downloadSizeMB: 19_000,
      minRamGB: 48,
      contextTokens: 256_000,
    });
    expect(catalogEntry("qwen3:32b")).toMatchObject({
      downloadSizeMB: 20_000,
      minRamGB: 48,
      contextTokens: 40_000,
    });
  });

  it("코딩 특화 모델은 공식 ollama pull id 와 실측 크기를 가진다", () => {
    expect(catalogEntry("qwen2.5-coder:7b")).toMatchObject({
      category: "coding",
      categoryLabel: "코딩 특화",
      downloadSizeMB: 4_700,
      minRamGB: 12,
      contextTokens: 32_000,
    });
    expect(catalogEntry("qwen2.5-coder:14b")).toMatchObject({
      category: "coding",
      downloadSizeMB: 9_000,
      minRamGB: 24,
      contextTokens: 32_000,
    });
    expect(catalogEntry("qwen2.5-coder:32b")).toMatchObject({
      category: "coding",
      downloadSizeMB: 20_000,
      minRamGB: 48,
      contextTokens: 32_000,
    });
    expect(catalogEntry("devstral:24b")).toMatchObject({
      category: "coding",
      downloadSizeMB: 14_000,
      minRamGB: 32,
      contextTokens: 128_000,
    });
    expect(catalogEntry("codestral:22b")).toMatchObject({
      category: "coding",
      downloadSizeMB: 13_000,
      minRamGB: 32,
      contextTokens: 32_000,
    });
  });

  it("범용 최신 모델은 공식 ollama pull id 와 실측 크기를 가진다", () => {
    expect(catalogEntry("gemma3:4b")).toMatchObject({
      category: "general",
      categoryLabel: "범용",
      downloadSizeMB: 3_300,
      minRamGB: 8,
      contextTokens: 128_000,
    });
    expect(catalogEntry("gemma3:12b")).toMatchObject({
      downloadSizeMB: 8_100,
      minRamGB: 24,
      contextTokens: 128_000,
    });
    expect(catalogEntry("gemma3:27b")).toMatchObject({
      downloadSizeMB: 17_000,
      minRamGB: 48,
      contextTokens: 128_000,
    });
    expect(catalogEntry("llama3.3:70b")).toMatchObject({
      displayName: "Llama 3.3 70B",
      downloadSizeMB: 43_000,
      minRamGB: 96,
      contextTokens: 128_000,
    });
    expect(catalogEntry("phi4:14b")).toMatchObject({
      downloadSizeMB: 9_100,
      minRamGB: 24,
      contextTokens: 16_000,
    });
    expect(catalogEntry("mistral-small:24b")).toMatchObject({
      downloadSizeMB: 14_000,
      minRamGB: 32,
      contextTokens: 32_000,
    });
  });

  it("추론 모델은 distill 명시 id 로 등록한다", () => {
    expect(catalogEntry("deepseek-r1:8b-0528-qwen3-q4_K_M")).toMatchObject({
      category: "reasoning",
      categoryLabel: "추론",
      downloadSizeMB: 5_200,
      minRamGB: 12,
      contextTokens: 128_000,
    });
    expect(catalogEntry("deepseek-r1:14b-qwen-distill-q4_K_M")).toMatchObject({
      category: "reasoning",
      downloadSizeMB: 9_000,
      minRamGB: 24,
      contextTokens: 128_000,
    });
    expect(catalogEntry("deepseek-r1:32b-qwen-distill-q4_K_M")).toMatchObject({
      category: "reasoning",
      downloadSizeMB: 20_000,
      minRamGB: 48,
      contextTokens: 128_000,
    });
  });

  it("catalogEntry 는 화이트리스트다 — 카탈로그 밖 id 는 undefined", () => {
    expect(catalogEntry("qwen2.5:0.5b")?.displayName).toBe("Qwen 2.5 0.5B");
    expect(catalogEntry("evil; rm -rf /")).toBeUndefined();
    expect(catalogEntry("llama999:900b")).toBeUndefined();
  });
});

describe("evaluateLocalModelCards (하드웨어 게이트)", () => {
  it("RAM 충분 → fits + action=pull", () => {
    const cards = evaluateLocalModelCards(128, OLLAMA_UP, []);
    for (const card of cards) {
      expect(card.fits).toBe(true);
      expect(card.action).toBe("pull");
    }
  });

  it("RAM 부족 → action=insufficient-ram, 필요치가 카드에 남는다", () => {
    const cards = evaluateLocalModelCards(4, OLLAMA_UP, []);
    const small = cards.find((c) => c.id === "qwen3:0.6b");
    const big = cards.find((c) => c.id === "llama3.3:70b");
    expect(small?.action).toBe("pull");
    expect(big?.action).toBe("insufficient-ram");
    expect(big?.fits).toBe(false);
    expect(big?.minRamGB).toBe(96); // UI "부족 (N GB 필요)" 의 N
  });

  it("경계값: totalMemGB === minRamGB 는 맞음이다", () => {
    const cards = evaluateLocalModelCards(96, OLLAMA_UP, []);
    expect(cards.find((c) => c.id === "llama3.3:70b")?.fits).toBe(true);
  });

  it("★ollama 미설치 → 전 카드 action=ollama-missing (가짜 pull 버튼 금지)", () => {
    const cards = evaluateLocalModelCards(
      128,
      { installed: false, daemonRunning: false },
      [],
    );
    for (const card of cards) expect(card.action).toBe("ollama-missing");
  });

  it("설치됐지만 데몬 정지 → action=daemon-stopped", () => {
    const cards = evaluateLocalModelCards(
      128,
      { installed: true, daemonRunning: false },
      [],
    );
    for (const card of cards) expect(card.action).toBe("daemon-stopped");
  });

  it("★설치 실측된 모델은 RAM 부족이어도 installed 로 정직하게 보인다", () => {
    const cards = evaluateLocalModelCards(2, OLLAMA_UP, ["qwen3:30b"]);
    const big = cards.find((c) => c.id === "qwen3:30b");
    expect(big?.installed).toBe(true);
    expect(big?.action).toBe("installed");
    expect(big?.fits).toBe(false); // 경고 배지는 fits 로 따로 판단
  });

  it("설치 목록은 실측 id 만 매칭한다 — 카탈로그 밖 실측 id 는 카드에 없다", () => {
    const cards = evaluateLocalModelCards(16, OLLAMA_UP, ["mystery:7b"]);
    expect(cards.some((c) => c.id === "mystery:7b")).toBe(false);
    expect(cards.every((c) => !c.installed)).toBe(true);
  });
});

describe("parseOllamaListOutput", () => {
  it("헤더·빈 줄을 건너뛰고 첫 칼럼 태그만 뽑는다", () => {
    const out = [
      "NAME            ID              SIZE      MODIFIED",
      "qwen2.5:0.5b    a8b0c5157701    397 MB    2 days ago",
      "llama3.2:1b     baf6a787fdff    1.3 GB    5 weeks ago",
      "",
    ].join("\n");
    expect(parseOllamaListOutput(out)).toEqual(["qwen2.5:0.5b", "llama3.2:1b"]);
  });

  it("빈 출력(모델 0개)·헤더만 있는 출력은 빈 배열", () => {
    expect(parseOllamaListOutput("")).toEqual([]);
    expect(parseOllamaListOutput("NAME    ID    SIZE    MODIFIED\n")).toEqual(
      [],
    );
  });

  it("태그 형태(:) 아닌 잡음 줄은 버린다", () => {
    const out =
      "NAME ID SIZE MODIFIED\nsome warning line\nphi3:mini x 2.2 GB now";
    expect(parseOllamaListOutput(out)).toEqual(["phi3:mini"]);
  });
});

describe("parseOllamaPullProgress", () => {
  it("진행 라인에서 %를 읽는다(여러 개면 마지막)", () => {
    expect(
      parseOllamaPullProgress(
        "pulling dde5aa3fc5ff...  42% ▕████      ▏ 832 MB/2.0 GB",
      ),
    ).toBe(42);
    expect(parseOllamaPullProgress("… 10% … 55%")).toBe(55);
  });

  it("비진행 라인(manifest/success)은 null", () => {
    expect(parseOllamaPullProgress("pulling manifest")).toBeNull();
    expect(
      parseOllamaPullProgress("verifying sha256 digest\nsuccess"),
    ).toBeNull();
  });

  it("범위 밖 숫자는 버린다", () => {
    expect(parseOllamaPullProgress("999%")).toBeNull();
    expect(parseOllamaPullProgress("100%")).toBe(100);
    expect(parseOllamaPullProgress("0%")).toBe(0);
  });
});

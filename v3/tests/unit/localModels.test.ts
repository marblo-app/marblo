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
  LOCAL_MEMORY_TIERS,
  LOCAL_MODEL_CATALOG,
  localMemoryTier,
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
      expect(["chat-only", "tool-use-lite", "tool-use"]).toContain(
        e.toolSupport,
      );
      expect([
        "대화·업무 분배",
        "도구 사용 가능(경량 주입)",
        "도구 사용 가능(대형 모델)",
      ]).toContain(e.toolSupportLabel);
      expect(e.downloadSizeMB).toBeGreaterThan(0);
      expect(e.minRamGB).toBeGreaterThan(0);
      expect(e.minRamGB).toBeLessThanOrEqual(128);
      expect(e.contextTokens).toBeGreaterThan(0);
    }
  });

  it("★모든 행이 HuggingFace 원본 링크를 갖는다(카드의 '더 알아보기' 경로)", () => {
    const urls = LOCAL_MODEL_CATALOG.map((e) => e.huggingFaceUrl);
    // 타입이 필수로 강제하지만, 빈 문자열/오타 호스트까지는 못 막는다.
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+$/);
    }
    // 서로 다른 모델이 같은 repo 를 가리키면 둘 중 하나가 복붙 실수다.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★파라미터 규모를 전 행에서 읽을 수 있다 — phi3:mini 회귀", () => {
    for (const e of LOCAL_MODEL_CATALOG) {
      // null 이면 그 행은 크기 규칙이 조용히 chat-only 로 떨군다는 뜻이라,
      // 명시 override 없이는 티어가 사실과 달라진다.
      expect(e.paramBillions).not.toBeNull();
      expect(e.paramBillions).toBeGreaterThan(0);
    }
    // ★이름에 파라미터가 없는 대표 케이스. `local-tool-tier` 가 3.8B 로 읽어
    // 주므로 "미상 → chat-only" 가 아니라 "3.8B 라서 chat-only" 다.
    expect(catalogEntry("phi3:mini")?.paramBillions).toBe(3.8);
    expect(catalogEntry("qwen3.8:27b")?.paramBillions).toBe(27);
  });

  it("★메모리 구간은 기존 minRamGB 기준과 어긋나지 않는다", () => {
    // 27B 두 행은 큐레이션상 같은 급(17GB/18GB 가중치 → minRamGB 48)이라
    // 반드시 같은 구간에 떨어져야 한다.
    expect(localMemoryTier(48)).toBe("48plus");
    expect(catalogEntry("gemma3:27b")?.minRamGB).toBe(48);
    expect(catalogEntry("qwen3.8:27b")?.minRamGB).toBe(48);
    // 경계값 — 구간 정의 그대로.
    expect(localMemoryTier(8)).toBe("8");
    expect(localMemoryTier(9)).toBe("16");
    expect(localMemoryTier(16)).toBe("16");
    expect(localMemoryTier(24)).toBe("32");
    expect(localMemoryTier(32)).toBe("32");
    expect(localMemoryTier(96)).toBe("48plus");
    // 어떤 행도 구간 밖으로 새지 않는다.
    for (const e of LOCAL_MODEL_CATALOG) {
      expect(LOCAL_MEMORY_TIERS).toContain(localMemoryTier(e.minRamGB));
    }
  });

  it("★25B 미만 chat-only / 25~30B 경량 / 30B+ 전체 tool-use", () => {
    expect(catalogEntry("qwen2.5:0.5b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("qwen3:4b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("gemma3:4b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("qwen2.5-coder:7b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("qwen2.5-coder:14b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("phi4:14b")?.toolSupport).toBe("chat-only");
    // ★의도된 동작 변경: 27B 는 이제 경량 티어다(사장님 요청 "25B 이상은 경량
    // 주입과 도구 호출"). 단순 임계 하향이 아니라 주입량을 깎은 별도 티어라
    // X8ZzPLey1Uk7uFm8q3bv 의 과부하 조건을 복원하지 않는다.
    expect(catalogEntry("gemma3:27b")?.toolSupport).toBe("tool-use-lite");
    expect(catalogEntry("qwen3.8:27b")?.toolSupport).toBe("tool-use-lite");
    // 코더 특화 2종은 명시 override 로 chat-only 고정(#1036, 사장님 판단 대기).
    expect(catalogEntry("devstral:24b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("codestral:22b")?.toolSupport).toBe("chat-only");
    expect(catalogEntry("qwen2.5-coder:32b")?.toolSupport).toBe("tool-use");
    expect(catalogEntry("qwen3:32b")?.toolSupport).toBe("tool-use");
    expect(catalogEntry("llama3.3:70b")?.toolSupport).toBe("tool-use");
    expect(resolveLocalToolSupport("qwen2.5:0.5b")).toBe("chat-only");
    expect(resolveLocalToolSupport("qwen2.5-coder:7b")).toBe("chat-only");
    expect(resolveLocalToolSupport("qwen2.5-coder:32b")).toBe("tool-use");
    expect(resolveLocalToolSupport("unknown-local-model")).toBe("chat-only");
    expect(parseLocalParamBillions("phi3:mini")).toBe(3.8);
    expect(isLocalChatOnlyModel("qwen2.5:0.5b")).toBe(true);
    expect(isLocalChatOnlyModel("qwen2.5-coder:7b")).toBe(true);
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

  it("★카탈로그 밖 실측 id 는 '표시 전용' 카드로 남는다 — pull 버튼은 주지 않는다", () => {
    // ★의도된 동작 변경(eVe336EESa7azzfLvDZV). 종전에는 카탈로그 밖 설치분이
    // 카드에서 아예 빠졌는데, 그러면 큐레이션에서 한 줄 내리는 순간 **이미
    // 설치해 쓰던 모델이 화면에서 사라진다**. 카탈로그에서 내리는 것과 설치분을
    // 감추는 것은 다른 일이라, 표시 전용 카드로 남긴다.
    //
    // 신뢰경계는 그대로다 — action 이 항상 "installed" 라 pull 버튼이 없고,
    // `localModels:pull` IPC 는 여전히 catalogEntry() 화이트리스트로만 실행한다
    // (아래 not-in-catalog 회귀 테스트 참조).
    const cards = evaluateLocalModelCards(16, OLLAMA_UP, ["mystery:7b"]);
    const outside = cards.find((c) => c.id === "mystery:7b");
    expect(outside).toBeDefined();
    expect(outside?.source).toBe("installed-outside-catalog");
    expect(outside?.installed).toBe(true);
    expect(outside?.action).toBe("installed");
    // 소요 RAM 을 모르므로 게이트를 걸지 않고, 메모리 구간에도 넣지 않는다.
    expect(outside?.minRamGB).toBe(0);
    expect(outside?.fits).toBe(true);
    expect(outside?.memoryTier).toBeNull();
    // 크기·컨텍스트·원본 링크는 모르는 값이라 지어내지 않는다.
    expect(outside?.downloadSizeMB).toBeUndefined();
    expect(outside?.contextTokens).toBeUndefined();
    expect(outside?.huggingFaceUrl).toBeUndefined();
    // 티어는 카탈로그 밖에서도 같은 크기 규칙을 쓴다(7B → chat-only).
    expect(outside?.toolSupport).toBe("chat-only");
    expect(outside?.paramBillions).toBe(7);
    // 카탈로그 행들은 영향을 받지 않는다.
    expect(
      cards.filter((c) => c.source === "catalog").every((c) => !c.installed),
    ).toBe(true);
  });

  it("카탈로그 밖 설치분이 없으면 카드는 카탈로그 행뿐이다", () => {
    const cards = evaluateLocalModelCards(16, OLLAMA_UP, []);
    expect(cards).toHaveLength(LOCAL_MODEL_CATALOG.length);
    expect(cards.every((c) => c.source === "catalog")).toBe(true);
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

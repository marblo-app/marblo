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
  parseOllamaListOutput,
  parseOllamaPullProgress,
} from "../../electron/local-models";

const OLLAMA_UP = { installed: true, daemonRunning: true };

describe("LOCAL_MODEL_CATALOG (first-party 큐레이션 위생)", () => {
  it("id 는 유일하고 ollama 태그 형태(<name>:<tag>)다", () => {
    const ids = LOCAL_MODEL_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9.-]+:[a-z0-9.-]+$/);
  });

  it("크기·RAM·컨텍스트는 전부 양수이고 소형(≤8GB RAM) 큐레이션이다", () => {
    for (const e of LOCAL_MODEL_CATALOG) {
      expect(e.downloadSizeMB).toBeGreaterThan(0);
      expect(e.minRamGB).toBeGreaterThan(0);
      expect(e.minRamGB).toBeLessThanOrEqual(8);
      expect(e.contextTokens).toBeGreaterThan(0);
    }
  });

  it("catalogEntry 는 화이트리스트다 — 카탈로그 밖 id 는 undefined", () => {
    expect(catalogEntry("qwen2.5:0.5b")?.displayName).toBe("Qwen 2.5 0.5B");
    expect(catalogEntry("evil; rm -rf /")).toBeUndefined();
    expect(catalogEntry("llama999:900b")).toBeUndefined();
  });
});

describe("evaluateLocalModelCards (하드웨어 게이트)", () => {
  it("RAM 충분 → fits + action=pull", () => {
    const cards = evaluateLocalModelCards(16, OLLAMA_UP, []);
    for (const card of cards) {
      expect(card.fits).toBe(true);
      expect(card.action).toBe("pull");
    }
  });

  it("RAM 부족 → action=insufficient-ram, 필요치가 카드에 남는다", () => {
    const cards = evaluateLocalModelCards(4, OLLAMA_UP, []);
    const small = cards.find((c) => c.id === "qwen2.5:0.5b");
    const big = cards.find((c) => c.id === "llama3.2:3b");
    expect(small?.action).toBe("pull");
    expect(big?.action).toBe("insufficient-ram");
    expect(big?.fits).toBe(false);
    expect(big?.minRamGB).toBe(8); // UI "부족 (N GB 필요)" 의 N
  });

  it("경계값: totalMemGB === minRamGB 는 맞음이다", () => {
    const cards = evaluateLocalModelCards(8, OLLAMA_UP, []);
    expect(cards.find((c) => c.id === "llama3.2:3b")?.fits).toBe(true);
  });

  it("★ollama 미설치 → 전 카드 action=ollama-missing (가짜 pull 버튼 금지)", () => {
    const cards = evaluateLocalModelCards(
      64,
      { installed: false, daemonRunning: false },
      [],
    );
    for (const card of cards) expect(card.action).toBe("ollama-missing");
  });

  it("설치됐지만 데몬 정지 → action=daemon-stopped", () => {
    const cards = evaluateLocalModelCards(
      64,
      { installed: true, daemonRunning: false },
      [],
    );
    for (const card of cards) expect(card.action).toBe("daemon-stopped");
  });

  it("★설치 실측된 모델은 RAM 부족이어도 installed 로 정직하게 보인다", () => {
    const cards = evaluateLocalModelCards(2, OLLAMA_UP, ["llama3.2:3b"]);
    const big = cards.find((c) => c.id === "llama3.2:3b");
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

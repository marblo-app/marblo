/**
 * ★env-swap 벤더 크레덴셜 안전저장소 (R3UBmo5q).
 *
 * 문제: GLM/MiniMax 는 설치할 CLI 가 없고 벤더 키만 필요한데, 그 키가 오직
 * `process.env`(= `v3/.env` dotenv)에서만 왔다. Finder 로 띄운 **패키지앱엔 셸 env
 * 도 편집 가능한 .env 도 없어서** 빌드앱에서 두 벤더를 켤 방법이 아예 없었다.
 *
 * 이 파일이 증명하는 것:
 *
 *  (1) **allowlist** — 저장 가능한 env 키는 레지스트리가 `${...}` 로 참조하는
 *      이름뿐이다. 렌더러가 PATH·ANTHROPIC_API_KEY 를 밀어 넣어 스폰 env 를
 *      흔드는 경로가 없다.
 *  (2) **UI 계약** — 설정 화면이 그리는 벤더 카드 목록이 레지스트리에서 파생된다
 *      (하드코딩 0 — 벤더 행만 늘리면 카드가 생긴다).
 *  (3) **값 비노출** — 상태 스냅샷은 마스킹된 preview 만 담고, 평문 시크릿은
 *      어떤 필드로도 새지 않는다.
 *  (4) **electron 없는 환경에서 안전 강등** — 순수 node(이 테스트, verify:models)
 *      에서는 저장소가 조용히 "없음" 이 되고 종전 `process.env` 동작 그대로다.
 *
 * ★암호화 왕복(safeStorage 실제 encrypt/decrypt)은 Electron 런타임이 있어야 하므로
 * 여기서 검증하지 않는다 — 그 경로는 BYOK 저장소와 동일한 API 이고, 이 파일은
 * "그 API 를 못 쓸 때 안전한 쪽으로 떨어지는가" 를 대신 강제한다.
 */
import { describe, it, expect } from "vitest";
import {
  MODEL_REGISTRY,
  HARNESS_NATIVE_VENDOR,
  vendorEnvSecretRef,
} from "../../electron/model-registry";
import {
  allVendorEnvSecretKeys,
  deleteVendorSecret,
  envSwapVendorRequirements,
  getVendorSecret,
  isStorableVendorSecretKey,
  isVendorSecretStoreAvailable,
  setVendorSecret,
  vendorSecretStatus,
  vendorSecretsSnapshot,
} from "../../electron/vendor-secrets";

/** 실제 키를 쓰지 않는다 — 형태만 있으면 충분하다. */
const FAKE_KEY = "test-vendor-key-not-a-real-secret-0123456789";

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// (1) allowlist
// ─────────────────────────────────────────────────────────────────────────

describe("★저장 가능한 키는 레지스트리 참조 이름뿐이다", () => {
  it("레지스트리의 모든 ${...} 참조가 allowlist 에 있다", () => {
    const fromRegistry = new Set<string>();
    for (const entry of MODEL_REGISTRY) {
      for (const value of Object.values(entry.envProfile ?? {})) {
        const ref = vendorEnvSecretRef(value);
        if (ref) fromRegistry.add(ref);
      }
    }
    expect(allVendorEnvSecretKeys()).toEqual([...fromRegistry].sort());
  });

  it("오늘의 env-swap 벤더 키가 실제로 들어 있다", () => {
    expect(allVendorEnvSecretKeys()).toContain("ZAI_API_KEY");
    expect(allVendorEnvSecretKeys()).toContain("MINIMAX_API_KEY");
    expect(allVendorEnvSecretKeys()).toContain("UPSTAGE_API_KEY");
  });

  it("시크릿이 아닌 프로파일 키(엔드포인트·모델 매핑)는 저장 대상이 아니다", () => {
    for (const key of [
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]) {
      expect(isStorableVendorSecretKey(key)).toBe(false);
    }
  });

  it("★프로세스·하네스 배선 키는 저장할 수 없다(스폰 env 오염 차단)", () => {
    for (const key of [
      "PATH",
      "HOME",
      "ANTHROPIC_API_KEY", // 우리 Anthropic 크레덴셜 — 이 저장소의 축이 아니다
      "ANTHROPIC_AUTH_TOKEN", // 값이 아니라 이름으로 참조되는 자리(=프로파일 키)
      "MARBLO_BRIDGE_TOKEN",
      "MCP_CONFIG_PATH",
    ]) {
      expect(isStorableVendorSecretKey(key)).toBe(false);
      expect(() => setVendorSecret(key, FAKE_KEY)).toThrow(
        /저장할 수 없는 env 키/
      );
    }
  });

  it("allowlist 밖 키는 읽기도 undefined 다(파일에 뭐가 있든)", () => {
    expect(getVendorSecret("PATH")).toBeUndefined();
    expect(getVendorSecret("ANTHROPIC_API_KEY")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (2) UI 계약 — 벤더 카드 목록은 레지스트리 파생
// ─────────────────────────────────────────────────────────────────────────

describe("★설정 UI 가 그릴 벤더 요구사항이 레지스트리에서 파생된다", () => {
  const reqs = envSwapVendorRequirements();

  it("zai / minimax / upstage 가 각자의 키 이름과 함께 나온다", () => {
    const zai = reqs.find((r) => r.vendor === "zai");
    const minimax = reqs.find((r) => r.vendor === "minimax");
    const upstage = reqs.find((r) => r.vendor === "upstage");
    expect(zai?.envKeys).toEqual(["ZAI_API_KEY"]);
    expect(minimax?.envKeys).toEqual(["MINIMAX_API_KEY"]);
    expect(upstage?.envKeys).toEqual(["UPSTAGE_API_KEY"]);
    // 카드에 표시할 모델도 레지스트리에서 온다.
    expect(zai?.modelIds).toEqual(
      expect.arrayContaining(["glm-5.2", "glm-4.7"])
    );
    expect(minimax?.modelIds).toEqual(
      expect.arrayContaining(["MiniMax-M3", "MiniMax-M2.7"])
    );
    expect(upstage?.modelIds).toEqual(["solar-pro4"]);
  });

  it("★하네스 네이티브 벤더(anthropic/openai)는 등록 카드가 없다 — CLI 자기 로그인이다", () => {
    for (const req of reqs) {
      const rows = MODEL_REGISTRY.filter((m) => m.provider === req.vendor);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(req.vendor).not.toBe(HARNESS_NATIVE_VENDOR[row.harness]);
      }
    }
    expect(reqs.map((r) => r.vendor)).not.toContain("anthropic");
    expect(reqs.map((r) => r.vendor)).not.toContain("openai");
  });

  it("요구 키는 전부 allowlist 안에 있다(UI 가 저장 못 하는 칸을 그리지 않는다)", () => {
    const allowed = allVendorEnvSecretKeys();
    for (const req of reqs) {
      for (const key of req.envKeys) expect(allowed).toContain(key);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (3) 값 비노출
// ─────────────────────────────────────────────────────────────────────────

describe("★스냅샷에 평문 시크릿이 없다", () => {
  it("preview 는 마스킹된 형태이고 원문을 담지 않는다", () => {
    withEnv("ZAI_API_KEY", FAKE_KEY, () => {
      const status = vendorSecretStatus("ZAI_API_KEY");
      expect(status.preview).not.toBe(FAKE_KEY);
      expect(status.preview).not.toContain(FAKE_KEY.slice(4, -4));
      expect(status.preview).toContain("***");
      expect(status.source).toBe("env");
      expect(status.presentInProcessEnv).toBe(true);
    });
  });

  it("★전체 스냅샷을 직렬화해도 시크릿 원문이 나오지 않는다", () => {
    withEnv("ZAI_API_KEY", FAKE_KEY, () => {
      withEnv("MINIMAX_API_KEY", FAKE_KEY, () => {
        const json = JSON.stringify(vendorSecretsSnapshot());
        expect(json).not.toContain(FAKE_KEY);
      });
    });
  });

  it("값이 없으면 preview 는 빈 문자열이고 source=none 이다", () => {
    withEnv("ZAI_API_KEY", undefined, () => {
      const status = vendorSecretStatus("ZAI_API_KEY");
      expect(status.preview).toBe("");
      expect(status.source).toBe("none");
      expect(status.storedInApp).toBe(false);
    });
  });

  it("★all-or-nothing — 필요한 키가 하나라도 비면 그 벤더는 ready 가 아니다", () => {
    withEnv("ZAI_API_KEY", undefined, () => {
      const zai = vendorSecretsSnapshot().vendors.find(
        (v) => v.vendor === "zai"
      );
      expect(zai?.ready).toBe(false);
    });
    withEnv("ZAI_API_KEY", FAKE_KEY, () => {
      const zai = vendorSecretsSnapshot().vendors.find(
        (v) => v.vendor === "zai"
      );
      expect(zai?.ready).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (4) electron 없는 환경 — 안전 강등
// ─────────────────────────────────────────────────────────────────────────

describe("★Electron 밖(순수 node)에서는 저장소가 조용히 없다", () => {
  it("저장소를 쓸 수 없다고 정직하게 답한다", () => {
    expect(isVendorSecretStoreAvailable()).toBe(false);
  });

  it("읽기는 undefined — 종전 process.env 전용 동작 그대로다", () => {
    withEnv("ZAI_API_KEY", undefined, () => {
      expect(getVendorSecret("ZAI_API_KEY")).toBeUndefined();
    });
  });

  it("★쓰기는 평문으로 떨어지지 않고 실패한다(P0-4: 평문 파일 0개)", () => {
    expect(() => setVendorSecret("ZAI_API_KEY", FAKE_KEY)).toThrow(
      /키체인 암호화/
    );
  });

  it("삭제는 없는 파일에 대해 조용히 성공한다(멱등)", () => {
    expect(() => deleteVendorSecret("ZAI_API_KEY")).not.toThrow();
  });
});

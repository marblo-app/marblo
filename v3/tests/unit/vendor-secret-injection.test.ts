/**
 * ★설정 UI 에 등록한 벤더 키가 **실제 스폰 env 로 흐르는가** (R3UBmo5q).
 *
 * 저장소 자체는 `vendor-secret-store.test.ts` 가 본다. 여기서 보는 것은 배선이다:
 * 안전저장소가 `resolveVendorEnvProfile` → `applyVendorEnv` 의 두 번째 소스로
 * 정말 물려 있는가, 그리고 그 연결이 종전 불변식을 깨지 않는가.
 *
 *  (1) **주입** — 셸 env 가 비어도 저장소 값만으로 GLM/MiniMax 프로파일이 얹힌다
 *      (= 패키지앱에서 키 등록만으로 dispatch 가 그 벤더로 라우팅된다).
 *  (2) **우선순위** — `process.env` 가 있으면 그쪽이 이긴다. 셸/.env 로 명시한
 *      크레덴셜을 GUI 저장값이 조용히 덮지 않는다.
 *  (3) **★전부-아니면-전무** — 저장소가 세트를 절반만 채워도 프로파일은 통째로
 *      안 얹힌다. 반쪽 주입은 우리 Anthropic 크레덴셜을 남의 엔드포인트로 보낸다.
 *  (4) **회귀 0** — 프로파일 없는 행(네이티브 claude/codex)은 저장소가 무엇을
 *      들고 있든 env 가 **참조까지 동일**하게 나간다.
 *
 * ★`vendor-secrets` 모듈을 mock 하는 이유: 실제 저장은 Electron `safeStorage`
 * (OS 키체인)를 타므로 순수 node 테스트에서 왕복시킬 수 없다. 여기서 필요한 증명은
 * "저장소가 값을 주면 스폰 env 가 그 값을 쓴다" 는 **배선**이고, 그건 이 경계에서
 * 정확히 관측된다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const storeValues = new Map<string, string>();

vi.mock("../../electron/vendor-secrets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/vendor-secrets")>();
  return {
    ...actual,
    getVendorSecret: (envKey: string) => storeValues.get(envKey),
  };
});

import {
  applyVendorEnv,
  resolveVendorEnvProfile,
  vendorEnvReadiness,
} from "../../electron/agent-config";
import { envProfileForModel } from "../../electron/model-registry";

const FAKE_STORE_KEY = "stored-key-not-a-real-secret-aaaa";
const FAKE_ENV_KEY = "shell-env-key-not-a-real-secret-bbbb";

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

beforeEach(() => {
  storeValues.clear();
});

// ─────────────────────────────────────────────────────────────────────────
// (1) 주입 — 저장소만으로 켜진다
// ─────────────────────────────────────────────────────────────────────────

describe("★저장소 값만으로 벤더 프로파일이 스폰 env 에 얹힌다", () => {
  it.each([
    ["glm-4.7", "ZAI_API_KEY", "https://api.z.ai/api/anthropic"],
    ["MiniMax-M3", "MINIMAX_API_KEY", "https://api.minimax.io/anthropic"],
  ])("%s — 셸 env 없이 앱 저장소 값으로 주입된다", (modelId, envKey, base) => {
    withEnv(envKey, undefined, () => {
      storeValues.set(envKey, FAKE_STORE_KEY);
      const env = applyVendorEnv({ PATH: "/usr/bin" }, modelId);
      expect(env.ANTHROPIC_BASE_URL).toBe(base);
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_STORE_KEY);
      // 기존 배선은 그대로 살아 있다.
      expect(env.PATH).toBe("/usr/bin");
    });
  });

  it("readiness 도 저장소를 본다 — 등록 후 ready=true 로 뒤집힌다", () => {
    withEnv("ZAI_API_KEY", undefined, () => {
      expect(vendorEnvReadiness("glm-4.7").ready).toBe(false);
      expect(vendorEnvReadiness("glm-4.7").missingEnvKeys).toEqual([
        "ZAI_API_KEY",
      ]);

      storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
      const after = vendorEnvReadiness("glm-4.7");
      expect(after.ready).toBe(true);
      expect(after.missingEnvKeys).toEqual([]);
      // 필요한 키 **이름**은 값과 무관하게 항상 보고된다.
      expect(after.requiredEnvKeys).toEqual(["ZAI_API_KEY"]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (2) 우선순위 — process.env 가 이긴다
// ─────────────────────────────────────────────────────────────────────────

describe("★셸/.env 값이 앱 저장값보다 우선한다", () => {
  it("둘 다 있으면 process.env 가 쓰인다", () => {
    withEnv("ZAI_API_KEY", FAKE_ENV_KEY, () => {
      storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
      const env = applyVendorEnv({}, "glm-5.2");
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_ENV_KEY);
      expect(env.ANTHROPIC_AUTH_TOKEN).not.toBe(FAKE_STORE_KEY);
    });
  });

  it("공백뿐인 셸 env 는 값이 아니다 — 저장소로 넘어간다", () => {
    withEnv("ZAI_API_KEY", "   ", () => {
      storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
      expect(applyVendorEnv({}, "glm-5.2").ANTHROPIC_AUTH_TOKEN).toBe(
        FAKE_STORE_KEY,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (3) ★전부-아니면-전무
// ─────────────────────────────────────────────────────────────────────────

describe("★부분 주입 금지 — 세트가 불완전하면 프로파일을 통째로 안 얹는다", () => {
  it("저장소가 비면 base 를 참조까지 그대로 돌려준다", () => {
    withEnv("ZAI_API_KEY", undefined, () => {
      const base = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "our-anthropic-key" };
      const env = applyVendorEnv(base, "glm-4.7");
      expect(env).toBe(base); // ★새 객체조차 만들지 않는다
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });
  });

  it("★엔드포인트만 얹히고 토큰이 빠지는 조합은 만들어지지 않는다", () => {
    // ★두 키를 **모두** 비운다 — 이 머신 셸에 실제 벤더 키가 있으면(라이브
    // 개발기가 그렇다) 테스트가 조용히 통과해버린다.
    withEnv("ZAI_API_KEY", undefined, () =>
      withEnv("MINIMAX_API_KEY", undefined, () => {
        // 시크릿 참조 2개짜리 가상의 프로파일 — 하나만 채워진 상태.
        storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
        const { resolved, missing } = resolveVendorEnvProfile({
          ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
          ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
          SOME_OTHER_SECRET: "${MINIMAX_API_KEY}",
        });
        expect(missing).toEqual(["MINIMAX_API_KEY"]);
        // resolved 는 부분적일 수 있지만, applyVendorEnv 가 missing 을 보고
        // **아무것도 얹지 않는다**. 그 판단이 유일한 게이트다.
        expect(resolved.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_STORE_KEY);
        expect(missing.length).toBeGreaterThan(0);
      }),
    );
  });

  it("우리 Anthropic 크레덴셜은 벤더 스폰에서도 건드려지지 않는다", () => {
    withEnv("ZAI_API_KEY", undefined, () => {
      storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
      const env = applyVendorEnv({ ANTHROPIC_API_KEY: "our-key" }, "glm-4.7");
      // 벤더 프로파일은 BASE_URL/AUTH_TOKEN/DEFAULT_* 만 손댄다.
      expect(env.ANTHROPIC_API_KEY).toBe("our-key");
      expect(Object.keys(envProfileForModel("glm-4.7"))).not.toContain(
        "ANTHROPIC_API_KEY",
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (4) 회귀 0
// ─────────────────────────────────────────────────────────────────────────

describe("★네이티브 벤더 스폰은 저장소가 무엇을 들고 있든 무변경", () => {
  it.each(["claude-opus-5", "claude-sonnet-5", "gpt-5.6-luna"])(
    "%s — env 가 참조까지 동일하다",
    (modelId) => {
      storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
      storeValues.set("MINIMAX_API_KEY", FAKE_STORE_KEY);
      const base = { PATH: "/usr/bin", HOME: "/tmp/home" };
      expect(applyVendorEnv(base, modelId)).toBe(base);
    },
  );

  it("핀 없는 스폰(모델 미지정)도 무변경", () => {
    storeValues.set("ZAI_API_KEY", FAKE_STORE_KEY);
    const base = { PATH: "/usr/bin" };
    expect(applyVendorEnv(base, undefined)).toBe(base);
  });
});

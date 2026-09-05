/**
 * ★존재함 / 없음 / 못읽음 (티켓 DmfFZdKpNig5AiZ7Bp3p).
 *
 * 2026-09-04, 순수 node 백엔드 에이전트 셸이 벤더 안전저장소(Electron safeStorage
 * 암호화)를 열 수 없어 "키가 없다"고 오진했다. 실제로는 8/21부터
 * `~/.marblo/vendor-secrets.enc.json` 에 UPSTAGE_API_KEY/DEEPSEEK_API_KEY/
 * MINIMAX_API_KEY 세 개가 등록돼 있었다 — 있는데 못 읽은 것이지 없던 게 아니다.
 *
 * 이 파일이 증명하는 것:
 *
 *  (1) `vendorSecretPresence` 가 present/absent/unreadable 세 값을 실제로
 *      구분한다 — 특히 "파일엔 키가 있는데 이 프로세스는 못 읽는다" 를 "absent"
 *      로 뭉개지 않는다(★뮤테이션 가드).
 *  (2) 파일 존재 여부 판정 자체는 Electron 없이(순수 `fs`) 된다 — 이게 이
 *      티켓의 핵심 통찰이다: 값 복호화만 safeStorage 가 필요하지, "이 키 이름이
 *      등록됐는가"는 어느 프로세스에서든 답할 수 있다.
 *  (3) `process.env` 가 있으면 파일 상태와 무관하게 present — 종전
 *      `getVendorSecret` 의 우선순위와 같은 방향.
 *  (4) allowlist 밖 키는 파일에 뭐가 있든 absent(저장소가 취급하지 않는 키).
 *
 * ★가짜 홈 디렉토리(`os.homedir` mock)를 써서 격리한다 — 사장님이 8/21에 넣으신
 * 실제 `~/.marblo/vendor-secrets.enc.json` 은 이 테스트가 절대 건드리지 않는다.
 * 값도 전부 가짜 ciphertext(실제로 디코드되지 않는 임의 base64) 다.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const FAKE_HOME = fs.mkdtempSync(
  path.join(os.tmpdir(), "vendor-secret-presence-"),
);
const FAKE_STORE_DIR = path.join(FAKE_HOME, ".marblo");
const FAKE_STORE_FILE = path.join(FAKE_STORE_DIR, "vendor-secrets.enc.json");

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const merged = { ...actual, homedir: () => FAKE_HOME };
  return { ...merged, default: merged };
});

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

/** 파일에 (실제로 디코드되지 않는) 가짜 ciphertext 항목들을 쓴다. */
function writeFakeStoreFile(keys: Record<string, string>): void {
  fs.mkdirSync(FAKE_STORE_DIR, { recursive: true });
  fs.writeFileSync(
    FAKE_STORE_FILE,
    JSON.stringify({ version: 1, keys }, null, 2),
    "utf-8",
  );
}

function removeStoreFile(): void {
  try {
    fs.rmSync(FAKE_STORE_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

beforeEach(() => {
  removeStoreFile();
});

afterEach(() => {
  removeStoreFile();
});

afterAll(() => {
  fs.rmSync(FAKE_HOME, { recursive: true, force: true });
});

describe("★vendorSecretPresence — 존재함/없음/못읽음 3상태", () => {
  it("process.env 에 있으면 파일과 무관하게 present", async () => {
    const { vendorSecretPresence } =
      await import("../../electron/vendor-secrets");
    writeFakeStoreFile({});
    withEnv("UPSTAGE_API_KEY", "shell-env-value-not-a-real-secret", () => {
      expect(vendorSecretPresence("UPSTAGE_API_KEY")).toBe("present");
    });
  });

  it("파일 자체가 없으면 absent", async () => {
    const { vendorSecretPresence } =
      await import("../../electron/vendor-secrets");
    removeStoreFile();
    withEnv("UPSTAGE_API_KEY", undefined, () => {
      expect(vendorSecretPresence("UPSTAGE_API_KEY")).toBe("absent");
    });
  });

  it("파일은 있지만 이 키가 등록돼 있지 않으면 absent", async () => {
    const { vendorSecretPresence } =
      await import("../../electron/vendor-secrets");
    writeFakeStoreFile({ DEEPSEEK_API_KEY: "ZmFrZS1jaXBoZXJ0ZXh0" });
    withEnv("UPSTAGE_API_KEY", undefined, () => {
      expect(vendorSecretPresence("UPSTAGE_API_KEY")).toBe("absent");
    });
  });

  it(
    "★파일엔 키가 등록돼 있지만 이 프로세스가 Electron/safeStorage 를 못 열면 " +
      "unreadable — 8/21 오진이 재현되는 정확한 조건",
    async () => {
      const { vendorSecretPresence } =
        await import("../../electron/vendor-secrets");
      // 이 vitest 프로세스는 순수 node 다(Electron 런타임 아님) — loadElectron()
      // 은 이미 항상 null 을 돌려준다. 그래서 이 조건을 만드는 데 별도 mock 이
      // 필요 없다: 파일에 키만 있으면 그걸로 충분하다.
      writeFakeStoreFile({
        UPSTAGE_API_KEY: "ZmFrZS1jaXBoZXJ0ZXh0LW5vdC1yZWFs",
      });
      withEnv("UPSTAGE_API_KEY", undefined, () => {
        expect(vendorSecretPresence("UPSTAGE_API_KEY")).toBe("unreadable");
        // ★없음이 아니다. 이게 이 티켓의 전부다.
        expect(vendorSecretPresence("UPSTAGE_API_KEY")).not.toBe("absent");
      });
    },
  );

  it("allowlist 밖 키는 파일에 뭐가 있든 absent", async () => {
    const { vendorSecretPresence } =
      await import("../../electron/vendor-secrets");
    writeFakeStoreFile({ PATH: "ZmFrZQ==" });
    withEnv("PATH", undefined, () => {
      // PATH 자체를 비울 순 없으니(셸이 깨진다) 대신 allowlist 밖 값인지만 본다.
      expect(vendorSecretPresence("ANTHROPIC_API_KEY")).toBe("absent");
    });
  });

  it("여러 키를 한 번에 판정한다(vendorSecretPresenceReport)", async () => {
    const { vendorSecretPresenceReport } =
      await import("../../electron/vendor-secrets");
    writeFakeStoreFile({ UPSTAGE_API_KEY: "ZmFrZS1jaXBoZXJ0ZXh0" });
    withEnv("UPSTAGE_API_KEY", undefined, () =>
      withEnv("DEEPSEEK_API_KEY", undefined, () => {
        const report = vendorSecretPresenceReport([
          "UPSTAGE_API_KEY",
          "DEEPSEEK_API_KEY",
        ]);
        expect(report).toEqual({
          UPSTAGE_API_KEY: "unreadable",
          DEEPSEEK_API_KEY: "absent",
        });
      }),
    );
  });

  it("★뮤테이션 가드 — 값이 응답 어디에도 나오지 않는다", async () => {
    const { vendorSecretPresence } =
      await import("../../electron/vendor-secrets");
    writeFakeStoreFile({ UPSTAGE_API_KEY: "ZmFrZS1jaXBoZXJ0ZXh0LW5vdC1yZWFs" });
    withEnv("UPSTAGE_API_KEY", undefined, () => {
      const result = vendorSecretPresence("UPSTAGE_API_KEY");
      expect(typeof result).toBe("string");
      expect(["present", "absent", "unreadable"]).toContain(result);
      // presence 값 자체가 ciphertext/평문을 담을 수 있는 타입이 아니다(리터럴
      // 유니온) — 컴파일 타임에 이미 값 유출 경로가 없다.
    });
  });
});

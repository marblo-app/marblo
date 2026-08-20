// 벤치의 **벤더 경유 배선**을 못박는다(Upstage Solar).
//
// 배경: solar-pro4 는 codex 하네스를 쓰지만 다른 codex 모델과 스폰 경로가 같지
// 않다. codex 0.147+ 는 ChatGPT 로그인이 있으면 OPENAI_BASE_URL 을 무시하고
// ChatGPT 백엔드로 보내고(→ solar-pro4 400), codex 0.148.0 은 wire_api="chat"
// 을 설정 로드 시점에 거부한다. 그래서 벤치는 커스텀 프로바이더 + 로컬
// Responses→Chat 브리지로 붙는다.
//
// ★이 파일이 지키는 급소는 하나다: **키가 없을 때 조용히 기본 경로로 떨어지면
// 안 된다.** 떨어지면 codex 가 기본 계정으로 붙어 "다른 모델을 재고 라벨만
// solar" 인 결과가 나오고, 그건 이 벤치에서 가장 비싼 사고다.
import { describe, it, expect, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { providerFailure } from "../../electron/scripts/bench/agent";
import {
  BENCH_VENDORS,
  benchVendorFor,
  renderBenchVendorToml,
  startBenchVendorSession,
} from "../../electron/scripts/bench/vendor";

const solar = BENCH_VENDORS["solar-pro4"]!;
const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-vendor-"));
  tmpDirs.push(dir);
  return dir;
}

describe("benchVendorFor", () => {
  it("solar-pro4 만 벤더 경로로 접는다", () => {
    expect(benchVendorFor("solar-pro4")?.providerId).toBe("upstage");
  });

  it("기존 라운드의 모델은 벤더 경로가 아니다(스폰이 한 글자도 안 바뀐다)", () => {
    for (const model of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "claude-opus-5",
      "grok-4.5",
      null,
    ]) {
      expect(benchVendorFor(model)).toBeNull();
    }
  });
});

describe("renderBenchVendorToml", () => {
  const toml = renderBenchVendorToml(solar, "http://127.0.0.1:51234/v1");

  it("apikey 인증을 강제한다 — ChatGPT 로그인이 이기면 다른 모델을 재게 된다", () => {
    expect(toml).toContain('model_provider = "upstage"');
    expect(toml).toContain('preferred_auth_method = "apikey"');
    expect(toml).toContain('forced_login_method = "api"');
    expect(toml).toContain("requires_openai_auth = false");
  });

  it("wire_api 는 responses 다 — codex 0.148.0 은 chat 을 로드 시점에 거부한다", () => {
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).not.toContain('wire_api = "chat"');
  });

  it("base_url 은 업스트림이 아니라 넘겨받은 브리지 주소다", () => {
    expect(toml).toContain('base_url = "http://127.0.0.1:51234/v1"');
    expect(toml).not.toContain("api.upstage.ai");
  });

  it("env_key 는 codex 가 읽을 이름이고 값(시크릿)은 담기지 않는다", () => {
    expect(toml).toContain('env_key = "UPSTAGE_API_KEY"');
  });
});

describe("startBenchVendorSession", () => {
  it("★키가 없으면 조용히 기본 경로로 떨어지지 않고 throw 한다", async () => {
    const saved = process.env.UPSTAGE_API_KEY;
    delete process.env.UPSTAGE_API_KEY;
    try {
      await expect(startBenchVendorSession(solar, tmpRoot())).rejects.toThrow(
        /UPSTAGE_API_KEY/,
      );
    } finally {
      if (saved !== undefined) process.env.UPSTAGE_API_KEY = saved;
    }
  });

  it("키가 있으면 격리 CODEX_HOME 을 세우고 경로 라벨을 돌려준다(브리지 불필요 벤더)", async () => {
    // 브리지가 필요 없는 형태로만 이 경로를 검증한다 — 브리지 기동은 컴파일된
    // `dist-electron/codex-chat-bridge.js` 를 자식으로 띄우므로 TS 소스로 도는
    // 유닛 환경에서는 성립하지 않는다(바로 아래 케이스가 그 실패를 못박는다).
    const direct = { ...solar, needsChatBridge: false };
    const saved = process.env.UPSTAGE_API_KEY;
    process.env.UPSTAGE_API_KEY = "test-key-not-a-real-secret";
    const root = tmpRoot();
    try {
      const session = await startBenchVendorSession(direct, root);
      const codexHome = session.env.CODEX_HOME!;
      expect(codexHome.startsWith(root)).toBe(true);
      const toml = fs.readFileSync(
        path.join(codexHome, "config.toml"),
        "utf-8",
      );
      expect(toml).toContain('base_url = "https://api.upstage.ai/v1"');
      // ChatGPT auth.json 이 이 홈에 없어야 apikey 경로가 이긴다.
      expect(fs.existsSync(path.join(codexHome, "auth.json"))).toBe(false);
      expect(session.route).toContain("upstage");
      expect(session.env.UPSTAGE_API_KEY).toBe("test-key-not-a-real-secret");
      await session.stop();
    } finally {
      if (saved === undefined) delete process.env.UPSTAGE_API_KEY;
      else process.env.UPSTAGE_API_KEY = saved;
    }
  });

  it("★브리지 기동에 실패하면 업스트림 직결로 조용히 폴백하지 않고 throw 한다", async () => {
    // #1039 가 확정한 규율: 폴백은 진짜 실패 지점을 가리고 사람을
    // `api.upstage.ai/v1/responses` 404 추적으로 보낸다. 벤치에서는 더 나쁘다 —
    // 폴백이 성공해 버리면 "wire_api 가 안 맞는 경로로 잰 점수" 가 표에 남는다.
    const saved = process.env.UPSTAGE_API_KEY;
    process.env.UPSTAGE_API_KEY = "test-key-not-a-real-secret";
    try {
      await expect(startBenchVendorSession(solar, tmpRoot())).rejects.toThrow(
        /bridge failed to start/,
      );
    } finally {
      if (saved === undefined) delete process.env.UPSTAGE_API_KEY;
      else process.env.UPSTAGE_API_KEY = saved;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★프로바이더 실패 게이트 — "측정이 성립하지 않은 런" 과 "0점" 을 가른다.
//
// 배경(2026-08-20 실측): solar-pro4 라운드 중 django__django-15814 가 Upstage
// 429 로 codex 의 재시도 한도를 넘겨 exit=1 로 죽었다. 그 런에서 모델은 답을
// 낸 적이 없는데, 종전 배선은 그대로 채점해 `resolved=false`(=0점)로 적었다.
// 벤더 장애가 모델 실력으로 둔갑하는 이 실패모드를 여기서 막는다.
// ─────────────────────────────────────────────────────────────────────────
describe("providerFailure", () => {
  it("codex 가 스스로 포기했다고 적은 줄을 잡는다(429)", () => {
    const log =
      "some output\nERROR: exceeded retry limit, last status: 429 Too Many Requests\n";
    expect(providerFailure(log)).toMatch(/429/);
  });

  it("429 가 아닌 상태코드도 같은 줄이면 잡는다(5xx 등)", () => {
    expect(
      providerFailure("ERROR: exceeded retry limit, last status: 503"),
    ).toContain("503");
  });

  it("★모델이 못 푼 런은 프로바이더 실패가 아니다 — 분모에 남아야 한다", () => {
    expect(providerFailure("I could not find the bug. Stopping.")).toBeNull();
    expect(providerFailure("")).toBeNull();
  });

  it("★도구 표면 불일치(apply_patch)는 여기서 잡지 않는다", () => {
    // 모델은 답을 냈고 하네스가 그 행동을 거절한 것이라 측정은 성립했다.
    // 이걸 분모에서 빼면 점수를 유리하게 만드는 조작이 된다 — 리포트에
    // 진단으로만 따로 센다.
    const log =
      "ERROR codex_core::tools::router: error=unsupported call: apply_patch";
    expect(providerFailure(log)).toBeNull();
  });
});

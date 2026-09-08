/**
 * 마블로 식별 헤더 (티켓 L78q6A41ubvsN8WX8394, 사장님 지시 2026-09-08).
 *
 * 사장님이 Upstage 에 "마블로를 거쳐 나가는 요청에는 마블로임을 알리는 헤더를
 * 붙인다"고 이미 말씀하셨는데, 저장소에 그 배선이 없었다(grep 0건). 이 파일은
 * 그 약속을 지키는 코드(codex-vendor-provider.ts)를 고정한다.
 *
 * ★실제 바이너리 확인(문서/주석 근거 아님): 설치된 codex-cli 0.153.4 에
 * `model_providers.<id>.http_headers` 를 얹었을 때 config 로드가 거부되지
 * 않고(대조: `wire_api="chat"` 은 거부됨), 로컬 에코 서버·실제 Upstage 릴레이
 * 양쪽에서 실제 스폰으로 헤더가 나가는 요청에 실려 도착하는 것을 확인했다
 * (커밋에는 안 남긴 임시 스크립트 — 완료 보고 activity 에 원본 로그 요약).
 *
 * ★값 규율: `MARBLO_CLIENT_HEADER_VALUE_SHAPE` 는 `product/x.y.z` 모양만
 * 허용하는 화이트리스트다 — 블랙리스트(이메일/uid 패턴 배제)가 아니라
 * 허용 모양 자체를 좁혀서, 나중에 실수로 식별 정보가 섞여도 그 모양을
 * 벗어나면 반드시 걸린다.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MARBLO_CLIENT_HEADER_NAME,
  MARBLO_CLIENT_HEADER_VALUE,
  MARBLO_CLIENT_HEADER_VALUE_SHAPE,
  renderCodexVendorProviderToml,
  type CodexVendorProviderOverride,
} from "../../electron/codex-vendor-provider";
import { startCodexChatBridge } from "../../electron/codex-chat-bridge";
import http from "node:http";

const OVERRIDE: CodexVendorProviderOverride = {
  providerId: "upstage",
  name: "Upstage Solar",
  upstreamBaseUrl: "https://api.upstage.ai/v1",
  envKey: "UPSTAGE_API_KEY",
  wireApi: "responses",
  needsChatBridge: false,
};

describe("마블로 식별 헤더 — 이름·값 규율", () => {
  it("★헤더 이름은 User-Agent 가 아니다(codex 자기 UA 와 충돌 방지)", () => {
    expect(MARBLO_CLIENT_HEADER_NAME.toLowerCase()).not.toBe("user-agent");
    expect(MARBLO_CLIENT_HEADER_NAME).toBe("X-Marblo-Client");
  });

  it("★값은 product/x.y.z 모양만 허용하는 화이트리스트를 통과한다", () => {
    expect(
      MARBLO_CLIENT_HEADER_VALUE_SHAPE.test(MARBLO_CLIENT_HEADER_VALUE),
    ).toBe(true);
  });

  it("★이메일·uid·프로젝트명처럼 식별 가능한 값은 이 모양을 통과하지 못한다", () => {
    const identifying = [
      "marblo/john.kim@hypemarc.com",
      "marblo/user-RSALO1rljtWBSZ70MoBiaeFORxr1",
      "marblo-GFB8JnJrrX6AgahqmGB3/3.0.39",
      "3.0.39",
      "marblo/3.0",
      "",
    ];
    for (const v of identifying) {
      expect(
        MARBLO_CLIENT_HEADER_VALUE_SHAPE.test(v),
        `"${v}" 는 허용 모양을 통과하면 안 된다`,
      ).toBe(false);
    }
  });

  it("실제 배포 값 자체가 식별 정보를 담지 않는다(리터럴 검사)", () => {
    expect(MARBLO_CLIENT_HEADER_VALUE).not.toContain("@");
    expect(MARBLO_CLIENT_HEADER_VALUE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("renderCodexVendorProviderToml — http_headers 서브테이블", () => {
  it("★부모 테이블 스칼라 키 다음, 맨 뒤에 http_headers 서브테이블을 싣는다", () => {
    const toml = renderCodexVendorProviderToml(
      OVERRIDE,
      "https://api.upstage.ai/v1",
    );
    const headerTableIdx = toml.indexOf(
      "[model_providers.upstage.http_headers]",
    );
    const requiresAuthIdx = toml.indexOf("requires_openai_auth = false");
    expect(headerTableIdx).toBeGreaterThan(0);
    expect(requiresAuthIdx).toBeGreaterThan(0);
    // TOML은 하위 테이블을 열면 부모 테이블로 못 돌아간다 — 순서가 틀리면
    // requires_openai_auth 가 http_headers 테이블의 키로 흡수돼 로드가 깨진다.
    expect(headerTableIdx).toBeGreaterThan(requiresAuthIdx);
  });

  it("★헤더 이름·값이 정확한 TOML 키-값 줄로 나온다", () => {
    const toml = renderCodexVendorProviderToml(
      OVERRIDE,
      "https://api.upstage.ai/v1",
    );
    expect(toml).toContain(
      `${MARBLO_CLIENT_HEADER_NAME} = ${JSON.stringify(MARBLO_CLIENT_HEADER_VALUE)}`,
    );
  });

  it("model_catalog_json 이 있어도 http_headers 서브테이블 순서는 그대로다", () => {
    const toml = renderCodexVendorProviderToml(
      OVERRIDE,
      "https://api.upstage.ai/v1",
      "/tmp/catalog.json",
    );
    expect(toml.indexOf("model_catalog_json")).toBeLessThan(
      toml.indexOf("[model_providers.upstage]"),
    );
    expect(
      toml.indexOf("[model_providers.upstage.http_headers]"),
    ).toBeGreaterThan(toml.indexOf("requires_openai_auth = false"));
  });
});

/** 브리지 서버(raw http.createServer)에 보내는 클라이언트 요청 — fetch 를 안 쓴다.
 * 이 테스트는 아래에서 global fetch 를 스텁해 "브리지→업스트림" 호출만 가로채야
 * 하는데, 같은 fetch 를 클라이언트 쪽에서도 쓰면 브리지 서버에 요청이 아예
 * 도달하지 않고 스텁이 먼저 삼켜버린다. */
function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number | undefined }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on("data", () => undefined);
        res.on("end", () => resolve({ status: res.statusCode }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("codex-chat-bridge — 브리지(롤백 경로)도 헤더를 잃지 않는다", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("★브리지는 codex→브리지 요청을 그대로 중계하지 않고 새 fetch 를 만든다 — 그 새 fetch 에 마블로 헤더를 다시 실어야 한다", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("upstream unreachable (test double, no network)");
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = await startCodexChatBridge({
      upstreamBaseUrl: "https://api.upstage.ai/v1",
      apiKey: "test-key-not-real",
    });
    try {
      await postJson(`${bridge.baseUrl}/responses`, {
        model: "solar-pro4",
        input: "hi",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
      expect(calledUrl).toBe("https://api.upstage.ai/v1/chat/completions");
      const headers = (calledInit as { headers: Record<string, string> })
        .headers;
      expect(headers[MARBLO_CLIENT_HEADER_NAME]).toBe(
        MARBLO_CLIENT_HEADER_VALUE,
      );
    } finally {
      await bridge.stop();
    }
  });
});

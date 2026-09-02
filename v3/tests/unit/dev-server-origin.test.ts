/**
 * dev 렌더러 origin 불변식 회귀 테스트 (티켓 L1LQjuQhRiW2hIoBkOAs).
 *
 * 이 테스트들은 소스 문자열을 grep 하지 않는다. 실제 루프백 소켓을 띄우고, 실제로
 * HTTP 로 붙어보고, 모듈을 실제로 다시 로드해서 **동작**으로 확인한다.
 *
 * 지키려는 불변식: "dev 를 몇 번을 재기동하든, vite 가 ::1 에 뜨든 127.0.0.1 에
 * 뜨든, 렌더러가 로드하는 web origin 은 언제나 같은 문자열이다."
 * Firebase Auth 의 로그인 세션(localStorage)은 origin 단위로 격리되므로 이 불변식이
 * 깨지는 순간 재기동마다 로그인이 사라진다.
 */
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEV_SERVER_HOST,
  DEV_SERVER_PORT,
  devServerOrigin,
  devServerUnavailableMessage,
  devServerUrl,
  waitForDevServer,
} from "../../electron/dev-server-origin";

const BODY = "marblo-dev-server";

/** 비어있는 포트 하나를 잡아둔다(테스트가 사장님의 실제 5173 을 건드리면 안 된다). */
async function reserveEphemeralPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** 특정 루프백 패밀리에만 바인딩된 dev 서버 흉내. */
function listenOn(host: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(BODY);
    });
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** devServerUrl() 이 만든 URL 로 실제 GET. 응답 본문을 돌려준다. */
function getBody(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve(body));
    });
    req.setTimeout(3000, () => req.destroy(new Error("timeout")));
    req.once("error", reject);
  });
}

/** 이 머신에서 `localhost` 가 실제로 어떤 패밀리로 풀리는지. */
async function resolvableLoopbackHosts(): Promise<string[]> {
  const entries = await dns.lookup(DEV_SERVER_HOST, { all: true });
  const addresses = new Set(entries.map((e) => e.address));
  return ["::1", "127.0.0.1"].filter((h) => addresses.has(h));
}

describe("dev 렌더러 origin 은 재기동 사이에 고정된다", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("vite 가 ::1 에 떴든 127.0.0.1 에 떴든 렌더러가 로드하는 URL 은 같고, 둘 다 실제로 붙는다", async () => {
    const hosts = await resolvableLoopbackHosts();
    // localhost 가 한 패밀리로만 풀리는 머신에선 비교 자체가 성립하지 않는다.
    // 그런 환경을 억지로 통과시키지 말고 무엇이 확인됐는지 남긴다.
    expect(hosts.length).toBeGreaterThan(0);

    const port = await reserveEphemeralPort();
    const urlsSeenPerBoot: string[] = [];

    for (const bindHost of hosts) {
      // 한 번의 "dev 재기동" = 서버가 이 패밀리에만 바인딩된 상태.
      const server = await listenOn(bindHost, port);
      try {
        const probe = await waitForDevServer({
          port,
          timeoutMs: 3000,
          pollMs: 50,
        });
        expect(probe.ok).toBe(true);

        const url = devServerUrl("", port);
        urlsSeenPerBoot.push(url);
        // ★핵심: 바인딩 패밀리가 달라도 같은 URL 로 실제 접속이 된다.
        await expect(getBody(url)).resolves.toBe(BODY);
      } finally {
        await close(server);
      }
    }

    // 모든 재기동에서 URL 문자열이 동일해야 한다.
    expect(new Set(urlsSeenPerBoot).size).toBe(1);
    expect(new URL(urlsSeenPerBoot[0]).origin).toBe(devServerOrigin(port));
  });

  it("모듈을 새로 로드해도(=프로세스 재기동) 주변 환경변수와 무관하게 같은 origin 을 낸다", async () => {
    const envVariations: Array<Record<string, string>> = [
      {},
      { PORT: "5999" },
      { VITE_PORT: "6001", HOST: "127.0.0.1" },
      { npm_config_port: "6002" },
    ];

    const seen = new Set<string>();
    for (const overrides of envVariations) {
      const saved = new Map<string, string | undefined>();
      for (const [k, v] of Object.entries(overrides)) {
        saved.set(k, process.env[k]);
        process.env[k] = v;
      }
      try {
        vi.resetModules();
        const fresh = await import("../../electron/dev-server-origin");
        seen.add(fresh.devServerUrl("?detached=board"));
      } finally {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }

    expect([...seen]).toEqual([
      `http://localhost:${DEV_SERVER_PORT}?detached=board`,
    ]);
  });

  it("창 종류가 달라도(detached 쿼리) origin 은 같다 — 창 사이 로그인 공유의 전제", () => {
    const main = new URL(devServerUrl()).origin;
    const board = new URL(devServerUrl("?detached=board")).origin;
    const code = new URL(devServerUrl("?detached=code")).origin;
    expect(board).toBe(main);
    expect(code).toBe(main);
  });
});

describe("dev 서버를 못 잡으면 조용히 넘어가지 않는다", () => {
  it("아무도 안 떠 있으면 waitForDevServer 는 ok:false 를 돌려준다(런처는 여기서 종료한다)", async () => {
    const port = await reserveEphemeralPort();
    const result = await waitForDevServer({
      port,
      timeoutMs: 300,
      pollMs: 50,
    });
    expect(result).toEqual({ ok: false, host: null });
  });

  it("실패 안내에는 포트·확인 명령·origin 이 고정이라는 사실이 들어간다", () => {
    const message = devServerUnavailableMessage(DEV_SERVER_PORT);
    expect(message).toContain(String(DEV_SERVER_PORT));
    expect(message).toContain("strictPort");
    expect(message).toContain("lsof");
    expect(message).toContain(devServerOrigin());
  });

  it("실제 vite 설정이 strictPort 와 공유 포트 상수를 쓴다 — 5173 을 뺏기면 5174 로 밀려나지 않는다", async () => {
    const { loadConfigFromFile } = await import("vite");
    const configPath = new URL("../../vite.config.ts", import.meta.url)
      .pathname;
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: "development" },
      configPath,
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.config.server?.port).toBe(DEV_SERVER_PORT);
    expect(loaded?.config.server?.strictPort).toBe(true);
  }, 30_000);
});

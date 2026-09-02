/**
 * dev 렌더러 origin 의 단일 소스 (티켓 L1LQjuQhRiW2hIoBkOAs).
 *
 * ★왜 이 파일이 있나
 * Firebase Auth 의 persistence(localStorage)는 **web origin 단위**로 격리된다.
 * origin 은 scheme+host+port 셋 다 포함하므로 dev 창이 어떤 URL 로 뜨는지가
 * 곧 "로그인이 유지되는가" 다. 프로덕션 경로는 이미 main.ts 의 shared static
 * server 가 하나의 http://127.0.0.1:<고정포트> origin 을 보장하지만(같은 파일
 * 머리주석 참조), dev 경로에는 그런 보장이 코드로 남아있지 않고
 * `http://localhost:5173` 리터럴이 main.ts 안에 박혀 있을 뿐이었다.
 *
 * ★실측으로 확인된 사실 (2026-09-02, 티켓 L1LQjuQhRiW2hIoBkOAs)
 *  - 지금 도는 dev 렌더러의 origin 은 리터럴 `http://localhost:5173` 이다
 *    (CDP /json/list 실측). `::1` 도 `127.0.0.1` 도 아니다.
 *  - Local Storage leveldb 에 존재하는 dev origin 은 `http://localhost:5173`
 *    하나뿐이다. 5174·[::1]·127.0.0.1 변종은 생긴 적이 없다.
 *  - 즉 scripts/dev-electron.mjs 의 HOSTS(::1, 127.0.0.1)는 "vite 가 떴나"를
 *    보는 **readiness 프로브일 뿐** 렌더러 origin 을 정하지 않는다. 어느 쪽
 *    루프백 패밀리에 바인딩됐든 렌더러는 `localhost` 로 접속하므로 origin 은
 *    같다.
 *
 * 그래서 이 모듈은 "고쳐야 할 버그"가 아니라 **이미 성립하는 불변식을 코드로
 * 고정**한다. 포트/호스트 표기를 세 곳(vite.config.ts, dev-electron.mjs,
 * main.ts)에 흩어두면 언젠가 한 곳만 바뀌어 origin 이 갈라진다 — 과거 프로덕션
 * 창별 랜덤포트 회귀가 정확히 그 사고였다. 여기 한 곳만 고치면 셋이 같이 움직인다.
 *
 * 이 파일은 electron/ 아래 있지만 electron API 를 쓰지 않는다. vite.config.ts
 * (esbuild), dist-electron 으로 컴파일된 main.js(electron), scripts/dev-electron.mjs
 * (순수 node) 셋 다 이 모듈 하나를 읽는다.
 */
import net from "node:net";

/**
 * 렌더러가 접속할 호스트 표기. **반드시 `localhost` 하나**여야 한다.
 * `127.0.0.1` 이나 `[::1]` 로 바꾸면 origin 이 달라져 기존 로그인 세션
 * (localStorage 의 firebase:authUser)이 통째로 안 보이게 된다.
 */
export const DEV_SERVER_HOST = "localhost";

/** vite dev 서버 포트. vite.config.ts 의 server.port 와 같은 값을 여기서 준다. */
export const DEV_SERVER_PORT = 5173;

/**
 * readiness 프로브가 찔러볼 루프백 주소들. vite 는 플랫폼/설정에 따라 `::1`
 * 에만 바인딩하기도 하고(현재 macOS 실측이 그렇다) `127.0.0.1` 에만 바인딩하기도
 * 한다. 어느 쪽이 떠 있든 "떴다"로 판정하기 위해 둘 다 찌른다.
 * ★이 목록은 origin 과 무관하다 — 렌더러는 언제나 DEV_SERVER_HOST 로 접속한다.
 */
export const DEV_SERVER_PROBE_HOSTS: readonly string[] = ["::1", "127.0.0.1"];

/** dev 렌더러의 web origin. 재기동 사이에 반드시 동일해야 한다. */
export function devServerOrigin(port: number = DEV_SERVER_PORT): string {
  return `http://${DEV_SERVER_HOST}:${port}`;
}

/**
 * BrowserWindow.loadURL 에 넘길 dev URL.
 * @param query `?detached=board` 같은 쿼리스트링(선택). 쿼리는 origin 을 바꾸지
 *   않으므로 창 종류가 달라도 auth 세션은 공유된다.
 */
export function devServerUrl(
  query = "",
  port: number = DEV_SERVER_PORT,
): string {
  return `${devServerOrigin(port)}${query}`;
}

/** dev 서버에 붙지 못했을 때 띄울 안내. 조용한 폴백 대신 이걸 보여주고 죽는다. */
export function devServerUnavailableMessage(
  port: number = DEV_SERVER_PORT,
  timeoutMs = 30000,
): string {
  return [
    `[dev-electron] vite dev 서버(${devServerOrigin(port)})에 ${Math.round(
      timeoutMs / 1000,
    )}초 안에 붙지 못했습니다. electron 을 띄우지 않고 중단합니다.`,
    "",
    `가장 흔한 원인: 다른 Marblo dev 인스턴스가 이미 ${port} 를 점유하고 있다.`,
    `vite 는 strictPort:true 라 다른 포트로 조용히 밀려나지 않고 그 자리에서 죽는다`,
    `— 위쪽 vite 로그에 "Port ${port} is already in use" 가 찍혔는지 확인할 것.`,
    "",
    `확인:  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    "조치:  기존 dev 인스턴스를 끄고 다시 띄우거나, 그 인스턴스에서 개발한다.",
    "",
    `※ 렌더러 origin 은 ${devServerOrigin(port)} 로 고정돼 있다. 포트를 바꿔서`,
    "  띄우면 origin 이 달라져 Firebase 로그인 세션(localStorage)이 분리된다.",
  ].join("\n");
}

/** 한 루프백 주소에 TCP 연결이 되는지 확인한다. */
export function probeDevServerHost(
  host: string,
  port: number = DEV_SERVER_PORT,
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export interface DevServerWaitOptions {
  port?: number;
  hosts?: readonly string[];
  timeoutMs?: number;
  pollMs?: number;
}

export interface DevServerWaitResult {
  /** dev 서버가 응답했는가. false 면 호출자는 조용히 넘어가지 말고 실패시켜야 한다. */
  ok: boolean;
  /** 실제로 응답한 루프백 주소. 진단용일 뿐 origin 에는 영향이 없다. */
  host: string | null;
}

/** dev 서버가 뜰 때까지 폴링한다. 타임아웃이면 ok:false 로 돌려주고 판단은 호출자에게 맡긴다. */
export async function waitForDevServer(
  options: DevServerWaitOptions = {},
): Promise<DevServerWaitResult> {
  const port = options.port ?? DEV_SERVER_PORT;
  const hosts = options.hosts ?? DEV_SERVER_PROBE_HOSTS;
  const timeoutMs = options.timeoutMs ?? 30000;
  const pollMs = options.pollMs ?? 300;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const results = await Promise.all(
      hosts.map(async (host) => ({
        host,
        ok: await probeDevServerHost(host, port, Math.min(pollMs * 3, 1000)),
      })),
    );
    const hit = results.find((r) => r.ok);
    if (hit) return { ok: true, host: hit.host };
    if (Date.now() >= deadline) return { ok: false, host: null };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

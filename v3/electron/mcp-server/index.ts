import fs from "fs";
import os from "os";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authReady } from "./firebase.js";
import {
  registerTools,
  restoreLedgerChain,
  restoreLedgerSpool,
} from "./tools.js";
import { registerPrompts } from "./prompts.js";
import { bakedBuildStamp, entryPath, formatBootBanner } from "./build-info.js";

// ── 전역 안전망 ──────────────────────────────────────────────────────────────
// 단일 unhandledRejection / uncaughtException 로 MCP 프로세스가 죽으면 클라이언트
// (Claude Code / Codex)의 stdio transport 가 통째로 끊긴다. 세션 도중 한 번의
// 비치명적 에러로 서버가 사라지지 않도록 로깅만 하고 생존시킨다.
// ★ stdout 으로는 절대 출력하지 않는다 — JSONRPC 프레임이 오염되면 strict
//   클라이언트가 연결을 끊는다. 반드시 console.error(stderr) 만 사용.
process.on("unhandledRejection", (reason) => {
  console.error("[MCP] Unhandled promise rejection (surviving):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[MCP] Uncaught exception (surviving):", err);
});

// Resolve bridge port from env (set when launched as Marblo's child) or
// from the port-discovery file (~/.marblo/bridge-port) when launched as a
// globally-registered MCP by an external Claude Code session.
//
// 부모(Electron)가 env 로 포트를 직접 주입한 경우는 그 값을 신뢰하고 건드리지
// 않는다. discovery 파일에서 읽어온 경우에만 이후 백그라운드 리프레셔로 갱신한다.
let resolvedFromDiscoveryFile = false;

function readBridgePortFile(): string | null {
  try {
    const portPath = path.join(os.homedir(), ".marblo", "bridge-port");
    if (!fs.existsSync(portPath)) return null;
    const port = fs.readFileSync(portPath, "utf-8").trim();
    return port || null;
  } catch (err) {
    console.error("[MCP] Failed to read bridge-port discovery file:", err);
    return null;
  }
}

// Per-session bearer token guarding the bridge's command endpoints. Mirrors the
// port discovery file (~/.marblo/bridge-token, 0600). Read it only when the
// parent didn't inject MARBLO_BRIDGE_TOKEN via env (external-CLI path).
function readBridgeTokenFile(): string | null {
  try {
    const tokenPath = path.join(os.homedir(), ".marblo", "bridge-token");
    if (!fs.existsSync(tokenPath)) return null;
    const token = fs.readFileSync(tokenPath, "utf-8").trim();
    return token || null;
  } catch (err) {
    console.error("[MCP] Failed to read bridge-token discovery file:", err);
    return null;
  }
}

function resolveBridgePort(): void {
  if (process.env.MARBLO_BRIDGE_PORT) return;
  const port = readBridgePortFile();
  if (port) {
    process.env.MARBLO_BRIDGE_PORT = port;
    resolvedFromDiscoveryFile = true;
    console.error(`[MCP] Using bridge port ${port} from discovery file`);
  }
}

function resolveBridgeToken(): void {
  if (process.env.MARBLO_BRIDGE_TOKEN) return;
  const token = readBridgeTokenFile();
  if (token) {
    process.env.MARBLO_BRIDGE_TOKEN = token;
    console.error("[MCP] Loaded bridge token from discovery file");
  }
}

// bridge 가 다른 포트로 재기동되면 discovery 파일은 갱신되지만 우리 env 는 stale 해
// 진다. tools.ts 의 bridge 호출부는 매 호출 process.env.MARBLO_BRIDGE_PORT 를 직접
// 읽으므로, 여기서 주기적으로 파일을 재읽어 env 를 최신 포트로 맞춰두면 다음
// 호출이 자동으로 재연결된다(한 번의 stale 포트 실패로 죽지 않게 하는 방어선).
const BRIDGE_PORT_REFRESH_MS = 3000;

function refreshBridgePortFromFile(): void {
  // discovery 파일에서 해석한 경우에만 갱신한다. 부모가 직접 주입한 포트는
  // 신뢰원이므로 stale 파일로 덮어쓰지 않는다.
  if (!resolvedFromDiscoveryFile) return;
  const port = readBridgePortFile();
  if (!port) return; // 파일이 잠깐 비거나 사라진 경우 기존 포트를 유지.
  if (port !== process.env.MARBLO_BRIDGE_PORT) {
    console.error(
      `[MCP] Bridge port changed ${process.env.MARBLO_BRIDGE_PORT} -> ${port}; refreshed from discovery file`,
    );
    process.env.MARBLO_BRIDGE_PORT = port;
  }
  // A bridge restart rotates the token too — keep env in sync so the next call
  // authenticates against the new bridge instead of 401ing on the stale token.
  const token = readBridgeTokenFile();
  if (token && token !== process.env.MARBLO_BRIDGE_TOKEN) {
    process.env.MARBLO_BRIDGE_TOKEN = token;
  }
}

function startBridgePortRefresher(): void {
  if (!resolvedFromDiscoveryFile) return;
  const timer = setInterval(refreshBridgePortFromFile, BRIDGE_PORT_REFRESH_MS);
  // 리프레셔가 프로세스 종료를 막지 않도록 unref.
  if (typeof timer.unref === "function") timer.unref();
}

resolveBridgePort();
resolveBridgeToken();

const server = new McpServer({
  name: "Marblo",
  version: "3.0.0",
});

registerTools(server);
registerPrompts(server);

async function main() {
  // ★ stdio transport 를 먼저 connect 한다 — MCP 핸드셰이크(initialize →
  // tools/list)를 즉시 응답하기 위함. 예전엔 이 connect 가 `await authReady`
  // (Firebase 익명 인증, 최대 ~10s) 뒤에 있어, 인증이 느리거나 오프라인일 때
  // 핸드셰이크가 Codex 의 MCP startup timeout(현행 Codex CLI 기본 ~10s) 경계 밖
  // 에서 응답 → Codex 가 marblo 서버를 실패 처리하고 32개 도구 전부 tool_search
  // 인덱스에 미등록되었다(반면 fallback CLI 의 health 는 authReady 이전에 반환돼
  // 항상 OK 로 보여 진짜 실패를 가렸다). 인증은 이제 tools.ts 의 각 도구 호출부
  // (auditedTool)에서 개별적으로 await 하므로, Firestore 접근은 여전히 인증 완료를
  // 기다리되 도구 노출(discovery)은 인증에 막히지 않는다.
  // ★체인 머리는 connect **전에** 이어받는다(L3, §6). 로컬 파일 한 번 읽기라
  // 네트워크를 타지 않고 핸드셰이크를 유의미하게 늦추지 않는다 — 아래 스풀 재적재
  // (네트워크 쓰기)를 await 하지 않는 것과 대비된다.
  //
  // 여기가 아니라 아래(스풀 재적재 자리)에 두면 connect 와 `await authReady`
  // (최대 ~10s) 사이에 도착한 툴 호출이 seq 0 부터 봉인되고, 그 뒤 복원이 머리를
  // 이전 기동 값으로 덮어써 **원장에 같은 자리가 두 벌** 생긴다. 검증이 duplicate-seq
  // 로 잡아내긴 하지만, 매 재기동마다 나는 경보는 진짜 사고를 묻는다.
  await restoreLedgerChain();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Marblo MCP Server v3.0 started (stdio)");
  // Which build is this process actually running? Without this line a stale
  // process is indistinguishable from a current one — the failure that let
  // PR#486 look unapplied for a week while 23 orphaned servers kept serving
  // pre-fix code (ticket SsHpTM43EqqPTM1ZWQVA). stderr only: stdout carries the
  // JSONRPC frames.
  console.error(formatBootBanner(bakedBuildStamp(), entryPath()));

  startBridgePortRefresher();

  // 인증은 백그라운드에서 진행/대기 — 핸드셰이크를 절대 막지 않는다. authReady 는
  // reject 하지 않고 ~10s 타임아웃 가드가 있어 실패/지연에도 여기서 멈추지 않는다.
  await authReady;

  // 이전 기동에서 원장에 못 들어간 감사 이벤트를 순서 보존해 재적재한다(L1, §7).
  // 인증 뒤에 돌리되 await 하지 않는다 — 재적재가 서버 기동을 막으면 안 된다.
  // 실패해도 스풀은 그대로 남고 백오프 재시도가 이어진다.
  void restoreLedgerSpool();
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});

import fs from "fs";
import os from "os";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authReady } from "./firebase.js";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";

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
  // Firebase 익명 인증 대기 (Firestore 접근 전 권장) — 단, authReady 는 절대
  // reject 하지 않고 타임아웃 가드(~10s)가 걸려 있어 인증 지연/실패에도 서버는 기동된다.
  await authReady;

  startBridgePortRefresher();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Marblo MCP Server v3.0 started (stdio)");
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});

import fs from "fs";
import os from "os";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authReady } from "./firebase.js";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";

// Resolve bridge port from env (set when launched as Marblo's child) or
// from the port-discovery file (~/.marblo/bridge-port) when launched as a
// globally-registered MCP by an external Claude Code session.
function resolveBridgePort(): void {
  if (process.env.MARBLO_BRIDGE_PORT) return;
  try {
    const portPath = path.join(os.homedir(), ".marblo", "bridge-port");
    if (fs.existsSync(portPath)) {
      const port = fs.readFileSync(portPath, "utf-8").trim();
      if (port) {
        process.env.MARBLO_BRIDGE_PORT = port;
        console.error(`[MCP] Using bridge port ${port} from discovery file`);
      }
    }
  } catch (err) {
    console.error("[MCP] Failed to read bridge-port discovery file:", err);
  }
}

resolveBridgePort();

const server = new McpServer({
  name: "Marblo",
  version: "3.0.0",
});

registerTools(server);
registerPrompts(server);

async function main() {
  // Firebase 익명 인증이 완료될 때까지 대기 (Firestore 접근 전 필수)
  await authReady;

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Marblo MCP Server v3.0 started (stdio)");
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});

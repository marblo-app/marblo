import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import {
  createSession,
  destroySession,
  resizeSession,
  destroyAllSessions,
  getSessionCount,
} from "./pty-manager.js";

const PORT = Number(process.env.PORT) || 7681;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
]);

// ---------------------------------------------------------------------------
// Express app — health check
// ---------------------------------------------------------------------------
const app = express();

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeSessions: getSessionCount(),
    uptime: process.uptime(),
  });
});

// ---------------------------------------------------------------------------
// HTTP server + WebSocket upgrade
// ---------------------------------------------------------------------------
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Origin validation — only allow known localhost origins
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    console.warn(`[ws] Rejected connection from origin: ${origin}`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Only accept upgrades on /ws path
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------
wss.on("connection", (ws, req) => {
  const sessionId = crypto.randomUUID();
  console.log(`[ws] New connection — session ${sessionId}`);

  // Parse initial cols/rows from query string if provided
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const initCols = Number(url.searchParams.get("cols")) || 80;
  const initRows = Number(url.searchParams.get("rows")) || 24;

  let session;
  try {
    session = createSession(sessionId, initCols, initRows);
  } catch (err) {
    console.error(`[ws] Failed to create PTY session:`, err);
    ws.close(1011, "Failed to create terminal session");
    return;
  }

  // PTY stdout -> WebSocket
  const onPtyData = session.pty.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // PTY exit -> close WebSocket
  const onPtyExit = session.pty.onExit(({ exitCode, signal }) => {
    console.log(
      `[ws] PTY exited — session ${sessionId} (code=${exitCode}, signal=${signal})`,
    );
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "Terminal process exited");
    }
    cleanup();
  });

  // WebSocket messages -> PTY stdin (or control messages)
  ws.on("message", (raw: Buffer | string) => {
    const msg = typeof raw === "string" ? raw : raw.toString("utf-8");

    // Try to parse as JSON control message
    if (msg.startsWith("{")) {
      try {
        const ctrl = JSON.parse(msg);
        if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
          resizeSession(sessionId, Number(ctrl.cols), Number(ctrl.rows));
          return;
        }
        // Unknown control message — fall through and treat as input
      } catch {
        // Not valid JSON — treat as regular terminal input
      }
    }

    // Regular terminal input
    session.pty.write(msg);
  });

  // Cleanup on disconnect
  function cleanup() {
    onPtyData.dispose();
    onPtyExit.dispose();
    destroySession(sessionId);
  }

  ws.on("close", () => {
    console.log(`[ws] Connection closed — session ${sessionId}`);
    cleanup();
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error — session ${sessionId}:`, err);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal: string) {
  console.log(`\n[server] Received ${signal}, shutting down...`);
  destroyAllSessions();
  wss.close(() => {
    server.close(() => {
      console.log("[server] Shutdown complete.");
      process.exit(0);
    });
  });
  // Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Terminal sidecar listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[server] Health check: http://localhost:${PORT}/health`);
});

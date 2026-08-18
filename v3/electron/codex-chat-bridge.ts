/**
 * Local Responses → Chat Completions bridge for Codex custom providers.
 *
 * Codex 0.147 only speaks wire_api=responses. Vendors that expose only
 * /v1/chat/completions (Upstage Solar today) need this localhost shim so
 * model_providers.<id> can still force API-key auth away from ChatGPT.
 *
 * Scope: stateless text + function tools (Codex client-executed). Hosted
 * tools (web_search / namespace) are dropped — Codex degrades without them.
 */
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import { URL } from "url";
import { spawn, type ChildProcess } from "child_process";
import { execFileSync } from "child_process";

export interface CodexChatBridgeHandle {
  /** base_url Codex should use, e.g. http://127.0.0.1:54321/v1 */
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export interface BridgeOptions {
  upstreamBaseUrl: string;
  /** Bearer token forwarded to upstream (never logged). */
  apiKey: string;
  /** Optional bind host; default 127.0.0.1 */
  host?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (
      part.type === "input_text" ||
      part.type === "output_text" ||
      part.type === "text"
    ) {
      if (typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("");
}

/** Convert Responses request body → Chat Completions body. */
export function responsesRequestToChatCompletions(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }

  const input = body.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    let pendingToolCalls: Array<Record<string, unknown>> = [];
    const flushAssistant = () => {
      if (pendingToolCalls.length === 0) return;
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: pendingToolCalls,
      });
      pendingToolCalls = [];
    };

    for (const item of input) {
      if (typeof item === "string") {
        flushAssistant();
        messages.push({ role: "user", content: item });
        continue;
      }
      if (!isRecord(item)) continue;
      const type = item.type;

      if (type === "message" || item.role) {
        flushAssistant();
        const role = typeof item.role === "string" ? item.role : "user";
        const mappedRole =
          role === "developer" || role === "system"
            ? "system"
            : role === "assistant"
              ? "assistant"
              : "user";
        messages.push({
          role: mappedRole,
          content: textFromContent(item.content) || "",
        });
        continue;
      }

      if (type === "function_call") {
        const callId =
          (typeof item.call_id === "string" && item.call_id) ||
          (typeof item.id === "string" && item.id) ||
          `call_${randomBytes(4).toString("hex")}`;
        pendingToolCalls.push({
          id: callId,
          type: "function",
          function: {
            name: typeof item.name === "string" ? item.name : "",
            arguments:
              typeof item.arguments === "string"
                ? item.arguments
                : JSON.stringify(item.arguments ?? {}),
          },
        });
        continue;
      }

      if (type === "function_call_output") {
        flushAssistant();
        const callId =
          (typeof item.call_id === "string" && item.call_id) ||
          (typeof item.id === "string" && item.id) ||
          "";
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content:
            typeof item.output === "string"
              ? item.output
              : JSON.stringify(item.output ?? ""),
        });
        continue;
      }
    }
    flushAssistant();
  }

  const toolsIn = Array.isArray(body.tools) ? body.tools : [];
  const tools = toolsIn
    .filter(
      (t): t is Record<string, unknown> => isRecord(t) && t.type === "function",
    )
    .map((t) => {
      if (isRecord(t.function)) {
        return { type: "function", function: t.function };
      }
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          ...(typeof t.strict === "boolean" ? { strict: t.strict } : {}),
        },
      };
    });

  const chat: Record<string, unknown> = {
    model: body.model,
    messages,
    stream: body.stream !== false,
  };
  if (tools.length > 0) {
    chat.tools = tools;
    chat.tool_choice = body.tool_choice ?? "auto";
  }
  if (typeof body.temperature === "number") chat.temperature = body.temperature;
  if (typeof body.top_p === "number") chat.top_p = body.top_p;
  if (typeof body.max_output_tokens === "number") {
    chat.max_tokens = body.max_output_tokens;
  }
  return chat;
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function newResponseId(): string {
  return `resp_${randomBytes(12).toString("hex")}`;
}

function newMsgId(): string {
  return `msg_${randomBytes(12).toString("hex")}`;
}

async function pipeChatStreamToResponses(
  upstream: Response,
  res: http.ServerResponse,
  model: string,
): Promise<void> {
  const responseId = newResponseId();
  const createdAt = Math.floor(Date.now() / 1000);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  sseWrite(res, "response.created", {
    type: "response.created",
    response: {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: "in_progress",
      model,
      output: [],
    },
  });
  sseWrite(res, "response.in_progress", {
    type: "response.in_progress",
    response: { id: responseId, status: "in_progress" },
  });

  let messageStarted = false;
  let messageId = "";
  let outputText = "";
  const toolAcc = new Map<
    number,
    { callId: string; name: string; arguments: string; itemEmitted: boolean }
  >();
  let usage: Record<string, unknown> | undefined;

  const reader = upstream.body?.getReader();
  if (!reader) {
    sseWrite(res, "response.failed", {
      type: "response.failed",
      response: {
        id: responseId,
        status: "failed",
        error: { message: "empty upstream body" },
      },
    });
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const ensureMessage = () => {
    if (messageStarted) return;
    messageStarted = true;
    messageId = newMsgId();
    sseWrite(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "message",
        id: messageId,
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    });
    sseWrite(res, "response.content_part.added", {
      type: "response.content_part.added",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "" },
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === "data: [DONE]") continue;
      if (!line.startsWith("data:")) continue;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (isRecord(chunk.usage)) usage = chunk.usage;

      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      const choice = isRecord(choices[0]) ? choices[0] : null;
      if (!choice) continue;
      const delta = isRecord(choice.delta) ? choice.delta : {};

      if (typeof delta.content === "string" && delta.content) {
        ensureMessage();
        outputText += delta.content;
        sseWrite(res, "response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta: delta.content,
        });
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const tc of toolCalls) {
        if (!isRecord(tc)) continue;
        const index = typeof tc.index === "number" ? tc.index : 0;
        const fn = isRecord(tc.function) ? tc.function : {};
        let acc = toolAcc.get(index);
        if (!acc) {
          const callId =
            (typeof tc.id === "string" && tc.id) ||
            `call_${randomBytes(4).toString("hex")}`;
          acc = {
            callId,
            name: typeof fn.name === "string" ? fn.name : "",
            arguments: "",
            itemEmitted: false,
          };
          toolAcc.set(index, acc);
        }
        if (typeof fn.name === "string" && fn.name) acc.name = fn.name;
        if (typeof fn.arguments === "string") acc.arguments += fn.arguments;

        if (!acc.itemEmitted && acc.name) {
          acc.itemEmitted = true;
          sseWrite(res, "response.output_item.added", {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              call_id: acc.callId,
              name: acc.name,
              arguments: "",
            },
          });
        }
        if (typeof fn.arguments === "string" && fn.arguments) {
          sseWrite(res, "response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            call_id: acc.callId,
            delta: fn.arguments,
          });
        }
      }
    }
  }

  const output: Array<Record<string, unknown>> = [];
  if (messageStarted) {
    sseWrite(res, "response.output_text.done", {
      type: "response.output_text.done",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      text: outputText,
    });
    sseWrite(res, "response.content_part.done", {
      type: "response.content_part.done",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: outputText },
    });
    sseWrite(res, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: messageId,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: outputText }],
      },
    });
    output.push({
      type: "message",
      id: messageId,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: outputText }],
    });
  }

  for (const acc of toolAcc.values()) {
    if (!acc.itemEmitted) continue;
    sseWrite(res, "response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      call_id: acc.callId,
      arguments: acc.arguments,
    });
    sseWrite(res, "response.output_item.done", {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: acc.callId,
        name: acc.name,
        arguments: acc.arguments,
      },
    });
    output.push({
      type: "function_call",
      call_id: acc.callId,
      name: acc.name,
      arguments: acc.arguments,
    });
  }

  sseWrite(res, "response.completed", {
    type: "response.completed",
    response: {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: "completed",
      model,
      output,
      ...(usage
        ? {
            usage: {
              input_tokens: Number(usage.prompt_tokens ?? 0),
              output_tokens: Number(usage.completion_tokens ?? 0),
              total_tokens: Number(usage.total_tokens ?? 0),
            },
          }
        : {}),
    },
  });
  res.end();
}

async function handleResponsesPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: BridgeOptions,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid JSON body" } }));
    return;
  }

  const chatBody = responsesRequestToChatCompletions(body);
  const upstream = opts.upstreamBaseUrl.replace(/\/$/, "");
  const url = `${upstream}/chat/completions`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(chatBody),
    });
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: `upstream fetch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      }),
    );
    return;
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, { "Content-Type": "application/json" });
    res.end(text);
    return;
  }

  const model = typeof body.model === "string" ? body.model : "unknown";
  if (chatBody.stream) {
    await pipeChatStreamToResponses(upstreamRes, res, model);
    return;
  }

  const data = (await upstreamRes.json()) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const message =
    isRecord(choices[0]) && isRecord(choices[0].message)
      ? choices[0].message
      : {};
  const content = typeof message.content === "string" ? message.content : "";
  const responseId = newResponseId();
  const output: Array<Record<string, unknown>> = [];
  if (content) {
    output.push({
      type: "message",
      id: newMsgId(),
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: content }],
    });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const tc of toolCalls) {
    if (!isRecord(tc)) continue;
    const fn = isRecord(tc.function) ? tc.function : {};
    output.push({
      type: "function_call",
      call_id:
        typeof tc.id === "string"
          ? tc.id
          : `call_${randomBytes(4).toString("hex")}`,
      name: typeof fn.name === "string" ? fn.name : "",
      arguments: typeof fn.arguments === "string" ? fn.arguments : "",
    });
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id: responseId,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model,
      output,
    }),
  );
}

function createBridgeServer(opts: BridgeOptions): http.Server {
  const host = opts.host ?? "127.0.0.1";
  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    if (
      req.method === "POST" &&
      (url.pathname === "/v1/responses" || url.pathname === "/responses")
    ) {
      void handleResponsesPost(req, res, opts).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end(
          JSON.stringify({
            error: {
              message: err instanceof Error ? err.message : String(err),
            },
          }),
        );
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
}

/**
 * Start a per-agent localhost bridge (async). Prefer startCodexChatBridgeSync
 * from the sync getLaunchConfig path.
 */
export function startCodexChatBridge(
  opts: BridgeOptions,
): Promise<CodexChatBridgeHandle> {
  const host = opts.host ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    const server = createBridgeServer(opts);
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("bridge listen failed"));
        return;
      }
      const port = addr.port;
      resolve({
        baseUrl: `http://${host}:${port}/v1`,
        port,
        stop: () =>
          new Promise((resStop, rejStop) => {
            server.close((err) => (err ? rejStop(err) : resStop()));
          }),
      });
    });
  });
}

function sleepMs(ms: number): void {
  try {
    execFileSync("sleep", [String(ms / 1000)], { stdio: "ignore" });
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

/**
 * Sync bridge start for getLaunchConfig. Spawns a child that loads this
 * compiled module (or the TS-neighbor .js after tsc) and writes its port.
 */
export function startCodexChatBridgeSync(
  opts: BridgeOptions,
): CodexChatBridgeHandle {
  const host = opts.host ?? "127.0.0.1";
  const portFile = path.join(
    os.tmpdir(),
    `marblo-codex-bridge-${process.pid}-${Date.now()}.port`,
  );
  try {
    fs.unlinkSync(portFile);
  } catch {
    /* ignore */
  }

  // Prefer compiled JS next to this file (Electron dist-electron).
  const selfJs = path.join(__dirname, "codex-chat-bridge.js");
  const entry = fs.existsSync(selfJs) ? selfJs : __filename;

  const child: ChildProcess = spawn(
    process.execPath,
    [entry, "--marblo-codex-chat-bridge", portFile],
    {
      env: {
        ...process.env,
        MARBLO_CODEX_BRIDGE_UPSTREAM: opts.upstreamBaseUrl,
        MARBLO_CODEX_BRIDGE_API_KEY: opts.apiKey,
        MARBLO_CODEX_BRIDGE_HOST: host,
      },
      stdio: "ignore",
      detached: false,
    },
  );

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const raw = fs.readFileSync(portFile, "utf8").trim();
      const port = Number.parseInt(raw, 10);
      if (Number.isFinite(port) && port > 0) {
        return {
          baseUrl: `http://${host}:${port}/v1`,
          port,
          stop: async () => {
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
            try {
              fs.unlinkSync(portFile);
            } catch {
              /* ignore */
            }
          },
        };
      }
    }
    if (child.exitCode !== null) break;
    sleepMs(50);
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  throw new Error("codex chat bridge failed to start in time");
}

/** Child-process entry: node codex-chat-bridge.js --marblo-codex-chat-bridge <portFile> */
function runBridgeChildMain(): void {
  const portFile = process.argv[3];
  const upstream = process.env.MARBLO_CODEX_BRIDGE_UPSTREAM || "";
  const apiKey = process.env.MARBLO_CODEX_BRIDGE_API_KEY || "";
  const host = process.env.MARBLO_CODEX_BRIDGE_HOST || "127.0.0.1";
  if (!portFile || !upstream || !apiKey) {
    process.stderr.write("codex-chat-bridge child: missing env/args\n");
    process.exit(2);
  }
  const server = createBridgeServer({ upstreamBaseUrl: upstream, apiKey, host });
  server.listen(0, host, () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      process.exit(3);
    }
    fs.writeFileSync(portFile, String(addr.port), { encoding: "utf8", mode: 0o600 });
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (
  typeof require !== "undefined" &&
  require.main === module &&
  process.argv[2] === "--marblo-codex-chat-bridge"
) {
  runBridgeChildMain();
}

export const __test = {
  responsesRequestToChatCompletions,
};

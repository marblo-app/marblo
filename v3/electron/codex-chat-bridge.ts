/**
 * Local Responses → Chat Completions bridge for Codex custom providers.
 *
 * Codex 0.147 only speaks wire_api=responses. Vendors that expose only
 * /v1/chat/completions (Upstage Solar today) need this localhost shim so
 * model_providers.<id> can still force API-key auth away from ChatGPT.
 *
 * Scope: stateless text + function tools (Codex client-executed). Codex
 * namespace groups (MCP servers, multi_agent_v1) are flattened into plain
 * Chat function tools and restored on the way back. Hosted tools
 * (web_search) have no Chat equivalent and are still dropped.
 */
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { URL } from "url";
import { spawn, type ChildProcess } from "child_process";
import { execFileSync } from "child_process";
import {
  MARBLO_CLIENT_HEADER_NAME,
  MARBLO_CLIENT_HEADER_VALUE,
} from "./codex-vendor-provider";

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

/**
 * codex 0.148.0 은 MCP 서버 도구를 개별 `type:"function"` 으로 보내지 않고
 * `{type:"namespace", name:"mcp__marblo", tools:[...]}` 한 덩어리로 보낸다.
 * Chat Completions 에는 namespace 개념이 없으므로 `<namespace>__<tool>` 로
 * 평탄화해서 upstream 에 넘기고, 응답에서 다시 갈라 codex 에 돌려준다.
 * (2026-08-19 녹음 프록시 실측: marblo 23개 + multi_agent_v1 5개가 이 필터에서
 *  통째로 사라져 solar 에이전트가 MCP 도구를 아예 못 보던 것이 근본원인이다.)
 */
const NAMESPACE_SEPARATOR = "__";
/** OpenAI-compatible function name 상한. Upstage 도 이 규격을 따른다. */
const MAX_CHAT_TOOL_NAME = 64;

export interface NamespacedToolName {
  /** namespace 를 뺀 원래 도구 이름 (예: add_activity) */
  name: string;
  /** codex 가 쓰는 namespace (예: mcp__marblo). 평탄화 대상이 아니면 없다. */
  namespace?: string;
  /**
   * Responses 전용 `type:"custom"` freeform 도구(= apply_patch)인가.
   *
   * ★codex 는 apply_patch 를 JSON function 이 아니라 lark 문법을 실은 custom
   * 도구로 보낸다. Chat Completions 규격엔 그런 타입이 없어서 종전 변환기는 이
   * 도구를 **통째로 버렸다** — 모델 카탈로그를 고쳐 apply_patch 가 등록돼도
   * Upstage 는 브리지에서 다시 잃어버린다는 뜻이다. 그래서 여기서 `input` 문자열
   * 하나짜리 function 으로 접어 upstream 에 넘기고, 응답에서 다시 custom 으로
   * 편다. 이 플래그가 그 왕복의 표식이다.
   */
  freeform?: boolean;
}

/** freeform(custom) 도구를 Chat 으로 접을 때 쓰는 단일 파라미터 스키마. */
function freeformToolParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      input: {
        type: "string",
        description:
          "The raw, unwrapped tool payload text. Emit it verbatim as a JSON " +
          "string value — do not add commentary, markdown fences, or extra keys.",
      },
    },
    required: ["input"],
    additionalProperties: false,
  };
}

/**
 * Chat 쪽 tool_call 인자에서 freeform 원문을 되꺼낸다.
 * 정상 경로는 `{"input":"..."}` 이지만, 모델이 스키마를 무시하고 원문을 그대로
 * 뱉는 경우도 흔하다. 그때 인자를 버리면 편집이 조용히 사라지므로 원문으로 본다.
 */
export function extractFreeformToolInput(rawArguments: string): string {
  const trimmed = rawArguments.trim();
  if (!trimmed) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed;
    if (isRecord(parsed)) {
      if (typeof parsed.input === "string") return parsed.input;
      if (typeof parsed.patch === "string") return parsed.patch;
      const values = Object.values(parsed);
      if (values.length === 1 && typeof values[0] === "string") {
        return values[0];
      }
    }
  } catch {
    // JSON 이 아니면 모델이 원문을 그대로 보낸 것으로 취급한다.
  }
  return rawArguments;
}

/**
 * namespace + 도구명 → Chat 이 받는 단일 function 이름.
 * namespace 자체가 "__" 를 포함하므로(mcp__marblo) 문자열 분해로는 되돌릴 수
 * 없다. 복원은 항상 요청 변환 때 만든 맵으로 한다.
 */
export function flattenNamespacedToolName(
  namespace: string,
  name: string,
): string {
  if (!namespace) return name;
  const flat = `${namespace}${NAMESPACE_SEPARATOR}${name}`;
  if (flat.length <= MAX_CHAT_TOOL_NAME) return flat;
  const digest = createHash("sha1").update(flat).digest("hex").slice(0, 8);
  return `${flat.slice(0, MAX_CHAT_TOOL_NAME - digest.length - 1)}_${digest}`;
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
  /** 채워서 돌려주는 역맵: 평탄화 이름 → {name, namespace}. 응답 복원에 쓴다. */
  toolNames?: Map<string, NamespacedToolName>,
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
        // 히스토리의 function_call 도 namespace 를 실어 온다. upstream 이 이전
        // 턴에서 본 이름과 같아야 하므로 동일한 평탄화를 적용한다.
        const rawName = typeof item.name === "string" ? item.name : "";
        const rawNamespace =
          typeof item.namespace === "string" ? item.namespace : "";
        pendingToolCalls.push({
          id: callId,
          type: "function",
          function: {
            name: flattenNamespacedToolName(rawNamespace, rawName),
            arguments:
              typeof item.arguments === "string"
                ? item.arguments
                : JSON.stringify(item.arguments ?? {}),
          },
        });
        continue;
      }

      if (type === "custom_tool_call") {
        // 히스토리의 freeform 호출. upstream 은 이 도구를 function 으로 봤으므로
        // 같은 모양(`{"input": ...}`)으로 되돌려줘야 대화가 이어진다.
        const callId =
          (typeof item.call_id === "string" && item.call_id) ||
          (typeof item.id === "string" && item.id) ||
          `call_${randomBytes(4).toString("hex")}`;
        pendingToolCalls.push({
          id: callId,
          type: "function",
          function: {
            name: typeof item.name === "string" ? item.name : "",
            arguments: JSON.stringify({
              input: typeof item.input === "string" ? item.input : "",
            }),
          },
        });
        continue;
      }

      if (type === "function_call_output" || type === "custom_tool_call_output") {
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
  const tools: Array<Record<string, unknown>> = [];
  const pushFunctionTool = (
    t: Record<string, unknown>,
    namespace: string,
  ): void => {
    if (isRecord(t.function)) {
      // 이미 Chat 모양으로 온 경우 (namespace 안에는 오지 않는다).
      tools.push({ type: "function", function: t.function });
      return;
    }
    const bare = typeof t.name === "string" ? t.name : "";
    if (!bare) return;
    const flat = flattenNamespacedToolName(namespace, bare);
    if (namespace) toolNames?.set(flat, { name: bare, namespace });
    tools.push({
      type: "function",
      function: {
        name: flat,
        description: t.description,
        parameters: t.parameters,
        ...(typeof t.strict === "boolean" ? { strict: t.strict } : {}),
      },
    });
  };

  for (const t of toolsIn) {
    if (!isRecord(t)) continue;
    if (t.type === "function") {
      pushFunctionTool(t, "");
      continue;
    }
    if (t.type === "custom") {
      // apply_patch 등 freeform 도구. Chat 에는 custom 타입이 없으므로 `input`
      // 문자열 하나짜리 function 으로 접는다. 문법(lark) 은 강제할 수 없으니
      // description 에 그대로 실어 모델이 형식을 지키게 한다.
      const bare = typeof t.name === "string" ? t.name : "";
      if (!bare) continue;
      const grammar =
        isRecord(t.format) && typeof t.format.definition === "string"
          ? t.format.definition
          : "";
      const description = [
        typeof t.description === "string" ? t.description : "",
        grammar
          ? "The `input` string MUST match this grammar exactly:\n" + grammar
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      toolNames?.set(bare, { name: bare, freeform: true });
      tools.push({
        type: "function",
        function: {
          name: bare,
          description,
          parameters: freeformToolParameters(),
        },
      });
      continue;
    }
    if (t.type === "namespace" && Array.isArray(t.tools)) {
      const namespace = typeof t.name === "string" ? t.name : "";
      for (const nested of t.tools) {
        if (!isRecord(nested) || nested.type !== "function") continue;
        pushFunctionTool(nested, namespace);
      }
      continue;
    }
    // 호스티드 도구(web_search 등)는 여전히 옮길 수 없다 — Chat 규격에 없다.
  }

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

/**
 * upstream 이 부른 (평탄화된) 함수 이름을 codex 가 이해하는 모양으로 되돌린다.
 * namespace 도구였다면 `name` 은 원래 이름으로, `namespace` 필드가 따로 붙는다
 * — codex 의 wire 포맷이 그렇다(rollout jsonl 실측:
 * {"type":"function_call","name":"add_activity","namespace":"mcp__marblo",...}).
 */
function decodeToolCallName(
  flatName: string,
  toolNames?: Map<string, NamespacedToolName>,
): { name: string; namespace?: string } {
  const hit = toolNames?.get(flatName);
  if (!hit) return { name: flatName };
  return { name: hit.name, namespace: hit.namespace };
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
  /** 요청 변환에서 만든 평탄화 이름 → {name, namespace} 역맵. */
  toolNames?: Map<string, NamespacedToolName>,
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
    {
      callId: string;
      name: string;
      arguments: string;
      itemEmitted: boolean;
      /** freeform(custom) 도구면 스트리밍 중엔 아무것도 내보내지 않는다. */
      freeform: boolean;
    }
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
            freeform: false,
          };
          toolAcc.set(index, acc);
        }
        if (typeof fn.name === "string" && fn.name) acc.name = fn.name;
        if (typeof fn.arguments === "string") acc.arguments += fn.arguments;
        if (acc.name) acc.freeform = toolNames?.get(acc.name)?.freeform === true;

        // ★freeform 도구는 스트리밍 델타를 내보내지 않는다. upstream 이 보내는
        //   조각은 `{"input":"*** Beg` 같은 **JSON 파편**이라, 그걸 codex 의
        //   custom_tool_call_input.delta 로 그대로 흘리면 패치 원문이 깨진다.
        //   인자가 다 모인 뒤 아래 종료 루프에서 한 번에 편다.
        if (acc.freeform) continue;

        if (!acc.itemEmitted && acc.name) {
          acc.itemEmitted = true;
          sseWrite(res, "response.output_item.added", {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              call_id: acc.callId,
              ...decodeToolCallName(acc.name, toolNames),
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
    if (acc.freeform && acc.name) {
      // Chat function → Responses custom_tool_call 로 되편다. codex 가 이
      // 모양이라야 apply_patch 를 실행한다(`function_call` 로 오면 라우터가
      // 모르는 호출로 처리한다).
      const input = extractFreeformToolInput(acc.arguments);
      const item = {
        type: "custom_tool_call",
        call_id: acc.callId,
        name: acc.name,
        input,
      };
      sseWrite(res, "response.output_item.added", {
        type: "response.output_item.added",
        item: { ...item, input: "" },
      });
      sseWrite(res, "response.custom_tool_call_input.delta", {
        type: "response.custom_tool_call_input.delta",
        call_id: acc.callId,
        delta: input,
      });
      sseWrite(res, "response.custom_tool_call_input.done", {
        type: "response.custom_tool_call_input.done",
        call_id: acc.callId,
        input,
      });
      sseWrite(res, "response.output_item.done", {
        type: "response.output_item.done",
        item,
      });
      output.push(item);
      continue;
    }
    if (!acc.itemEmitted) continue;
    sseWrite(res, "response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      call_id: acc.callId,
      arguments: acc.arguments,
    });
    const decoded = decodeToolCallName(acc.name, toolNames);
    sseWrite(res, "response.output_item.done", {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: acc.callId,
        ...decoded,
        arguments: acc.arguments,
      },
    });
    output.push({
      type: "function_call",
      call_id: acc.callId,
      ...decoded,
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

  const toolNames = new Map<string, NamespacedToolName>();
  const chatBody = responsesRequestToChatCompletions(body, toolNames);
  const upstream = opts.upstreamBaseUrl.replace(/\/$/, "");
  const url = `${upstream}/chat/completions`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        // ★이 브리지는 codex가 보낸 요청을 그대로 중계하지 않고 별도 fetch 를
        // 새로 만든다(위) — 그래서 model_providers.<id>.http_headers 로 얹은
        // 마블로 식별 헤더가 codex→브리지 구간에서만 붙고 브리지→업스트림
        // 구간에서는 조용히 사라진다. 티켓 L78q6A41ubvsN8WX8394: 사장님이
        // 업스테이지에 이미 약속한 헤더라 브리지 경로(롤백용,
        // MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE=1)에서도 빠지면 안 된다 — 여기서
        // 명시적으로 다시 싣는다. 값은 codex-vendor-provider.ts 한 곳(export된
        // 상수)에서만 정의해 두 파일이 서로 다른 값을 실을 수 없게 한다.
        [MARBLO_CLIENT_HEADER_NAME]: MARBLO_CLIENT_HEADER_VALUE,
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
    await pipeChatStreamToResponses(upstreamRes, res, model, toolNames);
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
      ...decodeToolCallName(
        typeof fn.name === "string" ? fn.name : "",
        toolNames,
      ),
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
 *
 * ★ELECTRON_RUN_AS_NODE 는 선택이 아니라 필수다 (2026-08-19, A/B 실측으로 확정).
 *
 *   메인프로세스에서 `process.execPath` 는 node 가 아니라 **Electron 바이너리**다.
 *   그 상태로 `spawn(execPath, [bridge.js, ...])` 하면 Electron 이 bridge.js 를
 *   node 스크립트가 아니라 **GUI 앱 엔트리**로 로드한다. 그 컨텍스트에선 파일
 *   하단의 자식 엔트리 가드가 성립하지 않아 runBridgeChildMain() 이 아예 호출되지
 *   않고, 띄울 창도 없으니 앱이 **EXIT 0 로 조용히 종료**한다 → portFile 미생성 →
 *   기동 실패. stdout·stderr 도 완전히 비어 있어 원인이 전혀 안 남는다.
 *
 *   실측(실제 Electron 바이너리 + 실제 dist-electron/codex-chat-bridge.js):
 *     env 없음            → CHILD EXIT 0, portFile never written, stderr 빈 문자열
 *     ELECTRON_RUN_AS_NODE=1 만 추가 → PORTFILE WRITTEN: 53512
 *
 *   이 침묵이 baseUrl 을 upstream 으로 되돌리는 폴백과 겹쳐, 진짜 실패 지점을
 *   가리고 `api.upstage.ai/v1/responses` 404 추적으로 사람을 보냈다. 폴백은
 *   agent-config 에서 제거했고, 여기서는 실패 사유를 stderr 까지 실어 던진다.
 */
export function startCodexChatBridgeSync(
  opts: BridgeOptions,
): CodexChatBridgeHandle {
  const host = opts.host ?? "127.0.0.1";
  const portFile = path.join(
    os.tmpdir(),
    `marblo-codex-bridge-${process.pid}-${Date.now()}-${randomBytes(4).toString(
      "hex",
    )}.port`,
  );
  try {
    fs.unlinkSync(portFile);
  } catch {
    /* ignore */
  }

  // Prefer compiled JS next to this file (Electron dist-electron).
  const selfJs = path.join(__dirname, "codex-chat-bridge.js");
  const entry = fs.existsSync(selfJs) ? selfJs : __filename;

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MARBLO_CODEX_BRIDGE_UPSTREAM: opts.upstreamBaseUrl,
    MARBLO_CODEX_BRIDGE_API_KEY: opts.apiKey,
    MARBLO_CODEX_BRIDGE_HOST: host,
  };
  // process.execPath 가 Electron 이면 반드시 node 모드로 재실행해야 한다.
  if (process.versions.electron) childEnv.ELECTRON_RUN_AS_NODE = "1";
  // Electron 이 자식에게 물려주는 앱 부팅용 힌트를 지운다 — node 모드에서는
  // 무의미하고, 남아 있으면 진단 로그만 흐린다.
  delete childEnv.ELECTRON_NO_ATTACH_CONSOLE;

  // 실패를 눈에 보이게 만든다: stdio:"ignore" 였을 때 자식이 왜 죽었는지가
  // 전혀 남지 않아 이 버그가 오래 숨어 있었다.
  const child: ChildProcess = spawn(
    process.execPath,
    [entry, "--marblo-codex-chat-bridge", portFile],
    {
      env: childEnv,
      // stdin 을 파이프로 열어 둔다(쓰지는 않는다). 부모가 죽으면 이 파이프가
      // EOF 가 되고 자식이 그걸 보고 스스로 종료한다 — 앱이 크래시해도 API 키를
      // 물고 있는 localhost 서버가 고아로 남지 않는다. 정상 종료는 stop() 의
      // SIGTERM 이 먼저 처리한다.
      stdio: ["pipe", "ignore", "pipe"],
      detached: false,
    },
  );
  let childStderr = "";
  child.stderr?.on("data", (buf: Buffer | string) => {
    if (childStderr.length < 4096) childStderr += String(buf);
  });
  child.stderr?.on("error", () => {
    /* ignore */
  });

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
    if (child.exitCode !== null || child.signalCode !== null) break;
    sleepMs(50);
  }
  const exitCode = child.exitCode;
  const signal = child.signalCode;
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
  const why =
    exitCode !== null || signal !== null
      ? `child exited (code=${String(exitCode)} signal=${String(signal)})`
      : "timed out after 8s";
  throw new Error(
    `codex chat bridge failed to start: ${why}; ` +
      `runtime=${process.execPath} runAsNode=${
        childEnv.ELECTRON_RUN_AS_NODE === "1"
      } entry=${entry}` +
      (childStderr.trim() ? `; stderr=${childStderr.trim().slice(0, 800)}` : ""),
  );
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
  server.on("error", (err: Error) => {
    process.stderr.write(`codex-chat-bridge child: listen failed: ${err.message}\n`);
    process.exit(4);
  });
  server.listen(0, host, () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      process.stderr.write("codex-chat-bridge child: no bound address\n");
      process.exit(3);
    }
    try {
      fs.writeFileSync(portFile, String(addr.port), {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch (err) {
      process.stderr.write(
        `codex-chat-bridge child: port file write failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
      process.exit(5);
    }
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    // close() 가 keep-alive 커넥션 때문에 늘어지면 그냥 내려간다.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // 부모(Electron 메인)가 사라지면 stdin 이 EOF 가 된다 → 고아 브리지 방지.
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.stdin.resume();
}

/**
 * 자식 엔트리 판정. `require.main === module` 하나만 믿으면 안 된다 — Electron 이
 * 이 파일을 앱 엔트리로 로드하거나 번들러를 거치면 그 등식이 깨져 브리지가
 * 조용히 안 뜬다(그게 이번 근본원인이었다). argv 센티넬을 1차 근거로 삼고,
 * 엉뚱한 프로세스가 걸리지 않도록 argv[1] 이 실제로 이 파일인지까지 확인한다.
 */
function isBridgeChildEntry(): boolean {
  if (process.argv[2] !== "--marblo-codex-chat-bridge") return false;
  if (typeof require !== "undefined" && require.main === module) return true;
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (!invoked) return false;
  const self = path.resolve(__filename);
  return (
    invoked === self ||
    invoked === self.replace(/\.ts$/, ".js") ||
    path.basename(invoked).startsWith("codex-chat-bridge.")
  );
}

if (isBridgeChildEntry()) {
  runBridgeChildMain();
}

export const __test = {
  responsesRequestToChatCompletions,
  flattenNamespacedToolName,
};

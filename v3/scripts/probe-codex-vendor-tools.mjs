#!/usr/bin/env node
/**
 * codex 벤더 스폰이 **실제로 보내는 요청 바디**를 캡처한다.
 *
 * ── 왜 있나 ──────────────────────────────────────────────────────────────
 * env-swap 벤더(Upstage/DeepSeek)가 "떴는데 도구가 없다" 로 실패하는 사고를 두 번
 * 겪었다(solar 2026-08-19, deepseek 2026-08-21). 두 번 다 원인은 CLI 로그나 UI 에
 * 안 보였고, **요청 바디의 `tools` 배열**을 봐야만 드러났다.
 *
 * 이 스크립트는 벤더 API 키 **없이** 그걸 본다. 로컬 mock Responses upstream 을
 * 띄우고 codex 를 거기로 보내기 때문이다 — 우리가 upstream 이라 키가 필요 없다.
 * (키가 생긴 뒤에도 유용하다: 진짜 벤더에 쏘기 전에 무엇을 보내는지 먼저 본다.)
 *
 * ── 쓰는 법 ──────────────────────────────────────────────────────────────
 *   node scripts/probe-codex-vendor-tools.mjs [model-id] [--port 8899]
 *   node scripts/probe-codex-vendor-tools.mjs deepseek-v4-flash
 *   node scripts/probe-codex-vendor-tools.mjs gpt-5.5        # 대조군(내장 카탈로그)
 *
 * config.toml / model-catalog.json 은 **우리 실제 코드**로 만든다
 * (`renderCodexVendorProviderToml` + `buildCodexModelCatalog`). 손으로 흉내낸
 * config 를 검증해봐야 라이브 경로를 증명하지 못한다 — 이 파일의 핵심 규율이다.
 *
 * ── 2026-08-21 이 스크립트가 잡아낸 것 (codex 0.149.0) ────────────────────
 *   deepseek-v4-flash → tools 에 `{type:"namespace", name:"mcp__marblo", ...}`
 *   gpt-5.5(대조군)   → namespace 없음, `tool_search` 하나
 * DeepSeek 공식 Responses 호환표는 function/web_search/custom(apply_patch) 셋만
 * 받고 나머지는 무시하므로, namespace 로 실린 MCP 도구는 통째로 버려질 것이다.
 * 자세한 내용은 electron/codex-model-catalog.ts 상단 주석 참조.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const modelId = args.find((a) => !a.startsWith("--")) ?? "deepseek-v4-flash";
const portArg = args.indexOf("--port");
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 8899;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const root = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(root, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-codex-probe-"));
const codexHome = path.join(outDir, "codex-home");
const workDir = path.join(outDir, "work");
fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });

// ── 최소 stdio MCP 서버 (도구 2개) ────────────────────────────────────────
const mcpPath = path.join(outDir, "fake-mcp.mjs");
fs.writeFileSync(
  mcpPath,
  `import readline from "node:readline";
const TOOLS = [
  { name: "dispatch_task", description: "Dispatch a task",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "add_activity", description: "Log an activity",
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } },
];
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: {
    protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "marblo", version: "0.0.0-probe" } } });
  if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
  if (m.method === "tools/call") return send({ jsonrpc: "2.0", id: m.id, result: {
    content: [{ type: "text", text: "ok(probe)" }], isError: false } });
  if (m.method?.startsWith("notifications/")) return;
  if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
`,
  "utf-8",
);

// ── config.toml + model-catalog.json 을 **우리 코드로** 만든다 ────────────
// electron/*.ts 는 TS 라 vitest 로 태운다(레포에 이미 있는 러너).
const genTest = path.join(repo, "tests", "unit", "__codex-probe-gen.test.ts");
fs.writeFileSync(
  genTest,
  `import { describe, it } from "vitest";
import fs from "fs";
import path from "path";
import { renderCodexVendorProviderToml } from "../../electron/codex-vendor-provider";
import { buildCodexModelCatalog, renderCodexModelCatalogJson } from "../../electron/codex-model-catalog";
describe("codex probe gen", () => {
  it("writes CODEX_HOME", () => {
    const out = process.env.PROBE_DIR!;
    const catalog = buildCodexModelCatalog(process.env.PROBE_MODEL!);
    let catalogPath: string | undefined;
    if (catalog) {
      catalogPath = path.join(out, "model-catalog.json");
      fs.writeFileSync(catalogPath, renderCodexModelCatalogJson(catalog), "utf-8");
    }
    const toml =
      renderCodexVendorProviderToml(
        { providerId: "deepseek", name: "DeepSeek",
          upstreamBaseUrl: process.env.PROBE_BASEURL!, envKey: "DEEPSEEK_API_KEY",
          wireApi: "responses", needsChatBridge: false },
        process.env.PROBE_BASEURL!, catalogPath,
      ).trimEnd() + "\\n\\n" +
      ["[mcp_servers.marblo]",
       \`command = \${JSON.stringify(process.env.PROBE_NODE!)}\`,
       \`args = \${JSON.stringify([process.env.PROBE_MCP!])}\`,
       "tool_timeout_sec = 60", "startup_timeout_sec = 30"].join("\\n") + "\\n";
    fs.writeFileSync(path.join(out, "config.toml"), toml, "utf-8");
  });
});
`,
  "utf-8",
);

try {
  const gen = spawnSync(
    "npx",
    ["vitest", "run", "tests/unit/__codex-probe-gen.test.ts"],
    {
      cwd: repo,
      env: {
        ...process.env,
        PROBE_DIR: codexHome,
        PROBE_MODEL: modelId,
        PROBE_BASEURL: BASE_URL,
        PROBE_NODE: process.execPath,
        PROBE_MCP: mcpPath,
      },
      encoding: "utf-8",
    },
  );
  if (gen.status !== 0) {
    console.error(gen.stdout, gen.stderr);
    throw new Error("config 생성 실패");
  }
} finally {
  fs.rmSync(genTest, { force: true });
}

// codex 내장 카탈로그를 쓰는 대조군은 model_catalog_json 을 빼야 한다
// (그 키는 내장 카탈로그를 **대체**하므로 남기면 대조군 모델이 unknown 이 된다).
const cfgPath = path.join(codexHome, "config.toml");
if (!fs.existsSync(path.join(codexHome, "model-catalog.json"))) {
  fs.writeFileSync(
    cfgPath,
    fs
      .readFileSync(cfgPath, "utf-8")
      .split("\n")
      .filter((l) => !l.startsWith("model_catalog_json"))
      .join("\n"),
    "utf-8",
  );
  console.log(
    `[probe] "${modelId}" 는 벤더 카탈로그 대상이 아니다 — model_catalog_json 없이 뜬다(대조군).`,
  );
}

// ── mock Responses upstream ──────────────────────────────────────────────
// ★반드시 **별도 프로세스**여야 한다. codex 는 spawnSync 로 돌리는데, 같은
//   프로세스 안의 http 서버는 spawnSync 가 이벤트루프를 막는 동안 요청을 하나도
//   처리하지 못한다(실측: codex 가 응답을 영원히 기다린다).
const capturePath = path.join(outDir, "captured.json");
const mockPath = path.join(outDir, "mock-upstream.mjs");
fs.writeFileSync(
  mockPath,
  `import http from "node:http";
import fs from "node:fs";
const CAPTURE = process.argv[2];
const PORT = Number(process.argv[3]);
let first = null;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (!first) {
      let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
      first = { url: req.url, body: parsed };
      fs.writeFileSync(CAPTURE, JSON.stringify(first, null, 2));
    }
    const model = first?.body?.model ?? "unknown";
    const response = {
      id: "resp_probe", object: "response", status: "completed", model,
      store: false, previous_response_id: null, parallel_tool_calls: true,
      output: [{ id: "msg_probe", type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "PROBE_OK", annotations: [] }] }],
      usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 },
    };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const w = (e, d) => res.write("event: " + e + "\\ndata: " + JSON.stringify(d) + "\\n\\n");
    w("response.created", { type: "response.created", sequence_number: 0,
      response: { ...response, status: "in_progress", output: [] } });
    w("response.output_item.added", { type: "response.output_item.added", sequence_number: 1,
      output_index: 0, item: { id: "msg_probe", type: "message", role: "assistant", status: "in_progress", content: [] } });
    w("response.output_text.delta", { type: "response.output_text.delta", sequence_number: 2,
      item_id: "msg_probe", output_index: 0, content_index: 0, delta: "PROBE_OK" });
    w("response.output_item.done", { type: "response.output_item.done", sequence_number: 3,
      output_index: 0, item: response.output[0] });
    w("response.completed", { type: "response.completed", sequence_number: 4, response });
    res.end();
  });
}).listen(PORT, "127.0.0.1", () => console.log("ready"));
`,
  "utf-8",
);

const mock = spawn(process.execPath, [mockPath, capturePath, String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("mock upstream 기동 실패")), 10_000);
  mock.stdout.on("data", (d) => {
    if (String(d).includes("ready")) {
      clearTimeout(timer);
      resolve();
    }
  });
});


// ── codex 실행 ───────────────────────────────────────────────────────────
const run = spawnSync(
  "codex",
  [
    "exec",
    "--skip-git-repo-check",
    "-c", `model="${modelId}"`,
    "-c", 'approval_policy="never"',
    "-c", 'sandbox_mode="read-only"',
    "say hi",
  ],
  {
    cwd: workDir,
    // 값은 더미다. 우리가 upstream 이라 검증되지 않는다 — 진짜 키를 넣지 말 것.
    env: { ...process.env, CODEX_HOME: codexHome, DEEPSEEK_API_KEY: "sk-probe-dummy" },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  },
);
mock.kill();

const captured = fs.existsSync(capturePath)
  ? JSON.parse(fs.readFileSync(capturePath, "utf-8"))
  : null;
if (!captured) {
  console.error("[probe] 요청을 한 건도 못 받았다. codex 출력:");
  console.error(run.stdout ?? "", run.stderr ?? "");
  process.exit(1);
}

const b = captured.body;
console.log(`\n=== ${captured.url}  model=${b.model} ===`);
console.log(`reasoning=${JSON.stringify(b.reasoning)}  store=${b.store}`);
console.log(`--- tools (${(b.tools ?? []).length}) ---`);
let namespaced = 0;
for (const t of b.tools ?? []) {
  if (t.type === "namespace") {
    namespaced += (t.tools ?? []).length;
    console.log(
      `  ★ namespace ${t.name} -> [${(t.tools ?? []).map((x) => x.name).join(", ")}]`,
    );
  } else {
    console.log(`    ${t.type} ${t.name ?? t.function?.name ?? ""}`);
  }
}
if (namespaced > 0) {
  console.log(
    `\n★ MCP/멀티에이전트 도구 ${namespaced}개가 type:"namespace" 로 실렸다.` +
      `\n  OpenAI 호환 벤더 상당수는 이 타입을 받지 않고 조용히 버린다` +
      `\n  (DeepSeek 공식 호환표: function/web_search/custom(apply_patch) 외 전부 무시).` +
      `\n  → 그 벤더로 뜬 에이전트·오케는 MCP 도구가 0개가 된다.`,
  );
}
console.log(`\n캡처 원본: ${outDir}`);

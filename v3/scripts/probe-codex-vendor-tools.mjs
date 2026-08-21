#!/usr/bin/env node
/**
 * codex 벤더 스폰이 **실제로 보내는 요청 바디**를 캡처한다. 그리고(`--live`)
 * 그 바디를 **진짜 벤더에 그대로 흘려보내고 응답까지** 캡처한다.
 *
 * ── 왜 있나 ──────────────────────────────────────────────────────────────
 * env-swap 벤더(Upstage/DeepSeek)가 "떴는데 도구가 없다" 로 실패하는 사고를 두 번
 * 겪었다(solar 2026-08-19, deepseek 2026-08-21). 두 번 다 원인은 CLI 로그나 UI 에
 * 안 보였고, **요청 바디의 `tools` 배열**을 봐야만 드러났다.
 *
 * ★이 스크립트의 존재 이유는 하나로 요약된다:
 *   **"모델이 도구를 못 봤다" 와 "모델이 도구를 안 썼다" 를 가른다.**
 * Solar 때 이 둘을 안 갈라서 하루를 태웠다. 게을러서 안 부른 것과 도구가 애초에
 * 안 실린 것은 다른 문제고 해법도 다르다. 로그·UI 로는 절대 갈리지 않는다 —
 * **요청 바디(무엇을 보냈나)와 응답 바디(무엇이 돌아왔나)를 같이** 봐야 갈린다.
 *
 * ── 두 가지 모드 ─────────────────────────────────────────────────────────
 *
 *   (기본) mock 모드 — 로컬 mock Responses upstream 을 띄우고 codex 를 거기로
 *   보낸다. 우리가 upstream 이라 **벤더 키가 필요 없다.** "codex 가 무엇을
 *   보내는가" 만 본다.
 *
 *   `--live`  — 로컬 **기록형 포워드 프록시**를 띄우고 codex 를 거기로 보낸다.
 *   프록시는 요청을 그대로 진짜 벤더(`--upstream`, 기본 https://api.deepseek.com)
 *   로 흘리고 **요청·응답 양쪽을 캡처**한다. 벤더가 그 도구를 실제로 받는지
 *   (=모델이 볼 수 있는지)를 라이브로 확정한다.
 *
 *   `--flatten` — `--live` 와 함께 쓴다. 나가는 요청의 `type:"namespace"` 덩어리를
 *   `<namespace>__<tool>` 이름의 평탄한 `type:"function"` 들로 **펼쳐서** 보내고,
 *   돌아오는 SSE 의 도구 호출 이름을 원래대로 되돌린다(`codex-chat-bridge.ts` 가
 *   Chat 으로 접으며 하는 일과 같되 Responses 를 유지 — 즉 "Responses→Responses
 *   셔틀" 해법 후보 ①의 최소 프로토타입이다).
 *
 * ★A/B 가 이 스크립트의 본론이다. 같은 codex·같은 모델·같은 프롬프트에서
 *   **도구 모양만** 바꾼다:
 *     A: `--live`             → namespace 그대로
 *     B: `--live --flatten`   → function 으로 평탄화
 *   A 에서 도구 호출이 0건이고 B 에서 나오면 → **못 본 것**(도구가 버려졌다).
 *   A/B 둘 다 0건이면 → 도구는 실렸는데 **안 쓴 것**(모델 행동 문제).
 *   이 판정은 모델의 자기보고("도구가 안 보입니다")에 의존하지 않는다.
 *
 * ── 쓰는 법 ──────────────────────────────────────────────────────────────
 *   node scripts/probe-codex-vendor-tools.mjs [model-id] [옵션]
 *
 *   node scripts/probe-codex-vendor-tools.mjs deepseek-v4-flash
 *   node scripts/probe-codex-vendor-tools.mjs gpt-5.5        # 대조군(내장 카탈로그)
 *
 *   # 라이브(키 필요). ★키는 이 스크립트가 읽지 않는다 — codex 가 env 에서 읽어
 *   #  Authorization 헤더로 실어 보내고, 프록시는 그 헤더를 **그대로 전달**만 한다.
 *   #  그래서 secret-launcher 로 띄우면 평문이 이 프로세스 어디에도 남지 않는다:
 *   npx electron dist-electron/scripts/bench/secret-launcher.js \
 *     --secret=DEEPSEEK_API_KEY -- \
 *     node scripts/probe-codex-vendor-tools.mjs deepseek-v4-flash --live
 *
 *   옵션:
 *     --port <n>        프록시/mock 포트 (기본 8899)
 *     --live            진짜 벤더로 흘린다
 *     --upstream <url>  라이브 업스트림 (기본 https://api.deepseek.com)
 *     --flatten         namespace → function 평탄화 (라이브 전용)
 *     --effort <lvl>    model_reasoning_effort 핀
 *     --prompt <text>   codex 에 줄 프롬프트
 *     --label <name>    캡처 디렉터리 접미사(리포트에서 A/B 구분용)
 *     --sandbox <mode>  codex sandbox_mode (라이브 기본 danger-full-access = 제품과 동일)
 *
 * config.toml / model-catalog.json 은 **우리 실제 코드**로 만든다
 * (`renderCodexVendorProviderToml` + `buildCodexModelCatalog`). 손으로 흉내낸
 * config 를 검증해봐야 라이브 경로를 증명하지 못한다 — 이 파일의 핵심 규율이다.
 *
 * ── 2026-08-21 이 스크립트가 잡아낸 것 (codex 0.149.0) ────────────────────
 *   [mock]  deepseek-v4-flash → tools 에 `{type:"namespace", name:"mcp__marblo", ...}`
 *   [mock]  gpt-5.5(대조군)   → namespace 없음, `tool_search` 하나
 *   [live]  DeepSeek 은 그 namespace 를 **받는다**(실측). 전말은
 *           docs/deepseek-namespace-mcp-live-probe-2026-08-21.md 참조.
 * 자세한 내용은 electron/codex-model-catalog.ts 상단 주석 참조.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith("--")) {
    // 값을 먹는 옵션이면 다음 토큰을 건너뛴다.
    if (
      ["port", "upstream", "effort", "prompt", "label", "sandbox"].includes(
        a.slice(2),
      )
    )
      i += 1;
    continue;
  }
  positional.push(a);
}

const modelId = positional[0] ?? "deepseek-v4-flash";
const PORT = Number(opt("port", 8899));
const LIVE = flag("live");
const FLATTEN = flag("flatten");
const UPSTREAM = opt("upstream", "https://api.deepseek.com");
const EFFORT = opt("effort", null);
const LABEL = opt("label", LIVE ? (FLATTEN ? "live-flatten" : "live") : "mock");
// ★라이브는 제품(`agent-config.ts` gpt 분기)과 **같은** 권한 플래그로 뜬다.
//   read-only 로 두면 codex 가 MCP 호출을 "requires approval" 로 스스로 막아,
//   벤더가 도구를 받았는지와 무관한 로컬 사유로 tools/call 이 0건이 된다
//   (실측 2026-08-21 live-A 1차: 벤더는 호출을 냈는데 codex 가 막았다).
const SANDBOX = opt("sandbox", LIVE ? "danger-full-access" : "read-only");
/**
 * `--edit-check` — **apply_patch 가 실제로 파일을 고치는가** 를 라이브로 본다.
 *
 * `codex-model-catalog.ts` 가 벤더 카탈로그를 넣은 이유가 정확히 이것이다(폴백
 * 메타데이터에는 apply_patch 가 등록되지 않아 `unsupported call: apply_patch` 로
 * 거절당하고 파일이 안 고쳐졌다). 그건 **mock upstream 으로는 확인할 수 없다** —
 * 모델이 실제로 패치를 만들어 내야 하기 때문이다. 그래서 라이브에서만 켠다.
 *
 * 판정은 모델 말이 아니라 **파일 내용**으로 한다.
 */
const EDIT_CHECK = flag("edit-check");
const EDIT_FILE = "probe-target.txt";
const EDIT_BEFORE = "alpha\nbravo\ncharlie\n";
const EDIT_AFTER_TOKEN = "PATCHED_BY_PROBE";
const PROMPT = opt(
  "prompt",
  EDIT_CHECK
    ? `Use the apply_patch tool to edit the file ${"`"}probe-target.txt${"`"} in the ` +
        `current directory: replace the line ${"`"}bravo${"`"} with the line ` +
        `${"`"}PATCHED_BY_PROBE${"`"}. Change nothing else. Then stop.`
    : LIVE
      ? // ★프롬프트가 "도구를 쓰라" 고 명시적으로 지시한다. 그래야 도구를 안 쓴
        // 결과가 "지시를 못 받아서" 로 설명되지 않는다. 판정은 그래도 자기보고가
        // 아니라 **응답 바디의 function_call 유무**로 한다.
        "Call the `add_activity` tool from the marblo MCP server with " +
        'task_id="probe-001". Do it now, before writing any prose. ' +
        "If — and only if — no such tool is available to you, reply with the " +
        "single line NO_MCP_TOOL_VISIBLE and stop."
      : "say hi",
);
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (FLATTEN && !LIVE) {
  console.error("[probe] --flatten 은 --live 와 함께만 의미가 있다.");
  process.exit(2);
}

const root = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(root, "..");
const outDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `marblo-codex-probe-${LABEL}-`),
);
const codexHome = path.join(outDir, "codex-home");
const workDir = path.join(outDir, "work");
fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });
if (EDIT_CHECK) {
  fs.writeFileSync(path.join(workDir, EDIT_FILE), EDIT_BEFORE, "utf-8");
}

// ── 최소 stdio MCP 서버 (도구 2개) ────────────────────────────────────────
// ★`tools/call` 이 실제로 오면 파일에 적는다. "모델이 진짜 불렀나" 를 codex 로그
//   해석이 아니라 **MCP 서버가 받은 사실**로 확정하기 위해서다.
const mcpCallLog = path.join(outDir, "mcp-calls.jsonl");
const mcpPath = path.join(outDir, "fake-mcp.mjs");
fs.writeFileSync(
  mcpPath,
  `import readline from "node:readline";
import fs from "node:fs";
const CALL_LOG = ${JSON.stringify(mcpCallLog)};
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
  if (m.method === "tools/call") {
    try { fs.appendFileSync(CALL_LOG, JSON.stringify({ at: new Date().toISOString(), params: m.params }) + "\\n"); } catch {}
    return send({ jsonrpc: "2.0", id: m.id, result: {
      content: [{ type: "text", text: "ok(probe)" }], isError: false } });
  }
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

// ── upstream: mock 또는 기록형 포워드 프록시 ─────────────────────────────
// ★반드시 **별도 프로세스**여야 한다. codex 는 spawnSync 로 돌리는데, 같은
//   프로세스 안의 http 서버는 spawnSync 가 이벤트루프를 막는 동안 요청을 하나도
//   처리하지 못한다(실측: codex 가 응답을 영원히 기다린다).
const capturePath = path.join(outDir, "captured.json");
const transcriptPath = path.join(outDir, "transcript.jsonl");
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

/**
 * 라이브 프록시.
 *
 * ★시크릿 규율: 이 프로세스는 벤더 키를 **읽지도 파싱하지도 않는다.** codex 가
 *   붙인 `authorization` 헤더를 그대로 다음 홉에 넘길 뿐이고, 캡처 파일에는
 *   **바디만** 적는다(헤더는 통째로 제외). 그래서 캡처 산출물을 그대로 붙여넣어도
 *   키가 새지 않는다.
 */
const proxyPath = path.join(outDir, "live-proxy.mjs");
fs.writeFileSync(
  proxyPath,
  `import http from "node:http";
import fs from "node:fs";
const CAPTURE = process.argv[2];
const TRANSCRIPT = process.argv[3];
const PORT = Number(process.argv[4]);
const UPSTREAM = process.argv[5];
const FLATTEN = process.argv[6] === "flatten";
const SEP = "__";

/** namespace 덩어리를 평탄한 function 들로 펼친다. 역맵도 같이 만든다. */
function flattenTools(tools) {
  const out = [];
  const reverse = new Map();
  for (const t of tools ?? []) {
    if (t && t.type === "namespace" && Array.isArray(t.tools)) {
      for (const inner of t.tools) {
        const flat = String(t.name ?? "") + SEP + String(inner.name ?? "");
        reverse.set(flat, { name: inner.name, namespace: t.name });
        out.push({
          type: "function",
          name: flat,
          description: inner.description ?? "",
          parameters: inner.parameters ?? inner.input_schema ?? { type: "object", properties: {} },
          strict: false,
        });
      }
      continue;
    }
    out.push(t);
  }
  return { tools: out, reverse };
}

let firstWritten = false;
let reverse = new Map();

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf-8");
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    let outgoing = raw;
    if (parsed && FLATTEN && Array.isArray(parsed.tools)) {
      const f = flattenTools(parsed.tools);
      reverse = f.reverse;
      parsed = { ...parsed, tools: f.tools };
      outgoing = JSON.stringify(parsed);
    }

    if (!firstWritten) {
      firstWritten = true;
      // ★바디만. 헤더(=Authorization)는 캡처하지 않는다.
      fs.writeFileSync(CAPTURE, JSON.stringify({ url: req.url, body: parsed ?? raw }, null, 2));
    }

    const target = UPSTREAM.replace(/\\/$/, "") + req.url;
    let upstreamRes;
    try {
      upstreamRes = await fetch(target, {
        method: req.method,
        headers: {
          "content-type": req.headers["content-type"] ?? "application/json",
          accept: req.headers["accept"] ?? "text/event-stream",
          authorization: req.headers["authorization"] ?? "",
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : outgoing,
      });
    } catch (err) {
      fs.appendFileSync(TRANSCRIPT, JSON.stringify({ kind: "upstream-error", message: String(err) }) + "\\n");
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "probe proxy upstream error: " + String(err) } }));
      return;
    }

    const status = upstreamRes.status;
    const ctype = upstreamRes.headers.get("content-type") ?? "application/json";
    res.writeHead(status, { "content-type": ctype });

    const text = await upstreamRes.text();
    fs.appendFileSync(
      TRANSCRIPT,
      JSON.stringify({ kind: "upstream-response", url: req.url, status, contentType: ctype, body: text.slice(0, 200000) }) + "\\n",
    );

    // 평탄화했으면 돌아오는 도구 호출 이름을 원래대로 되돌린다(codex 가 아는 이름).
    let downstream = text;
    if (FLATTEN && reverse.size > 0) {
      for (const [flat, orig] of reverse) {
        downstream = downstream.split(JSON.stringify(flat)).join(JSON.stringify(orig.name));
      }
    }
    res.end(downstream);
  });
}).listen(PORT, "127.0.0.1", () => console.log("ready"));
`,
  "utf-8",
);

const upstreamArgs = LIVE
  ? [
      proxyPath,
      capturePath,
      transcriptPath,
      String(PORT),
      UPSTREAM,
      FLATTEN ? "flatten" : "passthrough",
    ]
  : [mockPath, capturePath, String(PORT)];

const mock = spawn(process.execPath, upstreamArgs, {
  stdio: ["ignore", "pipe", "pipe"],
});
mock.stderr.on("data", (d) => process.stderr.write(`[upstream] ${d}`));
await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("upstream 기동 실패")),
    10_000,
  );
  mock.stdout.on("data", (d) => {
    if (String(d).includes("ready")) {
      clearTimeout(timer);
      resolve();
    }
  });
});

if (LIVE) {
  console.log(
    `[probe] LIVE — codex → 로컬 기록형 프록시(:${PORT}) → ${UPSTREAM}` +
      (FLATTEN ? "  [namespace → function 평탄화 ON]" : "  [passthrough]"),
  );
  console.log(`[probe] 프롬프트: ${PROMPT}`);
}

// ── codex 실행 ───────────────────────────────────────────────────────────
const run = spawnSync(
  "codex",
  [
    "exec",
    "--skip-git-repo-check",
    "-c",
    `model="${modelId}"`,
    ...(EFFORT ? ["-c", `model_reasoning_effort="${EFFORT}"`] : []),
    "-c",
    'approval_policy="never"',
    "-c",
    `sandbox_mode="${SANDBOX}"`,
    PROMPT,
  ],
  {
    cwd: workDir,
    // mock 모드에서는 값이 더미다(우리가 upstream 이라 검증되지 않는다).
    // 라이브에서는 **부모 env 의 진짜 키**를 그대로 물려줘야 한다 —
    // secret-launcher 가 넣어 준 값이다. 여기서 읽거나 찍지 않는다.
    env: LIVE
      ? { ...process.env, CODEX_HOME: codexHome }
      : {
          ...process.env,
          CODEX_HOME: codexHome,
          DEEPSEEK_API_KEY: "sk-probe-dummy",
        },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: LIVE ? 300_000 : 120_000,
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
let flatMcp = 0;
for (const t of b.tools ?? []) {
  if (t.type === "namespace") {
    namespaced += (t.tools ?? []).length;
    console.log(
      `  ★ namespace ${t.name} -> [${(t.tools ?? [])
        .map((x) => x.name)
        .join(", ")}]`,
    );
  } else {
    if (t.type === "function" && String(t.name ?? "").startsWith("mcp__"))
      flatMcp += 1;
    console.log(`    ${t.type} ${t.name ?? t.function?.name ?? ""}`);
  }
}
if (namespaced > 0) {
  console.log(
    `\n★ MCP/멀티에이전트 도구 ${namespaced}개가 type:"namespace" 로 실렸다.` +
      `\n  이 타입을 받는지는 **벤더마다 다르고 문서로는 알 수 없다** — 받지 않는` +
      `\n  벤더면 통째로 조용히 버려져 에이전트·오케의 MCP 도구가 0개가 된다.` +
      `\n  ※ DeepSeek 은 2026-08-21 라이브에서 **받는 것으로 확정**됐다(응답이` +
      `\n    namespace 필드까지 그대로 되돌려준다). 공식 호환표에는 namespace 가` +
      `\n    없었지만 열거가 완전하지 않았다 — 다른 벤더도 --live 로 직접 볼 것.`,
  );
}
if (flatMcp > 0) {
  console.log(
    `\n★ 평탄화된 MCP function 도구 ${flatMcp}개로 나갔다(--flatten).`,
  );
}

// ── 라이브: 응답에서 **무엇이 돌아왔나** 를 센다 ─────────────────────────
if (LIVE) {
  const lines = fs.existsSync(transcriptPath)
    ? fs
        .readFileSync(transcriptPath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  const statuses = lines
    .filter((l) => l.kind === "upstream-response")
    .map((l) => l.status);
  const allBodies = lines.map((l) => l.body ?? l.message ?? "").join("\n");

  /** SSE 전체에서 function_call 이름을 뽑는다(중복 제거). */
  const callNames = new Set();
  for (const m of allBodies.matchAll(
    /"type"\s*:\s*"function_call"[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"/g,
  )) {
    callNames.add(m[1]);
  }
  // 이름이 type 보다 앞에 오는 직렬화도 있으므로 반대 순서도 훑는다.
  for (const m of allBodies.matchAll(
    /"name"\s*:\s*"([^"]+)"[\s\S]{0,200}?"type"\s*:\s*"function_call"/g,
  )) {
    callNames.add(m[1]);
  }

  const errorMessages = [];
  for (const m of allBodies.matchAll(
    /"error"\s*:\s*\{[\s\S]{0,400}?"message"\s*:\s*"([^"]{0,300})"/g,
  )) {
    errorMessages.push(m[1]);
  }

  /**
   * ★usage 집계 — effort 축이 **실제로 먹는지** 를 보는 유일한 외부 관측치다.
   * 같은 프롬프트에서 effort 만 바꿔 `reasoning_tokens` 가 움직이면 그 축은
   * 벤더에서 실제로 해석된 것이고, 안 움직이면 조용히 무시된 것이다.
   * (DeepSeek 은 미지원 파라미터를 400 이 아니라 **조용히 무시**한다고 공식
   *  문서가 적으므로, 200 이 떴다는 사실만으로는 "먹었다" 가 증명되지 않는다.)
   */
  const usage = { input: 0, output: 0, reasoning: 0, cachedInput: 0 };
  for (const l of lines) {
    for (const m of String(l.body ?? "").matchAll(/^data: (.*)$/gm)) {
      let d;
      try {
        d = JSON.parse(m[1]);
      } catch {
        continue;
      }
      const u = d?.response?.usage;
      if (d?.type === "response.completed" && u) {
        usage.input += u.input_tokens ?? 0;
        usage.output += u.output_tokens ?? 0;
        usage.reasoning += u.output_tokens_details?.reasoning_tokens ?? 0;
        usage.cachedInput += u.input_tokens_details?.cached_tokens ?? 0;
      }
    }
  }

  const mcpCalls = fs.existsSync(mcpCallLog)
    ? fs.readFileSync(mcpCallLog, "utf-8").trim().split("\n").filter(Boolean)
    : [];

  // ★프롬프트 자체가 그 토큰을 포함하므로 **에코를 지우고** 본다. 지우지 않으면
  //   모델이 뭐라 했든 항상 "예" 가 나온다(실측 2026-08-21 live-A 1차의 오탐).
  //   어차피 판정은 이 자기보고가 아니라 위의 function_call 유무로 한다.
  const echoStripped = ((run.stdout ?? "") + (run.stderr ?? "") + allBodies)
    .split(PROMPT)
    .join("");
  const saidInvisible = /NO_MCP_TOOL_VISIBLE/.test(echoStripped);

  console.log(`\n=== LIVE 결과 (${LABEL}) ===`);
  console.log(
    `업스트림 응답 수: ${statuses.length}  status=[${statuses.join(", ")}]`,
  );
  console.log(
    `벤더가 낸 도구 호출: ${
      callNames.size ? [...callNames].join(", ") : "(없음)"
    }`,
  );
  console.log(`MCP 서버가 실제로 받은 tools/call: ${mcpCalls.length}건`);
  for (const c of mcpCalls) console.log(`    ${c}`);
  if (errorMessages.length)
    console.log(
      `업스트림 에러 메시지: ${errorMessages.slice(0, 5).join(" | ")}`,
    );
  console.log(
    `모델 자기보고 NO_MCP_TOOL_VISIBLE: ${saidInvisible ? "예" : "아니오"}`,
  );
  console.log(
    `codex exit=${run.status}${run.error ? ` (${run.error.message})` : ""}`,
  );
  console.log(
    `usage: input=${usage.input} (cached ${usage.cachedInput}) ` +
      `output=${usage.output} reasoning=${usage.reasoning}`,
  );

  // ── apply_patch 라이브 확증 ─────────────────────────────────────────────
  let editVerdict = null;
  if (EDIT_CHECK) {
    const target = path.join(workDir, EDIT_FILE);
    const after = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : "";
    const changed = after !== EDIT_BEFORE;
    const hasToken = after.includes(EDIT_AFTER_TOKEN);
    // ★거절 로그는 codex 자신이 적는 문자열 하나로만 본다(해석하지 않는다).
    const rejected = /unsupported call:\s*apply_patch/i.test(
      (run.stdout ?? "") + (run.stderr ?? ""),
    );
    editVerdict = { changed, hasToken, rejected, after };
    console.log(`\n=== apply_patch 확증 ===`);
    console.log(`파일 변경됨: ${changed ? "예" : "아니오"}`);
    console.log(
      `기대 토큰(${EDIT_AFTER_TOKEN}) 포함: ${hasToken ? "예" : "아니오"}`,
    );
    console.log(
      `unsupported call: apply_patch 거절: ${rejected ? "★예" : "아니오"}`,
    );
    console.log(`--- ${EDIT_FILE} (after) ---\n${after}`);
  }

  const verdictPath = path.join(outDir, "verdict.json");
  fs.writeFileSync(
    verdictPath,
    JSON.stringify(
      {
        label: LABEL,
        model: modelId,
        effort: EFFORT,
        flatten: FLATTEN,
        upstream: UPSTREAM,
        prompt: PROMPT,
        sandbox: SANDBOX,
        sentToolTypes: (b.tools ?? []).map((t) => ({
          type: t.type,
          name: t.name ?? null,
          inner: t.tools ? t.tools.map((x) => x.name) : undefined,
        })),
        namespacedToolCount: namespaced,
        flatMcpToolCount: flatMcp,
        upstreamStatuses: statuses,
        vendorToolCalls: [...callNames],
        mcpServerCalls: mcpCalls.length,
        upstreamErrors: errorMessages.slice(0, 5),
        modelSaidNoToolVisible: saidInvisible,
        usage,
        editCheck: editVerdict,
        codexExit: run.status,
      },
      null,
      2,
    ),
  );
  console.log(`\n판정 요약: ${verdictPath}`);
}

console.log(`\n캡처 원본: ${outDir}`);
if (LIVE) {
  console.log(`  요청 바디: ${capturePath}`);
  console.log(`  응답 트랜스크립트: ${transcriptPath}`);
  console.log(`  codex stdout tail:`);
  console.log(
    (run.stdout ?? "")
      .split("\n")
      .slice(-25)
      .map((l) => `    ${l}`)
      .join("\n"),
  );
  if (run.stderr) {
    console.log(`  codex stderr tail:`);
    console.log(
      run.stderr
        .split("\n")
        .slice(-15)
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }
}
